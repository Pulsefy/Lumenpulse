"""
Predictive analytics: forecast market trends (Bullish/Bearish) for the next 24-48 hours
using historical sentiment and volume data from analytics.jsonl.

Sentiment Velocity = rate of sentiment change per hour (dS/dt of mood).

Backend selection (auto-detected at runtime):
  - Prophet (Meta)  — preferred; installed via ``pip install prophet``
  - scikit-learn Ridge regression — always available (already in requirements)
  - Heuristic decay — final fallback when data < 3 points
"""

import json
import os
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from src.analytics.market_analyzer import Trend
from src.utils.logger import setup_logger

logger = setup_logger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────

_DEFAULT_JSONL = Path(os.getenv("ANALYTICS_JSONL_PATH", "./data/analytics.jsonl"))

BULLISH_THRESHOLD = 0.2
BEARISH_THRESHOLD = -0.2

# Minimum rows required to fit a statistical model
_MIN_TRAINING_POINTS = 3


# ── Output type ───────────────────────────────────────────────────────────


@dataclass
class ForecastResult:
    """Market trend forecast for the next 24 h and 48 h."""

    predicted_trend_24h: str      # "bullish" | "bearish" | "neutral"
    predicted_trend_48h: str
    confidence_24h: float         # 0.0 – 1.0
    confidence_48h: float
    sentiment_velocity: float     # Δsentiment per hour (positive → accelerating bullish)
    forecast_score_24h: float     # predicted market health score at T+24 h
    forecast_score_48h: float     # predicted market health score at T+48 h
    model_backend: str            # "prophet" | "sklearn" | "heuristic"
    data_points_used: int
    generated_at: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ── Helpers ───────────────────────────────────────────────────────────────


def _classify_trend(score: float) -> str:
    """Map a health score to a Trend label."""
    if score > BULLISH_THRESHOLD:
        return Trend.BULLISH.value
    if score < BEARISH_THRESHOLD:
        return Trend.BEARISH.value
    return Trend.NEUTRAL.value


def _confidence_from_score(score: float) -> float:
    """
    Translate the magnitude of a predicted score to a 0–1 confidence value.

    Near the neutral band (±0.2) → low confidence (~0.5).
    Strongly bullish/bearish (±1.0) → high confidence (~0.95).
    """
    abs_score = abs(score)
    if abs_score <= BULLISH_THRESHOLD:
        # Linear scale within neutral band: 0.30 … 0.50
        return round(0.30 + (abs_score / BULLISH_THRESHOLD) * 0.20, 3)
    # Sigmoid-like growth beyond neutral band
    return round(min(0.95, 0.50 + (abs_score - BULLISH_THRESHOLD) * 0.75), 3)


# ── Main class ────────────────────────────────────────────────────────────


class SentimentForecaster:
    """
    Forecasts sentiment-based market health scores 24 h and 48 h ahead.

    Typical usage::

        forecaster = SentimentForecaster()
        df = forecaster.load_history()
        metrics = forecaster.train(df)
        result = forecaster.predict(df)

    Or as a one-liner::

        result = SentimentForecaster().run()
    """

    MODEL_TYPE = "sentiment_forecaster"

    def __init__(self, jsonl_path: Optional[Path] = None) -> None:
        self.jsonl_path: Path = Path(jsonl_path) if jsonl_path else _DEFAULT_JSONL
        self._model_24h = None   # fitted model / Prophet instance
        self._model_48h = None   # separate ridge for 48 h (sklearn path)
        self._backend: str = "heuristic"
        self._is_trained: bool = False

    # ── Data loading ──────────────────────────────────────────────────────

    def load_history(self, path: Optional[Path] = None) -> pd.DataFrame:
        """
        Parse *analytics.jsonl* into a time-indexed DataFrame.

        Columns:
            timestamp, sentiment_score, news_count,
            positive_pct, negative_pct, neutral_pct
        """
        jsonl_path = Path(path) if path else self.jsonl_path

        if not jsonl_path.exists():
            logger.warning(
                f"analytics.jsonl not found at {jsonl_path}; returning empty DataFrame"
            )
            return pd.DataFrame()

        records: List[Dict[str, Any]] = []
        with open(jsonl_path) as fh:
            for raw in fh:
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    entry = json.loads(raw)
                    sd = entry.get("sentiment_data", {})
                    dist = sd.get("sentiment_distribution", {})
                    records.append(
                        {
                            "timestamp": pd.to_datetime(entry["timestamp"]),
                            "sentiment_score": float(
                                sd.get("average_compound_score", 0.0)
                            ),
                            "news_count": int(entry.get("news_count", 0)),
                            "positive_pct": float(dist.get("positive", 0.0)),
                            "negative_pct": float(dist.get("negative", 0.0)),
                            "neutral_pct": float(dist.get("neutral", 1.0)),
                        }
                    )
                except (KeyError, ValueError, json.JSONDecodeError) as exc:
                    logger.warning(f"Skipping malformed analytics line: {exc}")

        if not records:
            logger.warning("analytics.jsonl contained no valid entries")
            return pd.DataFrame()

        df = (
            pd.DataFrame(records)
            .sort_values("timestamp")
            .reset_index(drop=True)
        )
        logger.info(f"Loaded {len(df)} data points from {jsonl_path}")
        return df

    # ── Sentiment velocity ────────────────────────────────────────────────

    @staticmethod
    def compute_sentiment_velocity(
        df: pd.DataFrame, window: int = 5
    ) -> float:
        """
        Compute how fast sentiment is changing (Δsentiment / Δhours).

        Positive → mood is becoming more bullish.
        Negative → mood is turning more bearish.

        Uses the most recent *window* records; returns 0.0 when there
        are fewer than 2 data points.
        """
        if df is None or len(df) < 2:
            return 0.0

        recent = df.tail(window)
        if len(recent) < 2:
            return 0.0

        delta_s = (
            recent["sentiment_score"].iloc[-1] - recent["sentiment_score"].iloc[0]
        )
        delta_h = (
            (recent["timestamp"].iloc[-1] - recent["timestamp"].iloc[0])
            .total_seconds()
            / 3600.0
        )

        if delta_h < 1e-6:
            return 0.0

        return round(delta_s / delta_h, 6)

    # ── Training ──────────────────────────────────────────────────────────

    def train(self, df: pd.DataFrame) -> Dict[str, Any]:
        """
        Fit the forecasting model on historical data.

        Returns a metrics dict describing what was trained and how well.
        If data is too sparse the forecaster silently falls back to the
        heuristic decay method — this is reflected in the ``backend`` key.
        """
        if df is None or len(df) < 2:
            logger.warning(
                "Insufficient data for model training; using heuristic fallback"
            )
            self._is_trained = False
            return {"backend": "heuristic", "n_points": 0}

        if self._try_train_prophet(df):
            return {"backend": "prophet", "n_points": len(df)}

        return self._train_sklearn(df)

    # ── Prophet backend ───────────────────────────────────────────────────

    def _try_train_prophet(self, df: pd.DataFrame) -> bool:
        """Attempt Prophet training. Returns True on success, False otherwise."""
        try:
            from prophet import Prophet  # type: ignore  # noqa: F401
        except ImportError:
            logger.debug("prophet not installed — skipping Prophet backend")
            return False

        if len(df) < _MIN_TRAINING_POINTS:
            logger.info(
                f"Too few points ({len(df)}) for Prophet; "
                f"need >= {_MIN_TRAINING_POINTS}"
            )
            return False

        try:
            from prophet import Prophet  # type: ignore

            df_p = df[["timestamp", "sentiment_score"]].rename(
                columns={"timestamp": "ds", "sentiment_score": "y"}
            )
            m = Prophet(
                daily_seasonality=len(df) >= 24,
                weekly_seasonality=len(df) >= 168,
                changepoint_prior_scale=0.05,
                interval_width=0.80,
            )
            m.fit(df_p)
            self._model_24h = m
            self._model_48h = m  # single Prophet model, different horizons
            self._backend = "prophet"
            self._is_trained = True
            logger.info("SentimentForecaster trained with Prophet backend")
            return True
        except Exception as exc:
            logger.warning(f"Prophet training failed ({exc}); falling back to sklearn")
            return False

    # ── sklearn backend ───────────────────────────────────────────────────

    def _train_sklearn(self, df: pd.DataFrame) -> Dict[str, Any]:
        """Train separate Ridge pipelines for the 24 h and 48 h horizons."""
        from sklearn.linear_model import Ridge
        from sklearn.pipeline import Pipeline
        from sklearn.preprocessing import StandardScaler

        n = len(df)
        features, targets_24h, targets_48h = self._build_training_samples(df)

        if len(features) < 2:
            self._is_trained = False
            self._backend = "heuristic"
            logger.warning("Not enough training samples for sklearn; using heuristic")
            return {"backend": "heuristic", "n_points": n, "r2_24h": None, "r2_48h": None}

        X = np.array(features)
        y24 = np.array(targets_24h)
        y48 = np.array(targets_48h)

        pipe24 = Pipeline([("scaler", StandardScaler()), ("ridge", Ridge(alpha=1.0))])
        pipe48 = Pipeline([("scaler", StandardScaler()), ("ridge", Ridge(alpha=1.0))])

        pipe24.fit(X, y24)
        pipe48.fit(X, y48)

        r2_24h = float(pipe24.score(X, y24))
        r2_48h = float(pipe48.score(X, y48))

        self._model_24h = pipe24
        self._model_48h = pipe48
        self._backend = "sklearn"
        self._is_trained = True

        logger.info(
            f"SentimentForecaster trained with sklearn | "
            f"R²_24h={r2_24h:.3f}  R²_48h={r2_48h:.3f}  n={n}"
        )
        return {
            "backend": "sklearn",
            "n_points": n,
            "r2_24h": round(r2_24h, 4),
            "r2_48h": round(r2_48h, 4),
        }

    @staticmethod
    def _build_training_samples(
        df: pd.DataFrame,
    ) -> Tuple[List[List[float]], List[float], List[float]]:
        """
        Build (X, y_24h, y_48h) training arrays.

        For each row *i*, the target is the sentiment_score at the row
        closest to T+24 h (resp. T+48 h).  When those future rows do not
        exist the last available row is used (boundary clamping).
        """
        n = len(df)

        # Estimate typical interval between records
        if n >= 2:
            median_h = float(
                df["timestamp"].diff().dropna().dt.total_seconds().median() / 3600.0
            )
        else:
            median_h = 1.0

        step_24h = max(1, round(24.0 / max(median_h, 0.01)))
        step_48h = max(1, round(48.0 / max(median_h, 0.01)))

        features: List[List[float]] = []
        targets_24h: List[float] = []
        targets_48h: List[float] = []

        for i in range(n):
            # Rolling 3-row velocity window
            w_start = max(0, i - 2)
            sub = df.iloc[w_start : i + 1]
            if len(sub) >= 2:
                ds = sub["sentiment_score"].iloc[-1] - sub["sentiment_score"].iloc[0]
                dh = (
                    sub["timestamp"].iloc[-1] - sub["timestamp"].iloc[0]
                ).total_seconds() / 3600.0
                vel = ds / max(dh, 1e-6)
            else:
                vel = 0.0

            row = df.iloc[i]
            features.append(
                [
                    float(i),                               # time index (captures trend)
                    float(row["sentiment_score"]),
                    float(vel),
                    float(row["positive_pct"]),
                    float(row["negative_pct"]),
                    float(row["news_count"]) / 100.0,       # rough normalisation
                ]
            )
            targets_24h.append(
                float(df["sentiment_score"].iloc[min(i + step_24h, n - 1)])
            )
            targets_48h.append(
                float(df["sentiment_score"].iloc[min(i + step_48h, n - 1)])
            )

        return features, targets_24h, targets_48h

    # ── Prediction ────────────────────────────────────────────────────────

    def predict(self, df: pd.DataFrame) -> ForecastResult:
        """
        Return 24 h and 48 h market trend forecasts.

        Falls back gracefully when the model is not trained or data is sparse.
        """
        velocity = self.compute_sentiment_velocity(df)
        n = len(df) if df is not None else 0

        if self._is_trained and self._backend == "prophet":
            score_24h, score_48h = self._predict_prophet(df)
        elif self._is_trained and self._backend == "sklearn":
            score_24h, score_48h = self._predict_sklearn(df, velocity)
        else:
            score_24h, score_48h = self._predict_heuristic(df, velocity)

        # Keep scores within valid bounds
        score_24h = max(-1.0, min(1.0, score_24h))
        score_48h = max(-1.0, min(1.0, score_48h))

        return ForecastResult(
            predicted_trend_24h=_classify_trend(score_24h),
            predicted_trend_48h=_classify_trend(score_48h),
            confidence_24h=_confidence_from_score(score_24h),
            confidence_48h=_confidence_from_score(score_48h),
            sentiment_velocity=velocity,
            forecast_score_24h=round(score_24h, 4),
            forecast_score_48h=round(score_48h, 4),
            model_backend=self._backend,
            data_points_used=n,
            generated_at=datetime.now(timezone.utc).isoformat(),
        )

    def _predict_prophet(
        self, df: pd.DataFrame
    ) -> Tuple[float, float]:
        if self._model_24h is None or df is None or df.empty:
            return self._predict_heuristic(df)

        m = self._model_24h
        future = m.make_future_dataframe(periods=48, freq="h", include_history=False)
        forecast = m.predict(future)

        if len(forecast) >= 48:
            return float(forecast["yhat"].iloc[23]), float(forecast["yhat"].iloc[47])
        if len(forecast) >= 24:
            return float(forecast["yhat"].iloc[23]), float(forecast["yhat"].iloc[-1])
        if len(forecast) > 0:
            val = float(forecast["yhat"].iloc[-1])
            return val, val

        return self._predict_heuristic(df)

    def _predict_sklearn(
        self, df: pd.DataFrame, velocity: float
    ) -> Tuple[float, float]:
        if self._model_24h is None or self._model_48h is None:
            return self._predict_heuristic(df, velocity)

        n = len(df)
        row = df.iloc[-1]
        X = np.array(
            [[
                float(n),
                float(row["sentiment_score"]),
                float(velocity),
                float(row["positive_pct"]),
                float(row["negative_pct"]),
                float(row["news_count"]) / 100.0,
            ]]
        )
        return float(self._model_24h.predict(X)[0]), float(self._model_48h.predict(X)[0])

    @staticmethod
    def _predict_heuristic(
        df: Optional[pd.DataFrame] = None, velocity: float = 0.0
    ) -> Tuple[float, float]:
        """
        Extrapolate current sentiment using velocity with exponential decay.

        score(T+h) ≈ current + velocity × Σ_{t=0}^{h-1} decay^t

        The decay factor prevents the extrapolation from diverging when
        velocity is large and history is short.
        """
        if df is None or len(df) == 0:
            return 0.0, 0.0

        current = float(df["sentiment_score"].iloc[-1])
        decay = 0.85  # velocity impact halves roughly every ~4 h
        score_24h = current + velocity * float(sum(decay ** t for t in range(24)))
        score_48h = current + velocity * float(sum(decay ** t for t in range(48)))
        return score_24h, score_48h

    # ── Model persistence ─────────────────────────────────────────────────

    def save(self) -> str:
        """Persist the trained forecaster to the model registry and promote it."""
        from src.ml.model_registry import promote_model, save_model

        version = save_model(self.MODEL_TYPE, self)
        promote_model(self.MODEL_TYPE, version)
        logger.info(f"SentimentForecaster saved and promoted: {version}")
        return version

    @classmethod
    def load(cls) -> "SentimentForecaster":
        """Load the currently promoted forecaster from the model registry."""
        from src.ml.model_registry import get_live_model

        obj = get_live_model(cls.MODEL_TYPE)
        if not isinstance(obj, cls):
            raise TypeError(
                f"Registry returned unexpected type for '{cls.MODEL_TYPE}': {type(obj)}"
            )
        logger.info("SentimentForecaster loaded from model registry")
        return obj

    # ── Convenience ───────────────────────────────────────────────────────

    def run(self, jsonl_path: Optional[Path] = None) -> ForecastResult:
        """
        One-call shortcut: load history → train (if needed) → predict.

        Safe to call repeatedly — reuses an existing trained model.
        """
        df = self.load_history(jsonl_path)
        if not self._is_trained:
            self.train(df)
        return self.predict(df)
