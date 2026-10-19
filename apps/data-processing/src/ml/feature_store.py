import logging
import os
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Mapping, Optional, Tuple

import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import Session

from src.cache_manager import CacheManager

from src.ml.feature_schema import (
    PRICE_PREDICTOR_FEATURE_SET,
    FeatureSchema,
    current_feature_schema,
)
from src.utils.metrics import (
    FEATURE_STORE_CACHE_INVALIDATIONS_TOTAL,
    FEATURE_STORE_CACHE_STALENESS_SECONDS,
    FEATURE_STORE_LOOKUP_SECONDS,
)

logger = logging.getLogger(__name__)

_FEATURE_SOURCES: Dict[str, Tuple[str, str, int]] = {
    "sentiment_score": (
        "asset_sentiment_view",
        "FEATURE_CACHE_SENTIMENT_TTL_SECONDS",
        60,
    ),
    "volume": ("asset_volume_view", "FEATURE_CACHE_VOLUME_TTL_SECONDS", 300),
    "volatility": (
        "asset_volatility_view",
        "FEATURE_CACHE_VOLATILITY_TTL_SECONDS",
        900,
    ),
}
_FEATURE_CACHES: Dict[str, Optional[CacheManager]] = {}
_FEATURE_CACHE_LOCK = threading.Lock()


def _feature_cache(feature: str) -> Optional[CacheManager]:
    """Create one Redis cache per source feature, tolerating unavailable Redis."""
    with _FEATURE_CACHE_LOCK:
        if feature in _FEATURE_CACHES:
            return _FEATURE_CACHES[feature]
        _, ttl_env, default_ttl = _FEATURE_SOURCES[feature]
        ttl_seconds = int(os.getenv(ttl_env, str(default_ttl)))
        if ttl_seconds <= 0:
            raise ValueError(f"{ttl_env} must be greater than zero")
        try:
            cache = CacheManager(
                namespace=f"feature_store_{feature}", ttl_seconds=ttl_seconds
            )
        except Exception:
            logger.warning(
                "Feature cache unavailable for %s; using the database directly",
                feature,
                exc_info=True,
            )
            cache = None
        _FEATURE_CACHES[feature] = cache
        return cache


def invalidate_feature_store_cache(features: Optional[Tuple[str, ...]] = None) -> None:
    """Invalidate feature namespaces after writes to their upstream data."""
    selected = tuple(_FEATURE_SOURCES) if features is None else features
    for feature in selected:
        if feature not in _FEATURE_SOURCES:
            raise ValueError(f"Unknown feature cache: {feature}")
        cache = _feature_cache(feature)
        if cache is not None:
            cache.clear_namespace()
        FEATURE_STORE_CACHE_INVALIDATIONS_TOTAL.labels(feature=feature).inc()

class FeatureStore:
    # The feature set this store produces. Its versioned schema lives in
    # src/ml/feature_schema.py and is stamped onto every frame this store
    # returns (see ``get_features_for_asset``) so downstream training/serving
    # can record and compare it (#1239).
    FEATURE_SET = PRICE_PREDICTOR_FEATURE_SET

    def __init__(
        self,
        db_session: Session,
        cache_managers: Optional[Mapping[str, CacheManager]] = None,
    ):
        """
        Initialize the FeatureStore with a SQLAlchemy database session.
        """
        self.db = db_session
        self._cache_managers = cache_managers

    def _get_cache(self, feature: str) -> Optional[CacheManager]:
        if self._cache_managers is not None:
            return self._cache_managers.get(feature)
        return _feature_cache(feature)

    @staticmethod
    def _decode_cached_rows(payload: Any, feature: str) -> Optional[pd.DataFrame]:
        if not isinstance(payload, dict) or not isinstance(payload.get("rows"), list):
            return None
        frame = pd.DataFrame(payload["rows"], columns=["timestamp", feature])
        if not frame.empty:
            frame["timestamp"] = pd.to_datetime(frame["timestamp"])
        return frame

    @staticmethod
    def _encode_cached_rows(frame: pd.DataFrame, feature: str) -> list:
        rows = []
        for row in frame[["timestamp", feature]].to_dict(orient="records"):
            timestamp = row["timestamp"]
            value = row[feature]
            rows.append(
                {
                    "timestamp": (
                        timestamp.isoformat()
                        if hasattr(timestamp, "isoformat")
                        else str(timestamp)
                    ),
                    feature: None if pd.isna(value) else float(value),
                }
            )
        return rows

    def _read_source(
        self,
        feature: str,
        query: Any,
        params: Dict[str, Any],
        cache_key: Optional[str],
        serving_start_time: Optional[datetime],
    ) -> pd.DataFrame:
        cache = self._get_cache(feature) if cache_key is not None else None
        cache_status = "bypass" if cache_key is None or cache is None else "miss"
        started = time.perf_counter()
        try:
            if cache is not None and cache_key is not None:
                cached = cache.get(cache_key)
                try:
                    frame = self._decode_cached_rows(cached, feature)
                    cached_at = (
                        cached.get("cached_at")
                        if isinstance(cached, dict)
                        else None
                    )
                    cache_age = (
                        datetime.now(timezone.utc)
                        - datetime.fromisoformat(cached_at)
                        if cached_at
                        else None
                    )
                except (TypeError, ValueError, KeyError):
                    logger.warning(
                        "Ignoring malformed cached rows for feature %s",
                        feature,
                        exc_info=True,
                    )
                    frame = None
                    cache_age = None
                if frame is not None and cache_age is not None:
                    age = max(0.0, cache_age.total_seconds())
                    FEATURE_STORE_CACHE_STALENESS_SECONDS.labels(
                        feature=feature
                    ).set(age)
                    if serving_start_time is not None and not frame.empty:
                        timestamps = pd.to_datetime(frame["timestamp"])
                        cutoff = pd.Timestamp(serving_start_time)
                        if timestamps.dt.tz is None and cutoff.tzinfo is not None:
                            cutoff = cutoff.tz_localize(None)
                        elif timestamps.dt.tz is not None and cutoff.tzinfo is None:
                            cutoff = cutoff.tz_localize(timestamps.dt.tz)
                        frame["timestamp"] = timestamps
                        frame = frame.loc[timestamps >= cutoff].reset_index(drop=True)
                    cache_status = "hit"
                    return frame

            frame = pd.read_sql(query, self.db.connection(), params=params)
            frame = self._ensure_columns(frame, feature)
            if cache is not None and cache_key is not None:
                cache.set(
                    cache_key,
                    {
                        "cached_at": datetime.now(timezone.utc).isoformat(),
                        "rows": self._encode_cached_rows(frame, feature),
                    },
                )
            if cache is not None:
                FEATURE_STORE_CACHE_STALENESS_SECONDS.labels(
                    feature=feature
                ).set(0)
            return frame
        finally:
            FEATURE_STORE_LOOKUP_SECONDS.labels(
                feature=feature, cache_status=cache_status
            ).observe(time.perf_counter() - started)

    @property
    def schema(self) -> FeatureSchema:
        """The active versioned schema for the features this store produces."""
        return current_feature_schema(self.FEATURE_SET)

    @property
    def schema_version(self) -> str:
        """Convenience accessor for the current feature schema version."""
        return self.schema.version

    def _stamp_schema(self, df: pd.DataFrame) -> pd.DataFrame:
        """Record the producing schema version/fingerprint on the frame.

        Uses ``DataFrame.attrs`` so the tag travels with the frame without
        changing its columns (existing consumers are unaffected). ``attrs`` is
        best-effort metadata in pandas, so this never raises.
        """
        try:
            schema = self.schema
            df.attrs["feature_set"] = schema.feature_set
            df.attrs["schema_version"] = schema.version
            df.attrs["schema_fingerprint"] = schema.fingerprint
        except Exception:
            pass
        return df

    def _parse_window_to_datetime(self, window: str) -> datetime:
        """Helper to parse window strings like '24h' or '7d' into a past timestamp."""
        # Fix deprecation warning by using timezone-aware UTC datetime
        now = datetime.now(timezone.utc)
        if window.endswith('h'):
            return now - timedelta(hours=int(window[:-1]))
        elif window.endswith('d'):
            return now - timedelta(days=int(window[:-1]))
        else:
            raise ValueError("Unsupported window format. Use 'h' (hours) or 'd' (days).")

    def _ensure_columns(self, df: pd.DataFrame, expected_col: str) -> pd.DataFrame:
        """Ensures the DataFrame has the correct base columns, even if it's completely empty."""
        if 'timestamp' not in df.columns:
            df['timestamp'] = pd.Series(dtype='datetime64[ns]')
        if expected_col not in df.columns:
            df[expected_col] = pd.Series(dtype='float64')
        return df

    def get_features_for_asset(
        self,
        asset: str,
        window: Optional[str] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
    ) -> pd.DataFrame:
        """
        Retrieves and combines features for a specific asset over a given time window.
        Combines: Sentiment stats, Volume metrics, and Volatility indicators.
        """
        serving_lookup = (
            window is not None and start_time is None and end_time is None
        )
        if start_time is None:
            if window is None:
                raise ValueError("Must provide either window or start_time")
            start_time = self._parse_window_to_datetime(window)
            
        end_clause = "AND timestamp <= :end_time" if end_time else ""
        cache_keys: Dict[str, Optional[str]] = {}
        for feature in _FEATURE_SOURCES:
            cache_keys[feature] = (
                CacheManager.make_key(
                    asset,
                    window,
                    self.schema.fingerprint,
                )
                if serving_lookup
                else None
            )
        if serving_lookup:
            for feature in _FEATURE_SOURCES:
                self._get_cache(feature)

        try:
            params = {"asset": asset, "start_time": start_time}
            if end_time:
                params["end_time"] = end_time
            sentiment_view = _FEATURE_SOURCES["sentiment_score"][0]
            volume_view = _FEATURE_SOURCES["volume"][0]
            volatility_view = _FEATURE_SOURCES["volatility"][0]
            sentiment_df = self._read_source(
                "sentiment_score",
                text(
                    f"SELECT timestamp, sentiment_score FROM {sentiment_view} "
                    f"WHERE asset = :asset AND timestamp >= :start_time {end_clause}"
                ),
                params,
                cache_keys["sentiment_score"],
                start_time if serving_lookup else None,
            )
            volume_df = self._read_source(
                "volume",
                text(
                    f"SELECT timestamp, volume FROM {volume_view} "
                    f"WHERE asset = :asset AND timestamp >= :start_time {end_clause}"
                ),
                params,
                cache_keys["volume"],
                start_time if serving_lookup else None,
            )
            volatility_df = self._read_source(
                "volatility",
                text(
                    f"SELECT timestamp, volatility FROM {volatility_view} "
                    f"WHERE asset = :asset AND timestamp >= :start_time {end_clause}"
                ),
                params,
                cache_keys["volatility"],
                start_time if serving_lookup else None,
            )
        except Exception:
            sentiment_df = pd.DataFrame()
            volume_df = pd.DataFrame()
            volatility_df = pd.DataFrame()

        # Ensure all dataframes have the right columns before merging
        sentiment_df = self._ensure_columns(sentiment_df, 'sentiment_score')
        volume_df = self._ensure_columns(volume_df, 'volume')
        volatility_df = self._ensure_columns(volatility_df, 'volatility')

        # Always merge using outer joins to align the time series and preserve column names
        features_df = pd.merge(sentiment_df, volume_df, on='timestamp', how='outer')
        features_df = pd.merge(features_df, volatility_df, on='timestamp', how='outer')

        # If no actual data exists, return the empty DataFrame (now with the correct headers)
        if features_df.empty:
            return self._stamp_schema(features_df)

        # Clean up the merged dataset (sort by time, forward fill missing values)
        features_df.sort_values('timestamp', inplace=True)
        features_df.ffill(inplace=True)
        features_df.fillna(0, inplace=True) # Fill remaining NaNs with 0

        return self._stamp_schema(features_df)