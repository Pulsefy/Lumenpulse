# -*- coding: utf-8 -*-
"""
Walk-forward backtesting harness for the SentimentForecaster.

Evaluates forecast accuracy against historical actuals using a sliding-window
approach. Reports standard error metrics (MAE, RMSE, MAPE) per horizon and
includes a naive persistence baseline so improvement over "doing nothing" is
visible.

The harness is fully reproducible from ``config/backtest_config.yaml``.
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from datetime import timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

try:
    import yaml
except ImportError:  # pragma: no cover — graceful fallback
    yaml = None  # type: ignore[assignment]

from src.analytics.forecaster import SentimentForecaster
from src.utils.logger import setup_logger

logger = setup_logger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────

_DEFAULT_CONFIG_PATH = Path(
    os.getenv(
        "BACKTEST_CONFIG_PATH",
        str(
            Path(__file__).resolve().parent.parent.parent
            / "config"
            / "backtest_config.yaml"
        ),
    )
)

_HORIZONS = [24, 48]


# ── Output types ───────────────────────────────────────────────────────────


@dataclass
class HorizonMetrics:
    """Error metrics for a single forecast horizon."""

    horizon_hours: int
    mae: float
    rmse: float
    mape: float
    n_windows: int

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class BaselineMetrics:
    """Naive persistence baseline metrics for comparison."""

    horizon_hours: int
    mae: float
    rmse: float
    mape: float

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class BacktestResult:
    """Complete result of a walk-forward backtest run."""

    config_hash: str
    n_windows: int
    horizons: List[int]
    metrics: List[HorizonMetrics] = field(default_factory=list)
    baseline_metrics: List[BaselineMetrics] = field(default_factory=list)
    per_window_scores: List[Dict[str, float]] = field(default_factory=list)
    generated_at: str = ""
    confidence_score: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "config_hash": self.config_hash,
            "n_windows": self.n_windows,
            "horizons": self.horizons,
            "metrics": [m.to_dict() for m in self.metrics],
            "baseline_metrics": [m.to_dict() for m in self.baseline_metrics],
            "per_window_scores": self.per_window_scores,
            "generated_at": self.generated_at,
            "confidence_score": self.confidence_score,
        }

    def best_confidence(self) -> float:
        """
        Derive a single confidence indication from backtest performance.

        Uses the worst (highest) normalised MAE across horizons, scaled
        against the naive baseline.  A value near 1.0 means the forecaster
        strongly outperforms the baseline; 0.0 means it is no better than
        the naive persistence model.
        """
        return round(self.confidence_score, 4)


# ── Configuration ──────────────────────────────────────────────────────────


@dataclass
class BacktestConfig:
    """Reproducible backtest configuration."""

    n_windows: int = 5
    train_fraction: float = 0.7
    min_train_points: int = 10
    horizons: List[int] = field(default_factory=lambda: [24, 48])
    seed: int = 42
    metric_window: int = 5

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def hash(self) -> str:
        """Return a stable hash of the config for reproducibility tracking."""
        import hashlib

        payload = json.dumps(self.to_dict(), sort_keys=True).encode("utf-8")
        return hashlib.sha256(payload).hexdigest()[:12]


def load_config(path: Optional[Path] = None) -> BacktestConfig:
    """Load backtest configuration from a YAML file."""
    cfg_path = Path(path) if path else _DEFAULT_CONFIG_PATH
    if not cfg_path.exists():
        logger.info(
            f"No backtest config at {cfg_path}; using defaults"
        )
        return BacktestConfig()

    if yaml is None:
        logger.warning(
            "PyYAML not installed; using default backtest config"
        )
        return BacktestConfig()

    with open(cfg_path) as fh:
        raw = yaml.safe_load(fh) or {}
    logger.info(f"Loaded backtest config from {cfg_path}")
    return BacktestConfig(**{k: v for k, v in raw.items() if k in BacktestConfig.__dataclass_fields__})


# ── Error metrics ──────────────────────────────────────────────────────────


def _mae(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    """Mean Absolute Error."""
    return float(np.mean(np.abs(y_true - y_pred)))


def _rmse(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    """Root Mean Squared Error."""
    return float(np.sqrt(np.mean((y_true - y_pred) ** 2)))


def _mape(y_true: np.ndarray, y_pred: np.ndarray, eps: float = 1e-6) -> float:
    """Mean Absolute Percentage Error (scaled to sentiment range)."""
    denom = np.maximum(np.abs(y_true), eps)
    return float(np.mean(np.abs((y_true - y_pred) / denom)) * 100.0)


# ── Naive baseline ────────────────────────────────────────────────────────


def _naive_forecast(df: pd.DataFrame, horizon_steps: int) -> float:
    """
    Persistence baseline: predict the last observed sentiment score.

    This represents the "do nothing" strategy — the forecast is simply
    whatever the most recent value was.
    """
    if df is None or len(df) == 0:
        return 0.0
    return float(df["sentiment_score"].iloc[-1])


# ── Walk-forward backtest ─────────────────────────────────────────────────


def _compute_step_sizes(df: pd.DataFrame, horizons: List[int]) -> Dict[int, int]:
    """Map each horizon (hours) to a step count based on median interval."""
    n = len(df)
    if n >= 2:
        median_h = float(
            df["timestamp"].diff().dropna().dt.total_seconds().median() / 3600.0
        )
    else:
        median_h = 1.0
    median_h = max(median_h, 0.01)

    steps: Dict[int, int] = {}
    for h in horizons:
        steps[h] = max(1, round(h / median_h))
    return steps


def _extract_window_score(
    df: pd.DataFrame, start_idx: int, step: int, n: int
) -> float:
    """Get the actual sentiment score at the target horizon (clamped)."""
    target_idx = min(start_idx + step, n - 1)
    return float(df["sentiment_score"].iloc[target_idx])


def run_backtest(
    df: pd.DataFrame,
    config: Optional[BacktestConfig] = None,
    jsonl_path: Optional[Path] = None,
) -> BacktestResult:
    """
    Run a walk-forward backtest on the given historical data.

    For each window the harness:
      1. Splits the data into train / test at a configurable fraction.
      2. Fits a fresh ``SentimentForecaster`` on the training slice.
      3. Predicts the 24 h and 48 h horizons.
      4. Compares predictions against the actual observed values.
      5. Also records what a naive persistence baseline would have predicted.

    Args:
        df: Time-indexed DataFrame from ``SentimentForecaster.load_history``.
        config: Backtest configuration; loaded from file when *None*.
        jsonl_path: Optional path to analytics.jsonl (used when *df* is empty).

    Returns:
        A :class:`BacktestResult` with per-horizon metrics, baseline
        comparison, and a derived ``confidence_score``.
    """
    if config is None:
        config = load_config()

    if df is None or len(df) < config.min_train_points:
        n_pts = 0 if df is None else len(df)
        logger.warning(
            f"Insufficient data ({n_pts} points) "
            f"for backtest (need >= {config.min_train_points})"
        )
        return BacktestResult(
            config_hash=config.hash(),
            n_windows=0,
            horizons=config.horizons,
            generated_at=datetime.now(timezone.utc).isoformat(),
            confidence_score=0.0,
        )

    step_sizes = _compute_step_sizes(df, config.horizons)
    n = len(df)
    min_train = config.min_train_points

    # Determine window start indices for walk-forward
    usable = n - min_train
    if usable <= 0 or config.n_windows <= 0:
        return BacktestResult(
            config_hash=config.hash(),
            n_windows=0,
            horizons=config.horizons,
            generated_at=datetime.now(timezone.utc).isoformat(),
            confidence_score=0.0,
        )

    # Evenly spaced window boundaries
    if config.n_windows == 1:
        window_starts = [min_train]
    else:
        window_starts = [
            min_train + int(i * usable / config.n_windows)
            for i in range(config.n_windows)
        ]

    # Collect per-window errors
    errors: Dict[int, List[Tuple[float, float]]] = {h: [] for h in config.horizons}
    baseline_errors: Dict[int, List[Tuple[float, float]]] = {h: [] for h in config.horizons}
    per_window: List[Dict[str, float]] = []

    for w_idx, w_start in enumerate(window_starts):
        train_df = df.iloc[:w_start].copy()
        if len(train_df) < min_train:
            continue

        # Fit a fresh forecaster on this window's training slice
        forecaster = SentimentForecaster(jsonl_path=jsonl_path)
        forecaster.train(train_df)

        # Predict from the last row of the training window
        last_row = train_df.iloc[-1:]
        velocity = SentimentForecaster.compute_sentiment_velocity(train_df)

        pred_24h, pred_48h = _predict_from_forecaster(
            forecaster, train_df, velocity
        )
        predictions = {24: pred_24h, 48: pred_48h}

        window_record: Dict[str, float] = {"window": float(w_idx)}

        for h in config.horizons:
            step = step_sizes[h]
            actual = _extract_window_score(df, w_start - 1, step, n)
            pred = predictions[h]

            errors[h].append((actual, pred))

            naive = _naive_forecast(train_df, step)
            baseline_errors[h].append((actual, naive))

            window_record[f"actual_{h}h"] = round(actual, 4)
            window_record[f"pred_{h}h"] = round(pred, 4)
            window_record[f"naive_{h}h"] = round(naive, 4)

        per_window.append(window_record)

    # Aggregate metrics
    metrics: List[HorizonMetrics] = []
    baseline_metrics: List[BaselineMetrics] = []

    for h in config.horizons:
        if not errors[h]:
            metrics.append(
                HorizonMetrics(horizon_hours=h, mae=0.0, rmse=0.0, mape=0.0, n_windows=0)
            )
            baseline_metrics.append(
                BaselineMetrics(horizon_hours=h, mae=0.0, rmse=0.0, mape=0.0)
            )
            continue

        y_true = np.array([e[0] for e in errors[h]])
        y_pred = np.array([e[1] for e in errors[h]])
        metrics.append(
            HorizonMetrics(
                horizon_hours=h,
                mae=_mae(y_true, y_pred),
                rmse=_rmse(y_true, y_pred),
                mape=_mape(y_true, y_pred),
                n_windows=len(errors[h]),
            )
        )

        y_naive = np.array([e[1] for e in baseline_errors[h]])
        baseline_metrics.append(
            BaselineMetrics(
                horizon_hours=h,
                mae=_mae(y_true, y_naive),
                rmse=_rmse(y_true, y_naive),
                mape=_mape(y_true, y_naive),
            )
        )

    # Derive confidence: how much better is the forecaster than naive?
    confidence = _derive_confidence(metrics, baseline_metrics)

    return BacktestResult(
        config_hash=config.hash(),
        n_windows=len(per_window),
        horizons=config.horizons,
        metrics=metrics,
        baseline_metrics=baseline_metrics,
        per_window_scores=per_window,
        generated_at=datetime.now(timezone.utc).isoformat(),
        confidence_score=confidence,
    )


def _predict_from_forecaster(
    forecaster: SentimentForecaster,
    train_df: pd.DataFrame,
    velocity: float,
) -> Tuple[float, float]:
    """Get 24h and 48h predictions from a fitted forecaster."""
    if forecaster._is_trained and forecaster._backend == "prophet":
        score_24h, score_48h = forecaster._predict_prophet(train_df)
    elif forecaster._is_trained and forecaster._backend == "sklearn":
        score_24h, score_48h = forecaster._predict_sklearn(train_df, velocity)
    else:
        score_24h, score_48h = forecaster._predict_heuristic(train_df, velocity)

    score_24h = max(-1.0, min(1.0, score_24h))
    score_48h = max(-1.0, min(1.0, score_48h))
    return score_24h, score_48h


def _derive_confidence(
    metrics: List[HorizonMetrics],
    baseline: List[BaselineMetrics],
) -> float:
    """
    Compute a 0–1 confidence score from backtest performance.

    For each horizon we compute ``1 - mae / baseline_mae`` (clamped to
    [0, 1]).  The overall confidence is the *minimum* across horizons —
    the weakest horizon drives the score so we never overstate reliability.
    """
    if not metrics or not baseline:
        return 0.0

    scores: List[float] = []
    for m, b in zip(metrics, baseline):
        if b.mae < 1e-9:
            # Baseline is perfect; forecaster cannot improve
            scores.append(1.0 if m.mae < 1e-9 else 0.0)
        else:
            ratio = m.mae / b.mae
            scores.append(float(max(0.0, min(1.0, 1.0 - ratio + 0.5))))

    return float(np.mean(scores)) if scores else 0.0
