"""
Re-export shared time-series transforms for analytics modules.
"""

from __future__ import annotations

try:
    from src.ml.transforms import (  # noqa: F401
        TRANSFORM_REGISTRY,
        LookaheadBiasError,
        TransformDefinition,
        apply_time_lag,
        build_clamped_future_target,
        calculate_percentage_change,
        clean_time_series,
        compute_returns,
        compute_scalar_volatility,
        compute_velocity,
        compute_volatility,
        get_transform_definition,
        lag,
        lead,
        list_available_transforms,
        parse_window_to_datetime,
        parse_window_to_timedelta,
        register_transform,
        rolling_max,
        rolling_mean,
        rolling_min,
        rolling_std,
        rolling_sum,
        rolling_velocity,
        rolling_window,
    )
except ImportError:
    from ml.transforms import (  # noqa: F401
        TRANSFORM_REGISTRY,
        LookaheadBiasError,
        TransformDefinition,
        apply_time_lag,
        build_clamped_future_target,
        calculate_percentage_change,
        clean_time_series,
        compute_returns,
        compute_scalar_volatility,
        compute_velocity,
        compute_volatility,
        get_transform_definition,
        lag,
        lead,
        list_available_transforms,
        parse_window_to_datetime,
        parse_window_to_timedelta,
        register_transform,
        rolling_max,
        rolling_mean,
        rolling_min,
        rolling_std,
        rolling_sum,
        rolling_velocity,
        rolling_window,
    )

