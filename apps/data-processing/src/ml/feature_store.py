from datetime import datetime, timezone
from typing import Optional

import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import Session

from src.ml.feature_schema import (
    PRICE_PREDICTOR_FEATURE_SET,
    FeatureSchema,
    current_feature_schema,
)
from src.ml.transforms import clean_time_series, parse_window_to_datetime


class FeatureStore:
    # The feature set this store produces. Its versioned schema lives in
    # src/ml/feature_schema.py and is stamped onto every frame this store
    # returns (see ``get_features_for_asset``) so downstream training/serving
    # can record and compare it (#1239).
    FEATURE_SET = PRICE_PREDICTOR_FEATURE_SET

    def __init__(self, db_session: Session):
        """
        Initialize the FeatureStore with a SQLAlchemy database session.
        """
        self.db = db_session

    @property
    def schema(self) -> FeatureSchema:
        """The active versioned schema for the features this store produces."""
        return current_feature_schema(self.FEATURE_SET)

    @property
    def schema_version(self) -> str:
        """Convenience accessor for the current feature schema version."""
        return self.schema.version

    def _stamp_schema(self, df: pd.DataFrame) -> pd.DataFrame:
        """Record the producing schema version/fingerprint and transforms on the frame.

        Uses ``DataFrame.attrs`` so the tag travels with the frame without
        changing its columns (existing consumers are unaffected). ``attrs`` is
        best-effort metadata in pandas, so this never raises.
        """
        try:
            schema = self.schema
            df.attrs["feature_set"] = schema.feature_set
            df.attrs["schema_version"] = schema.version
            df.attrs["schema_fingerprint"] = schema.fingerprint
            df.attrs["feature_transforms"] = schema.transforms
        except Exception:
            pass
        return df

    def _parse_window_to_datetime(self, window: str) -> datetime:
        """Helper to parse window strings like '24h' or '7d' into a past timestamp."""
        # Use timezone-aware reference time to support freezing 'now' in parity tests
        now = datetime.now(timezone.utc)
        return parse_window_to_datetime(window, reference_time=now)

    def _ensure_columns(self, df: pd.DataFrame, expected_col: str) -> pd.DataFrame:
        """Ensure the DataFrame has expected base columns even if empty."""
        if "timestamp" not in df.columns:
            df["timestamp"] = pd.Series(dtype="datetime64[ns]")
        if expected_col not in df.columns:
            df[expected_col] = pd.Series(dtype="float64")
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
        if start_time is None:
            if window is None:
                raise ValueError("Must provide either window or start_time")
            start_time = self._parse_window_to_datetime(window)

        end_clause = "AND timestamp <= :end_time" if end_time else ""

        sentiment_query = text(f"""
            SELECT timestamp, sentiment_score FROM asset_sentiment_view
            WHERE asset = :asset AND timestamp >= :start_time {end_clause}
        """)

        volume_query = text(f"""
            SELECT timestamp, volume FROM asset_volume_view
            WHERE asset = :asset AND timestamp >= :start_time {end_clause}
        """)

        volatility_query = text(f"""
            SELECT timestamp, volatility FROM asset_volatility_view
            WHERE asset = :asset AND timestamp >= :start_time {end_clause}
        """)

        conn = self.db.connection()
        try:
            params = {"asset": asset, "start_time": start_time}
            if end_time:
                params["end_time"] = end_time
            sentiment_df = pd.read_sql(sentiment_query, conn, params=params)
            volume_df = pd.read_sql(volume_query, conn, params=params)
            volatility_df = pd.read_sql(volatility_query, conn, params=params)
        except Exception:
            sentiment_df = pd.DataFrame()
            volume_df = pd.DataFrame()
            volatility_df = pd.DataFrame()

        # Ensure all dataframes have the right columns before merging
        sentiment_df = self._ensure_columns(sentiment_df, "sentiment_score")
        volume_df = self._ensure_columns(volume_df, "volume")
        volatility_df = self._ensure_columns(volatility_df, "volatility")

        # Merge using outer joins to align time series and preserve column names
        features_df = pd.merge(sentiment_df, volume_df, on="timestamp", how="outer")
        features_df = pd.merge(features_df, volatility_df, on="timestamp", how="outer")

        # If no actual data exists, return empty DataFrame with correct headers
        if features_df.empty:
            return self._stamp_schema(features_df)

        # Clean up the merged dataset (sort by time, forward fill missing values)
        features_df = clean_time_series(
            features_df,
            timestamp_col="timestamp",
            sort=True,
            ffill=True,
            fillna_zero=True,
        )

        return self._stamp_schema(features_df)
