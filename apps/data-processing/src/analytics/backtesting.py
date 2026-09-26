# -*- coding: utf-8 -*-
"""
Walk-forward backtesting harness for SentimentForecaster.

Evaluates how well the forecaster predicts actual sentiment scores by
running a sequence of expanding-window (walk-forward) evaluations over
historical data.  Each window trains on a growing prefix of history and
then predicts the next N data points, which are compared to the actual
recorded values.

Public API
----------
BacktestConfig      — dataclass holding all tuning knobs (load from YAML)
BacktestWindow      — per-window raw metrics
BacktestResult      — aggregate across all windows + per-horizon breakdown
WalkForwardBacktester — orchestrator; call .run(df) to get a BacktestResult
load_backtest_config — factory: load a BacktestConfig from a YAML path

Typical usage::

    config = load_backtest_config("config/backtest_config.yaml")
    bt = WalkForwardBacktester(config)
    df = SentimentForecaster().load_history()
    result = bt.run(df)
    print(result.summary())
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Tuple

# pandas is a runtime dependency (always available in production) but the
# lightweight test environment stubs it.  Import lazily via TYPE_CHECKING so
# unit tests that don't need a real DataFrame can still run.
if TYPE_CHECKING:  # pragma: no cover
    import pandas as pd

from src.utils.logger import setup_logger

logger = setup_logger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────

_DEFAULT_CONFIG_PATH = Path("config/backtest_config.yaml")


# ── Configuration ──────────────────────────────────────────────────────────


@dataclass
class BacktestConfig:
    """All tunable parameters for a walk-forward backtest run.

    Attributes
    ----------
    min_train_points:
        Minimum rows in the expanding training window before the first
        evaluation fold begins.
    step_size:
        How many rows to advance the training window per fold.
    horizon_24h:
        Number of data-point steps that approximate 24 hours.
    horizon_48h:
        Number of data-point steps that approximate 48 hours.
    max_windows:
        Hard cap on total folds (0 = unlimited).
    random_seed:
        Seed passed to any stochastic components (e.g., Ridge solver) to
        ensure reproducibility.
    confidence_mae_threshold_good:
        MAE ≤ this value → "high" backtest_confidence tier.
    confidence_mae_threshold_ok:
        MAE ≤ this value → "medium" confidence tier (> good threshold).
        Anything above → "low".
    """

    min_train_points: int = 10
    step_size: int = 1
    horizon_24h: int = 1          # steps ≈ 24 h (adjusted automatically when possible)
    horizon_48h: int = 2          # steps ≈ 48 h
    max_windows: int = 0          # 0 = no cap
    random_seed: int = 42
    confidence_mae_threshold_good: float = 0.05
    confidence_mae_threshold_ok: float = 0.15


def load_backtest_config(path: Optional[Path] = None) -> BacktestConfig:
    """Load a :class:`BacktestConfig` from *path* (YAML).

    Falls back to :data:`_DEFAULT_CONFIG_PATH` when *path* is ``None``.
    Returns a default :class:`BacktestConfig` when the file does not exist
    so the harness is always usable without a config file.
    """
    target = Path(path) if path else _DEFAULT_CONFIG_PATH
    if not target.exists():
        logger.warning(
            f"Backtest config not found at {target}; using defaults"
        )
        return BacktestConfig()

    try:
        import yaml  # type: ignore
    except ImportError:
        # PyYAML not available — fall back to defaults
        logger.warning("PyYAML not installed; cannot load backtest config — using defaults")
        return BacktestConfig()

    with open(target) as fh:
        data: Dict[str, Any] = yaml.safe_load(fh) or {}

    bt_section = data.get("backtesting", data)  # support both flat and nested YAML
    cfg = BacktestConfig()
    for field_name in BacktestConfig.__dataclass_fields__:  # type: ignore[attr-defined]
        if field_name in bt_section:
            setattr(cfg, field_name, bt_section[field_name])
    return cfg


# ── Per-window metrics ─────────────────────────────────────────────────────


@dataclass
class BacktestWindow:
    """Metrics for a single walk-forward fold.

    Parameters
    ----------
    window_index:
        Zero-based fold number.
    train_size:
        Number of rows used to train this fold.
    mae_24h, rmse_24h, mape_24h:
        Forecast vs actuals for the 24-h horizon.
    mae_48h, rmse_48h, mape_48h:
        Forecast vs actuals for the 48-h horizon.
    naive_mae_24h, naive_mae_48h:
        Same metrics for the naïve (last-value) baseline.
    model_backend:
        Which forecasting backend was used ("prophet" | "sklearn" | "heuristic").
    """

    window_index: int
    train_size: int

    # Forecast metrics
    mae_24h: float
    rmse_24h: float
    mape_24h: float
    mae_48h: float
    rmse_48h: float
    mape_48h: float

    # Naive baseline metrics
    naive_mae_24h: float
    naive_mae_48h: float

    model_backend: str


# ── Aggregate result ───────────────────────────────────────────────────────


@dataclass
class BacktestResult:
    """Aggregate walk-forward backtest results over all folds.

    Attributes
    ----------
    windows:
        Per-fold detail records.
    mean_mae_24h, mean_rmse_24h, mean_mape_24h:
        Mean across folds for the 24-h horizon.
    mean_mae_48h, mean_rmse_48h, mean_mape_48h:
        Mean across folds for the 48-h horizon.
    mean_naive_mae_24h, mean_naive_mae_48h:
        Mean naïve baseline MAE.
    skill_score_24h, skill_score_48h:
        1 − (model_mae / naive_mae).  Positive → better than baseline.
    backtest_confidence:
        Categorical confidence level derived from mean_mae_24h:
        ``"high"`` | ``"medium"`` | ``"low"`` | ``"insufficient_data"``.
    n_windows:
        Total number of evaluated folds.
    config_snapshot:
        A copy of the :class:`BacktestConfig` parameters used so the
        result is fully reproducible.
    """

    windows: List[BacktestWindow] = field(default_factory=list)

    # 24h aggregates
    mean_mae_24h: float = float("nan")
    mean_rmse_24h: float = float("nan")
    mean_mape_24h: float = float("nan")

    # 48h aggregates
    mean_mae_48h: float = float("nan")
    mean_rmse_48h: float = float("nan")
    mean_mape_48h: float = float("nan")

    # Naive baseline
    mean_naive_mae_24h: float = float("nan")
    mean_naive_mae_48h: float = float("nan")

    # Skill scores
    skill_score_24h: float = float("nan")
    skill_score_48h: float = float("nan")

    # Confidence
    backtest_confidence: str = "insufficient_data"

    n_windows: int = 0
    config_snapshot: Dict[str, Any] = field(default_factory=dict)

    # ── Summary helpers ────────────────────────────────────────────────────

    def summary(self) -> str:
        """Return a human-readable multi-line summary string."""
        lines = [
            f"Walk-Forward Backtest Summary ({self.n_windows} windows)",
            f"  Confidence:       {self.backtest_confidence}",
            "",
            "  24-h horizon",
            f"    MAE:            {self.mean_mae_24h:.4f}",
            f"    RMSE:           {self.mean_rmse_24h:.4f}",
            f"    MAPE:           {self.mean_mape_24h:.2f}%",
            f"    Naïve MAE:      {self.mean_naive_mae_24h:.4f}",
            f"    Skill score:    {self.skill_score_24h:+.4f}",
            "",
            "  48-h horizon",
            f"    MAE:            {self.mean_mae_48h:.4f}",
            f"    RMSE:           {self.mean_rmse_48h:.4f}",
            f"    MAPE:           {self.mean_mape_48h:.2f}%",
            f"    Naïve MAE:      {self.mean_naive_mae_48h:.4f}",
            f"    Skill score:    {self.skill_score_48h:+.4f}",
        ]
        return "\n".join(lines)

    def to_dict(self) -> Dict[str, Any]:
        """Serialise to a plain dict (JSON-safe)."""
        d = asdict(self)
        # Replace NaN with None for JSON compatibility
        for k, v in d.items():
            if isinstance(v, float) and math.isnan(v):
                d[k] = None
        return d


# ── Metric helpers ─────────────────────────────────────────────────────────


def _mae(actuals: List[float], predictions: List[float]) -> float:
    if not actuals:
        return float("nan")
    errors = [abs(a - p) for a, p in zip(actuals, predictions)]
    return float(sum(errors) / len(errors))


def _rmse(actuals: List[float], predictions: List[float]) -> float:
    if not actuals:
        return float("nan")
    sq_errors = [(a - p) ** 2 for a, p in zip(actuals, predictions)]
    return float(math.sqrt(sum(sq_errors) / len(sq_errors)))


def _mape(actuals: List[float], predictions: List[float]) -> float:
    """Mean Absolute Percentage Error (%).

    Zero-actual entries are skipped to avoid division-by-zero.
    Returns ``nan`` when all actuals are zero.
    """
    pairs = [(a, p) for a, p in zip(actuals, predictions) if abs(a) > 1e-9]
    if not pairs:
        return float("nan")
    total = sum(abs((a - p) / abs(a)) for a, p in pairs)
    return float(total / len(pairs) * 100)


def _skill_score(model_mae: float, naive_mae: float) -> float:
    """Skill score: 1 − model_mae / naive_mae.

    Returns NaN when either input is NaN or naive_mae is zero.
    """
    if math.isnan(model_mae) or math.isnan(naive_mae) or naive_mae < 1e-12:
        return float("nan")
    return float(1.0 - model_mae / naive_mae)


# ── Main harness ───────────────────────────────────────────────────────────


class WalkForwardBacktester:
    """Walk-forward evaluator for :class:`~src.analytics.forecaster.SentimentForecaster`.

    Each fold:
    1. Trains a *fresh* :class:`SentimentForecaster` on rows ``[0 : train_end]``.
    2. Predicts the score at ``train_end + horizon_24h`` and
       ``train_end + horizon_48h`` (clamped to the last available row).
    3. Compares predictions to the actual recorded scores.
    4. Also computes the naïve forecast (last known value = forecast value).

    Parameters
    ----------
    config:
        :class:`BacktestConfig` controlling window sizes, horizons, and
        confidence thresholds.  Defaults to :func:`load_backtest_config`.
    """

    def __init__(self, config: Optional[BacktestConfig] = None) -> None:
        self.config: BacktestConfig = config or load_backtest_config()

    # ── Public entry point ─────────────────────────────────────────────────

    def run(self, df: pd.DataFrame) -> BacktestResult:
        """Execute the walk-forward backtest on *df*.

        Parameters
        ----------
        df:
            Time-indexed DataFrame as returned by
            :meth:`SentimentForecaster.load_history`.  Must contain at
            least the columns ``timestamp`` and ``sentiment_score``.

        Returns
        -------
        BacktestResult
            Aggregate results with per-fold detail.
        """
        if df is None or df.empty:
            logger.warning("Empty DataFrame passed to backtester; returning null result")
            return BacktestResult(backtest_confidence="insufficient_data")

        # Infer step sizes from data density when possible
        horizon_24h, horizon_48h = self._infer_horizons(df)

        min_rows_needed = self.config.min_train_points + max(horizon_24h, horizon_48h)
        if len(df) < min_rows_needed:
            logger.warning(
                f"Not enough data for backtesting "
                f"(have {len(df)} rows, need ≥ {min_rows_needed}); "
                f"returning null result"
            )
            return BacktestResult(backtest_confidence="insufficient_data")

        windows: List[BacktestWindow] = []
        n_total = len(df)
        step = max(1, self.config.step_size)

        for fold_idx, train_end in enumerate(
            range(
                self.config.min_train_points,
                n_total - max(horizon_24h, horizon_48h) + 1,
                step,
            )
        ):
            if self.config.max_windows > 0 and fold_idx >= self.config.max_windows:
                break

            window = self._evaluate_window(
                df=df,
                train_end=train_end,
                horizon_24h=horizon_24h,
                horizon_48h=horizon_48h,
                window_index=fold_idx,
            )
            if window is not None:
                windows.append(window)

        return self._aggregate(windows)

    # ── Horizon inference ──────────────────────────────────────────────────

    def _infer_horizons(self, df: pd.DataFrame) -> Tuple[int, int]:
        """Estimate data-point steps for 24 h and 48 h from df timestamps."""
        if len(df) < 2:
            return self.config.horizon_24h, self.config.horizon_48h

        median_h = float(
            df["timestamp"].diff().dropna().dt.total_seconds().median() / 3600.0
        )
        if median_h < 1e-6:
            return self.config.horizon_24h, self.config.horizon_48h

        h24 = max(1, round(24.0 / median_h))
        h48 = max(1, round(48.0 / median_h))
        return h24, h48

    # ── Single-window evaluation ───────────────────────────────────────────

    def _evaluate_window(
        self,
        df: pd.DataFrame,
        train_end: int,
        horizon_24h: int,
        horizon_48h: int,
        window_index: int,
    ) -> Optional[BacktestWindow]:
        """Train on df[:train_end] and evaluate against the next horizon rows."""
        # Lazy import to avoid circular dependency at module load time
        from src.analytics.forecaster import SentimentForecaster

        train_df = df.iloc[:train_end].copy()
        n = len(df)

        # True future scores (clamped to last available)
        idx_24h = min(train_end + horizon_24h - 1, n - 1)
        idx_48h = min(train_end + horizon_48h - 1, n - 1)
        actual_24h = float(df["sentiment_score"].iloc[idx_24h])
        actual_48h = float(df["sentiment_score"].iloc[idx_48h])

        # Naïve baseline: forecast = last known value
        last_known = float(train_df["sentiment_score"].iloc[-1])
        naive_err_24h = abs(last_known - actual_24h)
        naive_err_48h = abs(last_known - actual_48h)

        # Model forecast
        try:
            forecaster = SentimentForecaster()
            forecaster.train(train_df)
            result = forecaster.predict(train_df)
            pred_24h = result.forecast_score_24h
            pred_48h = result.forecast_score_48h
            backend = result.model_backend
        except Exception as exc:
            logger.warning(f"Window {window_index}: forecaster failed ({exc}); skipping")
            return None

        model_err_24h = abs(pred_24h - actual_24h)
        model_err_48h = abs(pred_48h - actual_48h)

        return BacktestWindow(
            window_index=window_index,
            train_size=train_end,
            mae_24h=model_err_24h,
            rmse_24h=model_err_24h,      # per-window RMSE == MAE for a single point
            mape_24h=abs(model_err_24h / actual_24h) * 100 if abs(actual_24h) > 1e-9 else float("nan"),
            mae_48h=model_err_48h,
            rmse_48h=model_err_48h,
            mape_48h=abs(model_err_48h / actual_48h) * 100 if abs(actual_48h) > 1e-9 else float("nan"),
            naive_mae_24h=naive_err_24h,
            naive_mae_48h=naive_err_48h,
            model_backend=backend,
        )

    # ── Aggregation ────────────────────────────────────────────────────────

    def _aggregate(self, windows: List[BacktestWindow]) -> BacktestResult:
        """Compute aggregate statistics from per-window results."""
        if not windows:
            return BacktestResult(backtest_confidence="insufficient_data")

        def _nanmean(vals: List[float]) -> float:
            clean = [v for v in vals if not math.isnan(v)]
            return float(sum(clean) / len(clean)) if clean else float("nan")

        def _nan_rmse(vals: List[float]) -> float:
            """Aggregate per-fold absolute errors into a proper RMSE."""
            clean = [v for v in vals if not math.isnan(v)]
            return float(math.sqrt(sum(v ** 2 for v in clean) / len(clean))) if clean else float("nan")

        mae_24h = _nanmean([w.mae_24h for w in windows])
        mae_48h = _nanmean([w.mae_48h for w in windows])
        rmse_24h = _nan_rmse([w.rmse_24h for w in windows])
        rmse_48h = _nan_rmse([w.rmse_48h for w in windows])
        mape_24h = _nanmean([w.mape_24h for w in windows])
        mape_48h = _nanmean([w.mape_48h for w in windows])
        naive_mae_24h = _nanmean([w.naive_mae_24h for w in windows])
        naive_mae_48h = _nanmean([w.naive_mae_48h for w in windows])

        skill_24h = _skill_score(mae_24h, naive_mae_24h)
        skill_48h = _skill_score(mae_48h, naive_mae_48h)

        confidence = self._derive_confidence(mae_24h)

        return BacktestResult(
            windows=windows,
            mean_mae_24h=round(mae_24h, 6) if not math.isnan(mae_24h) else float("nan"),
            mean_rmse_24h=round(rmse_24h, 6) if not math.isnan(rmse_24h) else float("nan"),
            mean_mape_24h=round(mape_24h, 4) if not math.isnan(mape_24h) else float("nan"),
            mean_mae_48h=round(mae_48h, 6) if not math.isnan(mae_48h) else float("nan"),
            mean_rmse_48h=round(rmse_48h, 6) if not math.isnan(rmse_48h) else float("nan"),
            mean_mape_48h=round(mape_48h, 4) if not math.isnan(mape_48h) else float("nan"),
            mean_naive_mae_24h=round(naive_mae_24h, 6) if not math.isnan(naive_mae_24h) else float("nan"),
            mean_naive_mae_48h=round(naive_mae_48h, 6) if not math.isnan(naive_mae_48h) else float("nan"),
            skill_score_24h=round(skill_24h, 6) if not math.isnan(skill_24h) else float("nan"),
            skill_score_48h=round(skill_48h, 6) if not math.isnan(skill_48h) else float("nan"),
            backtest_confidence=confidence,
            n_windows=len(windows),
            config_snapshot=asdict(self.config),
        )

    def _derive_confidence(self, mean_mae_24h: float) -> str:
        """Translate aggregate MAE into a categorical confidence level.

        Thresholds are defined in :class:`BacktestConfig`.
        """
        if math.isnan(mean_mae_24h):
            return "insufficient_data"
        if mean_mae_24h <= self.config.confidence_mae_threshold_good:
            return "high"
        if mean_mae_24h <= self.config.confidence_mae_threshold_ok:
            return "medium"
        return "low"
