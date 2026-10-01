# -*- coding: utf-8 -*-
"""
Walk-forward backtesting harness for SentimentForecaster.

Evaluates forecasts against historical actuals over rolling windows,
computes MAE, RMSE, and MAPE per horizon, and includes a naive baseline
(last-value carry-forward) so we can see improvement over doing nothing.

Usage::

    from src.analytics.backtester import BacktestHarness
    from src.analytics.backtester import load_config

    cfg = load_config()          # reads config/backtest.yaml
    harness = BacktestHarness(cfg)
    report = harness.run(df)
    print(report.summary())
"""

import math
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
import yaml

from src.utils.logger import setup_logger

logger = setup_logger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

_DEFAULT_CONFIG_PATH = Path(
    os.getenv(
        "BACKTEST_CONFIG_PATH",
        str(Path(__file__).parent.parent.parent / "config" / "backtest.yaml"),
    )
)


@dataclass
class BacktestConfig:
    """Reproducible configuration for a walk-forward backtest."""

    # Walk-forward parameters
    initial_train_size: int = 20
    step_size: int = 1  # rows to advance each fold
    horizons: List[int] = field(default_factory=lambda: [24, 48])  # hours ahead

    # Quality thresholds (used to derive API confidence indication)
    mae_good_threshold: float = 0.10   # MAE <= this → HIGH confidence
    mae_warn_threshold: float = 0.25   # MAE <= this → MEDIUM, else LOW

    # Seed for any randomised operations
    random_seed: int = 42


def load_config(path: Optional[Path] = None) -> BacktestConfig:
    """Load BacktestConfig from a YAML file, with defaults if file missing."""
    config_path = Path(path) if path else _DEFAULT_CONFIG_PATH
    if not config_path.exists():
        logger.warning(
            f"Backtest config not found at {config_path}; using defaults."
        )
        return BacktestConfig()

    with open(config_path) as fh:
        data = yaml.safe_load(fh) or {}

    return BacktestConfig(
        initial_train_size=int(data.get("initial_train_size", 20)),
        step_size=int(data.get("step_size", 1)),
        horizons=list(data.get("horizons", [24, 48])),
        mae_good_threshold=float(data.get("mae_good_threshold", 0.10)),
        mae_warn_threshold=float(data.get("mae_warn_threshold", 0.25)),
        random_seed=int(data.get("random_seed", 42)),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Error metrics
# ─────────────────────────────────────────────────────────────────────────────


def mae(actuals: List[float], predictions: List[float]) -> float:
    """Mean Absolute Error."""
    if not actuals:
        return float("nan")
    return float(np.mean(np.abs(np.array(actuals) - np.array(predictions))))


def rmse(actuals: List[float], predictions: List[float]) -> float:
    """Root Mean Squared Error."""
    if not actuals:
        return float("nan")
    return float(np.sqrt(np.mean((np.array(actuals) - np.array(predictions)) ** 2)))


def mape(actuals: List[float], predictions: List[float]) -> float:
    """
    Mean Absolute Percentage Error.

    Rows where |actual| < 1e-6 are excluded to avoid division-by-zero;
    returns NaN when all rows are excluded.
    """
    a = np.array(actuals)
    p = np.array(predictions)
    mask = np.abs(a) >= 1e-6
    if not np.any(mask):
        return float("nan")
    return float(np.mean(np.abs((a[mask] - p[mask]) / a[mask])) * 100.0)


# ─────────────────────────────────────────────────────────────────────────────
# Result types
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class HorizonMetrics:
    """Error metrics for a single forecast horizon."""

    horizon_h: int           # hours ahead (e.g. 24 or 48)
    n_folds: int             # number of walk-forward folds evaluated
    mae: float
    rmse: float
    mape: float              # percent; may be NaN
    baseline_mae: float      # naive last-value baseline MAE
    baseline_rmse: float
    improvement_pct: float   # (baseline_mae - model_mae) / baseline_mae * 100

    def to_dict(self) -> Dict[str, Any]:
        return {
            "horizon_h": self.horizon_h,
            "n_folds": self.n_folds,
            "mae": round(self.mae, 6),
            "rmse": round(self.rmse, 6),
            "mape": round(self.mape, 4) if not math.isnan(self.mape) else None,
            "baseline_mae": round(self.baseline_mae, 6),
            "baseline_rmse": round(self.baseline_rmse, 6),
            "improvement_pct": round(self.improvement_pct, 2),
        }


@dataclass
class BacktestReport:
    """Full report produced by BacktestHarness.run()."""

    horizons: Dict[int, HorizonMetrics]   # keyed by horizon in hours
    confidence_indication: str            # "high" | "medium" | "low"
    config: BacktestConfig
    n_total_rows: int
    n_folds_run: int

    def summary(self) -> str:
        lines = ["=== Backtest Report ==="]
        lines.append(f"Rows: {self.n_total_rows}  Folds: {self.n_folds_run}")
        lines.append(f"Confidence indication: {self.confidence_indication.upper()}")
        for h, m in sorted(self.horizons.items()):
            lines.append(
                f"  {h:>3}h | MAE={m.mae:.4f}  RMSE={m.rmse:.4f}  "
                f"MAPE={m.mape:.2f}%  Improvement={m.improvement_pct:+.1f}%"
                if not math.isnan(m.mape)
                else f"  {h:>3}h | MAE={m.mae:.4f}  RMSE={m.rmse:.4f}  "
                f"MAPE=N/A  Improvement={m.improvement_pct:+.1f}%"
            )
        return "\n".join(lines)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "horizons": {str(h): m.to_dict() for h, m in self.horizons.items()},
            "confidence_indication": self.confidence_indication,
            "n_total_rows": self.n_total_rows,
            "n_folds_run": self.n_folds_run,
        }


# ─────────────────────────────────────────────────────────────────────────────
# Harness
# ─────────────────────────────────────────────────────────────────────────────


class BacktestHarness:
    """
    Walk-forward backtesting harness for SentimentForecaster.

    Each fold:
      1. Trains the forecaster on ``df[:train_end]``.
      2. Predicts scores at each configured horizon.
      3. Looks up the actual value at that horizon offset.
      4. Also predicts with a naive baseline (last seen value).

    The number of folds is determined by how many rows remain after
    the initial training window, advancing by ``config.step_size`` each time.
    """

    def __init__(self, config: Optional[BacktestConfig] = None) -> None:
        self.config: BacktestConfig = config or load_config()

    # ── Public API ────────────────────────────────────────────────────────

    def run(self, df: pd.DataFrame) -> BacktestReport:
        """
        Execute a full walk-forward backtest.

        Parameters
        ----------
        df:
            Historical DataFrame produced by ``SentimentForecaster.load_history()``.
            Must have columns: ``timestamp``, ``sentiment_score``.

        Returns
        -------
        BacktestReport with per-horizon metrics and a derived confidence indication.
        """
        np.random.seed(self.config.random_seed)

        if df is None or df.empty:
            raise ValueError("BacktestHarness.run() requires a non-empty DataFrame.")

        n = len(df)
        required = self.config.initial_train_size + max(self.config.horizons, default=1)
        if n < required:
            raise ValueError(
                f"DataFrame has {n} rows but backtest needs at least {required} "
                f"(initial_train_size={self.config.initial_train_size} + "
                f"max_horizon={max(self.config.horizons)})."
            )

        # Collect (actual, model_pred, naive_pred) per horizon
        horizon_preds: Dict[int, Dict[str, List[float]]] = {
            h: {"actuals": [], "model": [], "naive": []}
            for h in self.config.horizons
        }

        train_end = self.config.initial_train_size
        folds_run = 0

        while train_end < n:
            train_df = df.iloc[:train_end].copy()

            # Estimate steps per horizon using median interval
            steps_per_h = self._estimate_steps_per_hour(train_df)

            for h in self.config.horizons:
                target_idx = train_end + round(h * steps_per_h) - 1
                if target_idx >= n:
                    continue  # not enough future rows for this fold/horizon

                actual = float(df["sentiment_score"].iloc[target_idx])
                model_pred = self._predict_model(train_df, h)
                naive_pred = self._predict_naive(train_df)

                horizon_preds[h]["actuals"].append(actual)
                horizon_preds[h]["model"].append(model_pred)
                horizon_preds[h]["naive"].append(naive_pred)

            folds_run += 1
            train_end += self.config.step_size

        # Build metrics per horizon
        metrics: Dict[int, HorizonMetrics] = {}
        for h, preds in horizon_preds.items():
            acts = preds["actuals"]
            if not acts:
                continue
            model_mae = mae(acts, preds["model"])
            model_rmse = rmse(acts, preds["model"])
            model_mape = mape(acts, preds["model"])
            base_mae = mae(acts, preds["naive"])
            base_rmse = rmse(acts, preds["naive"])
            improvement = (
                (base_mae - model_mae) / base_mae * 100.0
                if base_mae > 1e-9
                else 0.0
            )
            metrics[h] = HorizonMetrics(
                horizon_h=h,
                n_folds=len(acts),
                mae=model_mae,
                rmse=model_rmse,
                mape=model_mape,
                baseline_mae=base_mae,
                baseline_rmse=base_rmse,
                improvement_pct=improvement,
            )

        confidence = self._derive_confidence(metrics)
        return BacktestReport(
            horizons=metrics,
            confidence_indication=confidence,
            config=self.config,
            n_total_rows=n,
            n_folds_run=folds_run,
        )

    # ── Internals ─────────────────────────────────────────────────────────

    @staticmethod
    def _estimate_steps_per_hour(df: pd.DataFrame) -> float:
        """Estimate how many rows correspond to 1 hour in the time-series."""
        if len(df) < 2:
            return 1.0
        median_secs = float(
            df["timestamp"].diff().dropna().dt.total_seconds().median()
        )
        if median_secs < 1e-3:
            return 1.0
        return 3600.0 / median_secs

    def _predict_model(self, train_df: pd.DataFrame, horizon_h: int) -> float:
        """
        Train a fresh forecaster on *train_df* and return the predicted
        sentiment score at *horizon_h* hours ahead.
        """
        from src.analytics.forecaster import SentimentForecaster

        forecaster = SentimentForecaster()
        forecaster.train(train_df)
        result = forecaster.predict(train_df)

        if horizon_h <= 24:
            return result.forecast_score_24h
        return result.forecast_score_48h

    @staticmethod
    def _predict_naive(train_df: pd.DataFrame) -> float:
        """Naive baseline: carry the last observed value forward."""
        return float(train_df["sentiment_score"].iloc[-1])

    def _derive_confidence(self, metrics: Dict[int, HorizonMetrics]) -> str:
        """
        Derive overall API confidence indication from backtest MAE.

        Uses the primary horizon (first configured horizon, typically 24h).
        Falls back to 'low' when no metrics are available.
        """
        if not metrics:
            return "low"

        primary_h = min(metrics.keys())
        primary_mae = metrics[primary_h].mae

        if math.isnan(primary_mae):
            return "low"
        if primary_mae <= self.config.mae_good_threshold:
            return "high"
        if primary_mae <= self.config.mae_warn_threshold:
            return "medium"
        return "low"
