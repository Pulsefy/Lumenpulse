"""
Comprehensive test suite for shared time-series transforms and
lookahead bias prevention (#150).
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import numpy as np
import pandas as pd
import pytest

from src.analytics.correlation_engine import CorrelationEngine
from src.analytics.forecaster import SentimentForecaster
from src.ml.feature_schema import (
    PRICE_PREDICTOR_FEATURE_SET,
    current_feature_schema,
)
from src.ml.feature_store import FeatureStore
from src.ml.transforms import (
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
    rolling_sum,
    rolling_velocity,
    rolling_window,
)
from src.trends import TrendCalculator

# ── Window Parsing ─────────────────────────────────────────────────────────


class TestWindowParsing:
    def test_parse_window_to_timedelta_supported_units(self):
        assert parse_window_to_timedelta("24h") == timedelta(hours=24)
        assert parse_window_to_timedelta("7d") == timedelta(days=7)
        assert parse_window_to_timedelta("30m") == timedelta(minutes=30)
        assert parse_window_to_timedelta("60s") == timedelta(seconds=60)

    def test_parse_window_numeric_and_timedelta(self):
        assert parse_window_to_timedelta(12) == timedelta(hours=12)
        assert parse_window_to_timedelta(1.5) == timedelta(hours=1.5)
        td = timedelta(hours=3, minutes=15)
        assert parse_window_to_timedelta(td) == td

    def test_parse_window_negative_duration_raises_lookahead_bias(self):
        with pytest.raises(LookaheadBiasError, match="cannot be negative"):
            parse_window_to_timedelta("-5h")
        with pytest.raises(LookaheadBiasError, match="cannot be negative"):
            parse_window_to_timedelta(-2)
        with pytest.raises(LookaheadBiasError, match="cannot be negative"):
            parse_window_to_timedelta(timedelta(seconds=-1))

    def test_parse_window_invalid_format_raises_value_error(self):
        with pytest.raises(ValueError, match="Unsupported window format"):
            parse_window_to_timedelta("1w")
        with pytest.raises(ValueError, match="Unsupported window format"):
            parse_window_to_timedelta("invalid")
        with pytest.raises(ValueError, match="cannot be empty"):
            parse_window_to_timedelta("")
        with pytest.raises(ValueError, match="Unsupported window type"):
            parse_window_to_timedelta(None)  # type: ignore

    def test_parse_window_to_datetime(self):
        ref = datetime(2026, 6, 1, 12, 0, 0, tzinfo=timezone.utc)
        assert parse_window_to_datetime("24h", reference_time=ref) == datetime(
            2026, 5, 31, 12, 0, 0, tzinfo=timezone.utc
        )
        assert parse_window_to_datetime("7d", reference_time=ref) == datetime(
            2026, 5, 25, 12, 0, 0, tzinfo=timezone.utc
        )

    def test_parse_window_to_datetime_default_utc(self):
        before = datetime.now(timezone.utc)
        target = parse_window_to_datetime("1h")
        after = datetime.now(timezone.utc)
        assert before - timedelta(hours=1) <= target <= after - timedelta(hours=1)


# ── Time-Series Cleaning ───────────────────────────────────────────────────


class TestTimeSeriesCleaning:
    def test_clean_time_series_empty(self):
        empty_df = pd.DataFrame()
        res = clean_time_series(empty_df)
        assert res.empty

    def test_clean_time_series_sort_and_fill(self):
        t0 = datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)
        t1 = datetime(2026, 1, 1, 11, 0, tzinfo=timezone.utc)
        t2 = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)

        # Unsorted order with missing values
        df = pd.DataFrame(
            {
                "timestamp": [t2, t0, t1],
                "price": [np.nan, 100.0, np.nan],
                "lead_nan": [np.nan, np.nan, 5.0],
            }
        )

        cleaned = clean_time_series(
            df, timestamp_col="timestamp", sort=True, ffill=True, fillna_zero=True
        )

        assert list(cleaned["timestamp"]) == [t0, t1, t2]
        # At t0 price is 100, at t1 forward-filled to 100, at t2 forward-filled to 100
        assert list(cleaned["price"]) == [100.0, 100.0, 100.0]
        # lead_nan: at t0 was NaN (no prior value -> 0.0), at t1 was 5.0,
        # at t2 ffill -> 5.0
        assert list(cleaned["lead_nan"]) == [0.0, 5.0, 5.0]


# ── Lags and Leads ─────────────────────────────────────────────────────────


class TestLagsAndLeads:
    def test_lag_series_and_fill_value(self):
        s = pd.Series([10.0, 20.0, 30.0, 40.0])
        lagged = lag(s, periods=1)
        assert np.isnan(lagged.iloc[0])
        assert list(lagged.iloc[1:]) == [10.0, 20.0, 30.0]

        lagged_custom = lag(s, periods=2, fill_value=0.0)
        assert list(lagged_custom) == [0.0, 0.0, 10.0, 20.0]

    def test_lag_zero_returns_copy(self):
        s = pd.Series([1.0, 2.0])
        lagged = lag(s, periods=0)
        assert list(lagged) == [1.0, 2.0]

    def test_lag_negative_periods_raises_lookahead_bias(self):
        s = pd.Series([1.0, 2.0, 3.0])
        with pytest.raises(LookaheadBiasError, match="periods must be >= 0"):
            lag(s, periods=-1)

    def test_lead_requires_explicit_opt_in(self):
        s = pd.Series([10.0, 20.0, 30.0])
        with pytest.raises(LookaheadBiasError, match="allow_lookahead=True"):
            lead(s, periods=1, allow_lookahead=False)

        # With explicit permission
        future = lead(s, periods=1, allow_lookahead=True)
        assert list(future.iloc[:2]) == [20.0, 30.0]
        assert np.isnan(future.iloc[2])

    def test_lead_negative_periods_raises_value_error(self):
        s = pd.Series([1.0, 2.0])
        with pytest.raises(ValueError, match="periods must be >= 0"):
            lead(s, periods=-1, allow_lookahead=True)

    def test_build_clamped_future_target(self):
        s = pd.Series([10.0, 20.0, 30.0, 40.0])
        with pytest.raises(LookaheadBiasError, match="allow_lookahead=True"):
            build_clamped_future_target(s, step=2, allow_lookahead=False)

        clamped = build_clamped_future_target(s, step=2, allow_lookahead=True)
        # step=2:
        # i=0 -> min(2, 3) = idx 2 (30.0)
        # i=1 -> min(3, 3) = idx 3 (40.0)
        # i=2 -> min(4, 3) = idx 3 (40.0)
        # i=3 -> min(5, 3) = idx 3 (40.0)
        assert list(clamped) == [30.0, 40.0, 40.0, 40.0]

    def test_apply_time_lag_positive_and_zero(self):
        t0 = datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)
        df = pd.DataFrame({"timestamp": [t0], "val": [42]})

        # Zero lag -> unchanged
        same = apply_time_lag(df, lag_hours=0)
        assert same["timestamp"].iloc[0] == t0

        # Positive lag -> shifts timestamp forward
        shifted = apply_time_lag(df, lag_hours=3)
        assert shifted["timestamp"].iloc[0] == t0 + timedelta(hours=3)

    def test_apply_time_lag_negative_raises_lookahead_bias(self):
        df = pd.DataFrame({"timestamp": [datetime.now(timezone.utc)]})
        with pytest.raises(LookaheadBiasError, match="lag_hours must be >= 0"):
            apply_time_lag(df, lag_hours=-2)


# ── Returns and Percentage Changes ─────────────────────────────────────────


class TestReturnsAndPercentageChange:
    def test_calculate_percentage_change_positive_negative_and_zero(self):
        assert calculate_percentage_change(110.0, 100.0, scale_100=True) == 10.0
        assert calculate_percentage_change(90.0, 100.0, scale_100=True) == -10.0
        assert calculate_percentage_change(50.0, 0.0, scale_100=True) == 0.0
        assert calculate_percentage_change(
            110.0, 100.0, scale_100=False
        ) == pytest.approx(0.10)

    def test_compute_returns_simple(self):
        prices = pd.Series([100.0, 105.0, 99.75])
        ret = compute_returns(prices, periods=1, log=False)
        assert np.isnan(ret.iloc[0])
        assert ret.iloc[1] == pytest.approx(0.05)
        assert ret.iloc[2] == pytest.approx((99.75 - 105.0) / 105.0)

    def test_compute_returns_log(self):
        prices = pd.Series([100.0, 110.0, 121.0])
        log_ret = compute_returns(prices, periods=1, log=True)
        assert np.isnan(log_ret.iloc[0])
        assert log_ret.iloc[1] == pytest.approx(np.log(110.0 / 100.0))
        assert log_ret.iloc[2] == pytest.approx(np.log(121.0 / 110.0))

    def test_compute_returns_non_positive_values_log(self):
        prices = pd.Series([100.0, 0.0, -10.0, 50.0])
        log_ret = compute_returns(prices, periods=1, log=True)
        assert np.isnan(log_ret.iloc[1])
        assert np.isnan(log_ret.iloc[2])

    def test_compute_returns_negative_periods_raises_lookahead_bias(self):
        prices = pd.Series([10.0, 20.0])
        with pytest.raises(LookaheadBiasError, match="periods must be >= 1"):
            compute_returns(prices, periods=-1)


# ── Rolling Windows ────────────────────────────────────────────────────────


class TestRollingWindows:
    def test_rolling_aggregations(self):
        s = pd.Series([1.0, 2.0, 3.0, 4.0, 5.0])
        rmean = rolling_mean(s, window=3)
        assert np.isnan(rmean.iloc[0])
        assert rmean.iloc[2] == pytest.approx(2.0)
        assert rmean.iloc[4] == pytest.approx(4.0)

        rsum = rolling_sum(s, window=2)
        assert rsum.iloc[1] == 3.0
        assert rsum.iloc[4] == 9.0

        rmin = rolling_min(s, window=3)
        assert rmin.iloc[4] == 3.0

        rmax = rolling_max(s, window=3)
        assert rmax.iloc[4] == 5.0

    def test_rolling_window_center_true_raises_lookahead_bias(self):
        s = pd.Series([1.0, 2.0, 3.0, 4.0])
        with pytest.raises(
            LookaheadBiasError, match="center=True introduces lookahead bias"
        ):
            rolling_window(s, window=3, center=True)

    def test_rolling_window_invalid_size(self):
        s = pd.Series([1.0, 2.0])
        with pytest.raises(ValueError, match="must be > 0"):
            rolling_window(s, window=0)


# ── Velocity ───────────────────────────────────────────────────────────────


class TestVelocity:
    def test_compute_velocity_empty_or_too_small(self):
        assert compute_velocity(None) == 0.0
        assert compute_velocity(pd.DataFrame()) == 0.0
        single_row = pd.DataFrame(
            {"timestamp": [datetime.now(timezone.utc)], "sentiment_score": [0.5]}
        )
        assert compute_velocity(single_row) == 0.0

    def test_compute_velocity_known_change(self):
        t0 = datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)
        t1 = t0 + timedelta(hours=2)
        df = pd.DataFrame(
            {
                "timestamp": [t0, t1],
                "sentiment_score": [0.20, 0.60],
            }
        )
        # delta_s = 0.40, delta_h = 2.0 -> 0.20
        assert compute_velocity(df, window=5) == 0.20

    def test_compute_velocity_zero_elapsed_time(self):
        t0 = datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)
        df = pd.DataFrame(
            {
                "timestamp": [t0, t0],
                "sentiment_score": [0.20, 0.40],
            }
        )
        assert compute_velocity(df) == 0.0

    def test_rolling_velocity_matches_window_calculation(self):
        base = datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)
        timestamps = [base + timedelta(hours=i) for i in range(5)]
        scores = [0.1, 0.2, 0.5, 0.3, 0.8]
        df = pd.DataFrame({"timestamp": timestamps, "sentiment_score": scores})

        rvel = rolling_velocity(df, window=3)
        assert len(rvel) == 5
        # i=0: w_start=0, len=1 -> 0.0
        assert rvel.iloc[0] == 0.0
        # i=1: w_start=0, sub is [0.1, 0.2], dh=1h -> vel=0.1
        assert rvel.iloc[1] == pytest.approx(0.1)
        # i=2: w_start=0, sub is [0.1, 0.2, 0.5], dh=2h -> (0.5 - 0.1)/2 = 0.2
        assert rvel.iloc[2] == pytest.approx(0.2)
        # i=3: w_start=1, sub is [0.2, 0.5, 0.3], dh=2h -> (0.3 - 0.2)/2 = 0.05
        assert rvel.iloc[3] == pytest.approx(0.05)


# ── Volatility Measures ────────────────────────────────────────────────────


class TestVolatilityMeasures:
    def test_compute_volatility_log_returns(self):
        prices = pd.Series([100.0, 102.0, 101.0, 104.0, 103.0, 105.0])
        vol = compute_volatility(prices, window=3, min_periods=2, return_type="log")
        assert len(vol) == 6
        assert np.isnan(vol.iloc[0])
        # After min_periods=2, volatility is finite and non-negative
        assert vol.iloc[2] >= 0.0
        assert np.isfinite(vol.iloc[2])

    def test_compute_volatility_simple_returns_and_annualized(self):
        prices = pd.Series([10.0, 11.0, 10.5, 12.0, 11.5])
        vol_simple = compute_volatility(prices, window=3, return_type="simple")
        vol_ann = compute_volatility(
            prices, window=3, return_type="simple", annualize=True
        )
        assert np.all(vol_ann.dropna() > vol_simple.dropna())

    def test_compute_volatility_fillna_zero(self):
        prices = pd.Series([10.0, 11.0, 12.0])
        vol = compute_volatility(prices, window=5, min_periods=2, fillna_zero=True)
        assert vol.iloc[0] == 0.0

    def test_compute_scalar_volatility(self):
        assert compute_scalar_volatility([]) == 0.0
        assert compute_scalar_volatility([10.0]) == 0.0
        assert compute_scalar_volatility([10.0, 11.0]) == 0.0
        vol = compute_scalar_volatility([100.0, 105.0, 102.0, 108.0])
        assert vol > 0.0


# ── Lookahead Bias Prevention (Structural Invariants) ──────────────────────


class TestLookaheadBiasPrevention:
    """Rigorous tests proving lookahead bias is structurally prevented."""

    def test_causality_invariant_future_data_does_not_affect_past(self):
        """Modifying future rows at t > t_current MUST NEVER change features.

        Features at t_current must be purely causal.
        """
        base = datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc)
        n_history = 10
        timestamps = [base + timedelta(hours=i) for i in range(n_history)]
        prices = [100.0 + i * 2.0 for i in range(n_history)]
        sentiments = [0.1 * i for i in range(n_history)]

        df_past = pd.DataFrame(
            {"timestamp": timestamps, "price": prices, "sentiment_score": sentiments}
        )

        # Baseline features at t=5
        lag_past = lag(df_past["price"], periods=2)
        returns_past = compute_returns(df_past["price"], periods=1)
        vol_past = compute_volatility(df_past["price"], window=3)
        vel_past = rolling_velocity(df_past, window=3)

        val_lag_at_5 = lag_past.iloc[5]
        val_ret_at_5 = returns_past.iloc[5]
        val_vol_at_5 = vol_past.iloc[5]
        val_vel_at_5 = vel_past.iloc[5]

        # Now simulate arrival of wildly fluctuating future data at t=10..15
        future_timestamps = [
            base + timedelta(hours=i) for i in range(n_history, n_history + 5)
        ]
        future_prices = [9999.0, 1.0, 5000.0, 0.01, 888.0]
        future_sentiments = [-1.0, 1.0, -1.0, 1.0, 0.0]

        df_extended = pd.concat(
            [
                df_past,
                pd.DataFrame(
                    {
                        "timestamp": future_timestamps,
                        "price": future_prices,
                        "sentiment_score": future_sentiments,
                    }
                ),
            ],
            ignore_index=True,
        )

        # Recompute features on extended dataset
        lag_extended = lag(df_extended["price"], periods=2)
        returns_extended = compute_returns(df_extended["price"], periods=1)
        vol_extended = compute_volatility(df_extended["price"], window=3)
        vel_extended = rolling_velocity(df_extended, window=3)

        # Values at past indices MUST BE IDENTICAL
        assert lag_extended.iloc[5] == val_lag_at_5
        assert returns_extended.iloc[5] == val_ret_at_5
        assert vol_extended.iloc[5] == val_vol_at_5
        assert vel_extended.iloc[5] == val_vel_at_5

    @pytest.mark.parametrize(
        "bad_call",
        [
            lambda: lag(pd.Series([1, 2, 3]), periods=-1),
            lambda: apply_time_lag(
                pd.DataFrame({"timestamp": [datetime.now()]}), lag_hours=-1
            ),
            lambda: compute_returns(pd.Series([1, 2, 3]), periods=-1),
            lambda: parse_window_to_timedelta("-1h"),
            lambda: rolling_window(pd.Series([1, 2, 3]), window=2, center=True),
            lambda: lead(pd.Series([1, 2, 3]), periods=1, allow_lookahead=False),
            lambda: build_clamped_future_target(
                pd.Series([1, 2, 3]), step=1, allow_lookahead=False
            ),
        ],
    )
    def test_all_lookahead_vectors_raise_lookahead_bias_error(self, bad_call):
        with pytest.raises(LookaheadBiasError):
            bad_call()


# ── Transform Registry and Documentation ───────────────────────────────────


class TestTransformRegistry:
    def test_all_registered_transforms_document_semantics_and_nulls(self):
        transforms = list_available_transforms()
        assert len(transforms) >= 8

        for t in transforms:
            assert t.name
            assert len(t.description) > 5
            assert len(t.window_semantics) > 10, (
                f"{t.name} missing window semantics documentation"
            )
            assert len(t.null_handling) > 10, (
                f"{t.name} missing null handling documentation"
            )
            assert t.lookahead_protected is True

    def test_get_transform_definition(self):
        defn = get_transform_definition("rolling_volatility")
        assert defn.name == "rolling_volatility"
        assert "returns" in defn.description.lower()

        with pytest.raises(KeyError, match="Unknown transform"):
            get_transform_definition("unregistered_xyz")

    def test_register_custom_transform(self):
        custom = TransformDefinition(
            name="custom_momentum",
            description="Momentum metric",
            window_semantics="Trailing 14-day window",
            null_handling="Filled with 0",
            lookahead_protected=True,
        )
        register_transform(custom)
        assert get_transform_definition("custom_momentum") == custom


# ── Feature Schema Integration ─────────────────────────────────────────────


class TestFeatureSchemaTransformRecording:
    def test_price_predictor_schema_records_transforms(self):
        schema = current_feature_schema(PRICE_PREDICTOR_FEATURE_SET)
        assert schema.transforms == {
            "sentiment_score": "identity",
            "volume": "identity",
            "volatility": "rolling_volatility",
        }
        assert schema.get_transform("sentiment_score") == "identity"
        assert schema.get_transform("volume") == "identity"
        assert schema.get_transform("volatility") == "rolling_volatility"
        assert schema.get_transform("unknown_col") is None

    def test_schema_to_dict_includes_transforms(self):
        schema = current_feature_schema(PRICE_PREDICTOR_FEATURE_SET)
        schema_dict = schema.to_dict()
        assert "transforms" in schema_dict
        assert schema_dict["transforms"]["volatility"] == "rolling_volatility"

        features_list = schema_dict["features"]
        vol_feature = next(f for f in features_list if f["name"] == "volatility")
        assert vol_feature["transform"] == "rolling_volatility"
        assert vol_feature["transform_params"] == {"window": 24, "return_type": "log"}

    def test_feature_store_stamps_feature_transforms(self):
        mock_session = MagicMock()
        store = FeatureStore(mock_session)
        df = pd.DataFrame(
            {
                "timestamp": [datetime.now(timezone.utc)],
                "sentiment_score": [0.5],
                "volume": [100.0],
                "volatility": [0.02],
            }
        )
        stamped = store._stamp_schema(df)
        assert "feature_transforms" in stamped.attrs
        assert stamped.attrs["feature_transforms"]["volatility"] == "rolling_volatility"


# ── Existing Call Site Migration Parity ────────────────────────────────────


class TestCallSiteParity:
    """Assert outputs across migrated call sites are unchanged."""

    def test_trends_calculator_change_parity(self, monkeypatch):
        monkeypatch.setenv("CACHE_ENABLED", "false")
        calc = TrendCalculator()
        calc.trend_history["metric_a"] = {"value": 100.0}

        # Value moves 100 -> 105 (+5%)
        trend = calc._compute_trend("metric_a", 105.0)
        assert trend.change_percentage == 5.0
        assert trend.trend_direction == "up"

        # Value moves 105 -> 104 (-0.95%) -> stable
        trend2 = calc._compute_trend("metric_a", 104.0)
        assert trend2.change_percentage == -0.95
        assert trend2.trend_direction == "stable"

        # Previous 0 -> 0%
        calc.trend_history["metric_b"] = {"value": 0.0}
        trend3 = calc._compute_trend("metric_b", 50.0)
        assert trend3.change_percentage == 0.0
        assert trend3.trend_direction == "stable"

    def test_correlation_engine_lag_parity(self):
        t0 = datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)
        sentiment_data = [
            {"timestamp": (t0 + timedelta(hours=i)).isoformat(), "score": 0.1 * i}
            for i in range(10)
        ]
        metric_data = [
            {
                "timestamp": (t0 + timedelta(hours=i)).isoformat(),
                "value": 100.0 + 10 * i,
            }
            for i in range(10)
        ]

        # Calculate with lag 2
        res = CorrelationEngine.calculate_correlation(
            sentiment_data=sentiment_data,
            metric_data=metric_data,
            metric_type="price",
            lag_hours=2,
        )
        assert res.lag_hours == 2
        assert res.sample_size == 8
        assert res.correlation_score > 0.99  # perfectly collinear with lag

    def test_forecaster_velocity_parity(self):
        base = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
        df = pd.DataFrame(
            {
                "timestamp": [
                    base - timedelta(hours=3),
                    base - timedelta(hours=2),
                    base - timedelta(hours=1),
                    base,
                ],
                "sentiment_score": [0.1, 0.2, 0.4, 0.7],
            }
        )
        vel = SentimentForecaster.compute_sentiment_velocity(df, window=4)
        # delta_s = 0.7 - 0.1 = 0.6; delta_h = 3.0 -> 0.2
        assert vel == 0.20

    @patch("src.ml.feature_store.pd.read_sql")
    def test_feature_store_end_to_end_parity(self, mock_read_sql):
        now = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
        timestamps = [now - timedelta(hours=2), now - timedelta(hours=1)]

        def side_effect(query, conn, params=None):
            q = str(query).lower()
            if "sentiment" in q:
                return pd.DataFrame(
                    {"timestamp": timestamps, "sentiment_score": [0.4, 0.8]}
                )
            if "volume" in q:
                return pd.DataFrame(
                    {"timestamp": timestamps, "volume": [1000.0, 2000.0]}
                )
            if "volatility" in q:
                return pd.DataFrame(
                    {"timestamp": timestamps, "volatility": [0.01, 0.03]}
                )
            return pd.DataFrame()

        mock_read_sql.side_effect = side_effect
        session = MagicMock()
        session.connection.return_value = MagicMock()
        store = FeatureStore(session)

        df = store.get_features_for_asset("BTC", window="24h")
        assert list(df.columns) == [
            "timestamp",
            "sentiment_score",
            "volume",
            "volatility",
        ]
        assert len(df) == 2
        assert df["sentiment_score"].tolist() == [0.4, 0.8]
        assert df["volume"].tolist() == [1000.0, 2000.0]
        assert df["volatility"].tolist() == [0.01, 0.03]
        assert df.attrs["feature_transforms"] == {
            "sentiment_score": "identity",
            "volume": "identity",
            "volatility": "rolling_volatility",
        }
