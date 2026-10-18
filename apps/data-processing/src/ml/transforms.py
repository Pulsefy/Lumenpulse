"""
Shared Time-Series Transforms Module (#150).

Provides canonical, reusable time-series transforms across feature engineering,
market trends, correlation analysis, and predictive forecasting pipelines:
  - Rolling windows (mean, sum, std, min, max, median, velocity)
  - Lags and lead target generators
  - Returns (simple and log) and percentage changes
  - Volatility measures (rolling sample standard deviation of log/simple returns)
  - Time-series cleaning and window parsing

Window Semantics and Lookahead Protection:
  All feature transforms operate on strictly backward-looking (trailing /
  right-closed [t - W, t]) windows. Centered windows and negative lags
  (which peek into future observations) are structurally forbidden and
  raise ``LookaheadBiasError``. Future target generation is kept separate via
  explicit ``allow_lookahead=True`` opt-in.

Null Handling:
  Each transform explicitly defines warmup handling (e.g. minimum periods
  yielding NaN or zero fallback), missing timestamp gap behavior, and zero-division
  guards (e.g. zero price/volume in percentage change or zero elapsed time).
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import numpy as np
import pandas as pd

# ── Exceptions ─────────────────────────────────────────────────────────────


class LookaheadBiasError(ValueError):
    """Raised when an operation would introduce lookahead bias into features."""

    def __init__(self, message: str):
        super().__init__(
            f"Lookahead bias prevented: {message}. "
            "Features must strictly depend on past/present observations (t' <= t). "
            "If generating supervised targets, use lead() with allow_lookahead=True."
        )


# ── Transform Metadata & Registry ──────────────────────────────────────────


@dataclass(frozen=True)
class TransformDefinition:
    """Contract and documentation for a registered time-series transform."""

    name: str
    description: str
    window_semantics: str
    null_handling: str
    lookahead_protected: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "window_semantics": self.window_semantics,
            "null_handling": self.null_handling,
            "lookahead_protected": self.lookahead_protected,
        }


TRANSFORM_REGISTRY: dict[str, TransformDefinition] = {
    "identity": TransformDefinition(
        name="identity",
        description="Direct / untransformed raw feature observation.",
        window_semantics=(
            "Instantaneous observation at timestamp t; no lookback window."
        ),
        null_handling=(
            "Preserves source nulls; cleaned downstream via dataset-level "
            "ffill -> fillna(0)."
        ),
        lookahead_protected=True,
    ),
    "rolling_volatility": TransformDefinition(
        name="rolling_volatility",
        description=(
            "Rolling sample standard deviation of log or simple returns over a "
            "trailing window."
        ),
        window_semantics=(
            "Trailing right-closed window [t - W, t]. Centered/future windows "
            "strictly forbidden."
        ),
        null_handling=(
            "Initial W rows return NaN or 0.0 (if fillna_zero=True); requires "
            "min_periods >= 2."
        ),
        lookahead_protected=True,
    ),
    "rolling_mean": TransformDefinition(
        name="rolling_mean",
        description="Rolling simple moving average over a trailing window.",
        window_semantics=(
            "Trailing right-closed window [t - W, t]. center=True forbidden."
        ),
        null_handling="Warmup rows with count < min_periods return NaN.",
        lookahead_protected=True,
    ),
    "rolling_std": TransformDefinition(
        name="rolling_std",
        description="Rolling sample standard deviation over a trailing window.",
        window_semantics=(
            "Trailing right-closed window [t - W, t]. center=True forbidden."
        ),
        null_handling=(
            "Warmup rows return NaN; requires at least 2 points to avoid zero division."
        ),
        lookahead_protected=True,
    ),
    "rolling_velocity": TransformDefinition(
        name="rolling_velocity",
        description=(
            "Trailing rate of change (delta value / delta hours) across a "
            "rolling window."
        ),
        window_semantics="Trailing window of N observations ending at timestamp t.",
        null_handling=(
            "Returns 0.0 when observation count < 2 or elapsed time < 1e-6 hours."
        ),
        lookahead_protected=True,
    ),
    "lag": TransformDefinition(
        name="lag",
        description="Shifts series backward in time by k periods or delta hours.",
        window_semantics=(
            "Strictly non-negative lag (periods >= 0, lag_hours >= 0). "
            "Negative lag raises LookaheadBiasError."
        ),
        null_handling="Initial k rows receive NaN or specified fill_value.",
        lookahead_protected=True,
    ),
    "pct_change": TransformDefinition(
        name="pct_change",
        description=(
            "Percentage or relative change from trailing observation "
            "((current - prev) / |prev|)."
        ),
        window_semantics=(
            "Compares current observation at t with previous observation at "
            "t - k (k >= 1)."
        ),
        null_handling=(
            "Returns 0.0 when previous value is 0; propagates NaN if previous "
            "value is missing."
        ),
        lookahead_protected=True,
    ),
    "returns": TransformDefinition(
        name="returns",
        description="Logarithmic or simple arithmetic returns over trailing period.",
        window_semantics="Trailing return between t and t - k (k >= 1).",
        null_handling=(
            "Initial k rows return NaN; non-positive values for log returns yield NaN."
        ),
        lookahead_protected=True,
    ),
    "time_lag": TransformDefinition(
        name="time_lag",
        description=(
            "Shifts timestamp column forward by lag_hours to align leading signals."
        ),
        window_semantics=(
            "Strictly non-negative lag_hours >= 0. Negative lag raises "
            "LookaheadBiasError."
        ),
        null_handling=(
            "Preserves existing null timestamps; modifies timestamp values by "
            "timedelta."
        ),
        lookahead_protected=True,
    ),
}


def get_transform_definition(name: str) -> TransformDefinition:
    """Retrieve the documented definition of a registered transform."""
    if name not in TRANSFORM_REGISTRY:
        raise KeyError(
            f"Unknown transform '{name}'. Registered transforms: "
            f"{sorted(TRANSFORM_REGISTRY.keys())}"
        )
    return TRANSFORM_REGISTRY[name]


def register_transform(definition: TransformDefinition) -> None:
    """Register or override a transform definition in the shared registry."""
    TRANSFORM_REGISTRY[definition.name] = definition


def list_available_transforms() -> list[TransformDefinition]:
    """Return a list of all registered transform definitions."""
    return list(TRANSFORM_REGISTRY.values())


# ── Window Parsing ─────────────────────────────────────────────────────────


def parse_window_to_timedelta(
    window: str | int | float | timedelta,
) -> timedelta:
    """
    Parse a window duration specification into a Python timedelta.

    Window Semantics:
        Represents a backward-looking duration W. Supported formats:
        - str: '24h' (hours), '7d' (days), '30m' (minutes), '60s' (seconds)
        - int / float: interpreted as hours
        - timedelta: returned as-is

    Null Handling:
        Raises ValueError on malformed or negative durations.
    """
    if isinstance(window, timedelta):
        if window < timedelta(0):
            raise LookaheadBiasError("Window duration cannot be negative.")
        return window

    if isinstance(window, (int, float)):
        if window < 0:
            raise LookaheadBiasError("Window duration cannot be negative.")
        return timedelta(hours=float(window))

    if not isinstance(window, str):
        raise ValueError(f"Unsupported window type: {type(window).__name__}")

    window = window.strip().lower()
    if not window:
        raise ValueError("Window string cannot be empty.")

    try:
        if window.endswith("h"):
            val = int(window[:-1])
            if val < 0:
                raise LookaheadBiasError("Window duration cannot be negative.")
            return timedelta(hours=val)
        elif window.endswith("d"):
            val = int(window[:-1])
            if val < 0:
                raise LookaheadBiasError("Window duration cannot be negative.")
            return timedelta(days=val)
        elif window.endswith("m"):
            val = int(window[:-1])
            if val < 0:
                raise LookaheadBiasError("Window duration cannot be negative.")
            return timedelta(minutes=val)
        elif window.endswith("s"):
            val = int(window[:-1])
            if val < 0:
                raise LookaheadBiasError("Window duration cannot be negative.")
            return timedelta(seconds=val)
        else:
            raise ValueError(
                "Unsupported window format. Use 'h' (hours) or 'd' (days)."
            )
    except ValueError as e:
        if isinstance(e, LookaheadBiasError):
            raise
        raise ValueError(
            f"Unsupported window format. Use 'h' (hours) or 'd' (days): '{window}'"
        ) from e


def parse_window_to_datetime(
    window: str | int | float | timedelta,
    reference_time: datetime | None = None,
) -> datetime:
    """
    Calculate a start timestamp by subtracting window duration from reference_time.

    Window Semantics:
        Computes `reference_time - timedelta(window)`. This defines the trailing
        lookback window boundary.

    Null Handling:
        If reference_time is None, defaults to current UTC time (timezone-aware).
    """
    delta = parse_window_to_timedelta(window)
    base = reference_time or datetime.now(timezone.utc)
    return base - delta


# ── Time-Series Cleaning & Alignment ───────────────────────────────────────


def clean_time_series(
    df: pd.DataFrame,
    timestamp_col: str = "timestamp",
    sort: bool = True,
    ffill: bool = True,
    fillna_zero: bool = True,
) -> pd.DataFrame:
    """
    Standardizes a time-series DataFrame by sorting and resolving missing values.

    Window Semantics:
        Orders rows strictly chronologically along `timestamp_col`.
        This guarantees causality for subsequent rolling/lag transforms.

    Null Handling:
        - `ffill=True`: Forward-fills missing values using the most recent
          historical observation. This is strictly causal and prevents
          future-data leakage.
        - `fillna_zero=True`: Fills any initial leading NaNs (prior to the
          first observed value) with 0.0.
    """
    if df.empty:
        return df.copy()

    res = df.copy()
    if sort and timestamp_col in res.columns:
        res = res.sort_values(timestamp_col).reset_index(drop=True)

    if ffill:
        res = res.ffill()

    if fillna_zero:
        res = res.fillna(0.0)

    return res


# ── Lags and Leads ─────────────────────────────────────────────────────────


def lag(
    data: pd.Series | pd.DataFrame,
    periods: int = 1,
    fill_value: Any = None,
) -> pd.Series | pd.DataFrame:
    """
    Shift a Series or DataFrame backward in time (trailing lag).

    Window Semantics:
        At index i, the returned value is data[i - periods].
        Only past data is observed (t' = t - periods).

    Lookahead Protection:
        `periods` must be >= 0. Negative periods access future data and
        raise LookaheadBiasError.

    Null Handling:
        The initial `periods` rows have no prior observation and are filled
        with `fill_value` (default: NaN).
    """
    if periods < 0:
        raise LookaheadBiasError(
            f"Lag periods must be >= 0 (got {periods}). "
            "Negative lag peeks into future data. For supervised targets, use lead()."
        )
    if periods == 0:
        return data.copy()

    return data.shift(periods, fill_value=fill_value)


def lead(
    data: pd.Series | pd.DataFrame,
    periods: int = 1,
    fill_value: Any = None,
    allow_lookahead: bool = False,
) -> pd.Series | pd.DataFrame:
    """
    Shift a Series or DataFrame forward in time (future lead) for target creation.

    Window Semantics:
        At index i, the returned value is data[i + periods].
        This strictly accesses future data and is ONLY permissible for
        supervised targets.

    Lookahead Protection:
        `allow_lookahead` must be explicitly True. Otherwise raises LookaheadBiasError.

    Null Handling:
        The trailing `periods` rows have no future observation and are filled
        with `fill_value` (default: NaN).
    """
    if not allow_lookahead:
        raise LookaheadBiasError(
            f"lead(periods={periods}) requested without allow_lookahead=True. "
            "Forward-looking transforms are prohibited for model features."
        )
    if periods < 0:
        raise ValueError(f"Lead periods must be >= 0 (got {periods}).")
    if periods == 0:
        return data.copy()

    return data.shift(-periods, fill_value=fill_value)


def build_clamped_future_target(
    series: pd.Series,
    step: int,
    allow_lookahead: bool = False,
) -> pd.Series:
    """
    Construct future target array with boundary clamping as used in forecaster.py.

    Window Semantics:
        For row i, returns series.iloc[min(i + step, len(series) - 1)].
        Boundary clamping ensures the target array has no trailing NaNs when
        history ends.

    Lookahead Protection:
        Requires allow_lookahead=True.

    Null Handling:
        Boundary clamped to the last available observation when i + step >= n.
    """
    if not allow_lookahead:
        raise LookaheadBiasError(
            "Building future target requires explicit allow_lookahead=True."
        )
    if step < 0:
        raise ValueError(f"step must be >= 0 (got {step}).")

    n = len(series)
    if n == 0:
        return pd.Series(dtype=series.dtype)

    values = [series.iloc[min(i + step, n - 1)] for i in range(n)]
    return pd.Series(values, index=series.index, dtype=series.dtype)


def apply_time_lag(
    df: pd.DataFrame,
    lag_hours: int | float,
    timestamp_col: str = "timestamp",
) -> pd.DataFrame:
    """
    Shift timestamp column forward by lag_hours to align a leading indicator.

    Window Semantics:
        If sentiment leads price by H hours, sentiment observed at timestamp t
        predicts price at timestamp t + H. Shifting sentiment's timestamp to
        t + H allows standard time-aligned outer/inner joins on hour.

    Lookahead Protection:
        `lag_hours` must be >= 0. Negative lag would shift an indicator backward,
        causing it to peek into future market movements.

    Null Handling:
        Preserves rows; if timestamp_col has NaNs they remain NaNs.
    """
    if lag_hours < 0:
        raise LookaheadBiasError(
            f"lag_hours must be >= 0 (got {lag_hours}). "
            "Negative lag shifts indicators backward into the past relative "
            "to the target."
        )

    res = df.copy()
    if lag_hours > 0 and timestamp_col in res.columns:
        res[timestamp_col] = pd.to_datetime(res[timestamp_col]) + pd.Timedelta(
            hours=float(lag_hours)
        )
    return res


# ── Returns and Percentage Changes ─────────────────────────────────────────


def calculate_percentage_change(
    current: float,
    previous: float,
    scale_100: bool = True,
) -> float:
    """
    Calculate the percentage change between current and previous values.

    Window Semantics:
        Compares instantaneous observation `current` with prior `previous`.

    Null Handling:
        - If previous != 0: returns ((current - previous) / abs(previous)) *
          (100 if scale_100 else 1)
        - If previous == 0: returns 0.0 to prevent division by zero.
    """
    if previous != 0:
        pct = (current - previous) / abs(previous)
        return float(pct * 100.0 if scale_100 else pct)
    return 0.0


def compute_returns(
    series: pd.Series,
    periods: int = 1,
    log: bool = False,
    fill_value: float | None = None,
) -> pd.Series:
    """
    Compute simple or logarithmic returns over a trailing period.

    Window Semantics:
        Trailing return between t and t - periods.
        - Simple: (P_t - P_{t-periods}) / P_{t-periods}
        - Log: ln(P_t) - ln(P_{t-periods}) = ln(P_t / P_{t-periods})

    Lookahead Protection:
        `periods` must be >= 1. Negative periods raise LookaheadBiasError.

    Null Handling:
        - Initial `periods` rows are filled with `fill_value` (default: NaN).
        - For simple returns, zero denominator yields NaN (or inf handled to NaN).
        - For log returns, values <= 0 yield NaN.
    """
    if periods < 1:
        raise LookaheadBiasError(
            f"Return calculation periods must be >= 1 (got {periods})."
        )

    lagged = lag(series, periods=periods)

    if log:
        # Guard non-positive numbers
        curr_clean = series.where(series > 0, np.nan)
        lag_clean = lagged.where(lagged > 0, np.nan)
        returns = np.log(curr_clean) - np.log(lag_clean)
    else:
        # Zero denominator yields NaN
        lag_nonzero = lagged.where(lagged != 0, np.nan)
        returns = (series - lagged) / lag_nonzero.abs()

    if fill_value is not None:
        returns = returns.fillna(fill_value)

    return returns


# ── Rolling Windows ────────────────────────────────────────────────────────


def rolling_window(
    series: pd.Series,
    window: int | str | timedelta,
    func: str | Callable[[pd.Series], Any] = "mean",
    min_periods: int | None = None,
    center: bool = False,
    closed: str = "right",
) -> pd.Series:
    """
    Apply an aggregation function over a trailing rolling window.

    Window Semantics:
        Trailing right-closed window [t - W, t]. Only observations at or
        before timestamp t are included.

    Lookahead Protection:
        `center` must be False. Centering a window incorporates future data
        and raises LookaheadBiasError.

    Null Handling:
        Initial rows where observation count < min_periods return NaN.
    """
    if center:
        raise LookaheadBiasError(
            "center=True introduces lookahead bias by incorporating future "
            "data points into the window."
        )

    if isinstance(window, (str, timedelta)):
        win_arg: str | timedelta | int = (
            f"{int(window.total_seconds())}s"
            if isinstance(window, timedelta)
            else window
        )
    else:
        win_arg = int(window)
        if win_arg <= 0:
            raise ValueError(f"Rolling window size must be > 0 (got {win_arg}).")

    roll = series.rolling(
        window=win_arg, min_periods=min_periods, center=False, closed=closed
    )

    if isinstance(func, str):
        fn = getattr(roll, func, None)
        if fn is None or not callable(fn):
            raise ValueError(f"Unsupported rolling aggregation function '{func}'.")
        return fn()
    else:
        return roll.apply(func, raw=False)


def rolling_mean(
    series: pd.Series,
    window: int | str | timedelta,
    min_periods: int | None = None,
) -> pd.Series:
    """Convenience wrapper for trailing rolling mean."""
    return rolling_window(series, window, func="mean", min_periods=min_periods)


def rolling_sum(
    series: pd.Series,
    window: int | str | timedelta,
    min_periods: int | None = None,
) -> pd.Series:
    """Convenience wrapper for trailing rolling sum."""
    return rolling_window(series, window, func="sum", min_periods=min_periods)


def rolling_std(
    series: pd.Series,
    window: int | str | timedelta,
    min_periods: int | None = 2,
) -> pd.Series:
    """Convenience wrapper for trailing rolling sample standard deviation."""
    return rolling_window(series, window, func="std", min_periods=min_periods)


def rolling_min(
    series: pd.Series,
    window: int | str | timedelta,
    min_periods: int | None = None,
) -> pd.Series:
    """Convenience wrapper for trailing rolling minimum."""
    return rolling_window(series, window, func="min", min_periods=min_periods)


def rolling_max(
    series: pd.Series,
    window: int | str | timedelta,
    min_periods: int | None = None,
) -> pd.Series:
    """Convenience wrapper for trailing rolling maximum."""
    return rolling_window(series, window, func="max", min_periods=min_periods)


# ── Velocity (Rate of Change) ──────────────────────────────────────────────


def compute_velocity(
    df: pd.DataFrame | None = None,
    window: int = 5,
    value_col: str = "sentiment_score",
    time_col: str = "timestamp",
    round_digits: int | None = 6,
) -> float:
    """
    Compute rate of change per hour over the tail of a time series.

    Formula:
        (value[tail] - value[start]) / delta_hours

    Window Semantics:
        Trailing window of up to `window` most recent records.
        Strictly backward-looking.

    Null Handling:
        Returns 0.0 if df is None, has fewer than 2 rows, or elapsed time < 1e-6 hours.
    """
    if df is None or len(df) < 2:
        return 0.0

    recent = df.tail(window)
    if len(recent) < 2:
        return 0.0

    delta_val = recent[value_col].iloc[-1] - recent[value_col].iloc[0]
    t_end = recent[time_col].iloc[-1]
    t_start = recent[time_col].iloc[0]

    # Convert to pandas Timestamps if needed
    t_end_dt = pd.to_datetime(t_end)
    t_start_dt = pd.to_datetime(t_start)
    delta_h = (t_end_dt - t_start_dt).total_seconds() / 3600.0

    if delta_h < 1e-6:
        return 0.0

    velocity = float(delta_val / delta_h)
    return round(velocity, round_digits) if round_digits is not None else velocity


def rolling_velocity(
    df: pd.DataFrame,
    window: int = 3,
    value_col: str = "sentiment_score",
    time_col: str = "timestamp",
) -> pd.Series:
    """
    Compute trailing rolling velocity (delta value / delta hours) across all rows.

    Window Semantics:
        For row i, uses observations in range [max(0, i - (window - 1)), i].
        Strictly trailing; no future rows are observed.

    Null Handling:
        Returns 0.0 when window length < 2 or elapsed time < 1e-6 hours.
    """
    n = len(df)
    if n == 0:
        return pd.Series(dtype="float64")

    timestamps = pd.to_datetime(df[time_col]).values
    values = df[value_col].values.astype(float)

    velocities = np.zeros(n, dtype=float)
    for i in range(n):
        w_start = max(0, i - (window - 1))
        if i - w_start >= 1:
            ds = values[i] - values[w_start]
            # Timestamps in nanoseconds
            dh = (timestamps[i] - timestamps[w_start]).astype("timedelta64[ns]").astype(
                float
            ) / (3600.0 * 1e9)
            if dh >= 1e-6:
                velocities[i] = ds / dh

    return pd.Series(velocities, index=df.index, dtype=float)


# ── Volatility Measures ────────────────────────────────────────────────────


def compute_volatility(
    series: pd.Series,
    window: int = 24,
    min_periods: int | None = 2,
    return_type: str = "log",
    annualize: bool = False,
    periods_per_year: float = 365.25 * 24,
    fillna_zero: bool = False,
) -> pd.Series:
    """
    Compute rolling price volatility (standard deviation of returns).

    As specified in feature lineage (#150, feature_lineage.yaml):
    "Rolling price volatility (standard deviation of log-returns)".

    Window Semantics:
        Trailing right-closed window [t - W, t]. Uses trailing returns.
        center=False strictly enforced.

    Null Handling:
        - Warmup period: First `window` rows produce NaN unless `fillna_zero=True`.
        - Requires min_periods >= 2 to compute standard deviation.
        - Non-positive prices for log returns yield NaN.
    """
    if return_type not in ("log", "simple"):
        raise ValueError(f"return_type must be 'log' or 'simple', got '{return_type}'.")

    returns = compute_returns(series, periods=1, log=(return_type == "log"))
    vol = rolling_std(returns, window=window, min_periods=min_periods)

    if annualize:
        vol = vol * math.sqrt(periods_per_year)

    if fillna_zero:
        vol = vol.fillna(0.0)

    return vol


def compute_scalar_volatility(
    values: Sequence[float],
    return_type: str = "log",
) -> float:
    """
    Compute single-window volatility on a finite sequence of observations.

    Window Semantics:
        Evaluates returns across the provided sequence. Requires at least 3
        observations (yielding 2 returns) to compute sample standard deviation.

    Null Handling:
        Returns 0.0 if fewer than 3 values are provided or std is non-finite.
    """
    if len(values) < 3:
        return 0.0

    s = pd.Series(values, dtype=float)
    returns = compute_returns(s, periods=1, log=(return_type == "log")).dropna()
    if len(returns) < 2:
        return 0.0

    std = float(returns.std(ddof=1))
    return std if np.isfinite(std) else 0.0
