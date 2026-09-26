# -*- coding: utf-8 -*-
"""
Tests for the walk-forward backtesting harness (src/analytics/backtesting.py).

Coverage:
  - BacktestConfig defaults and YAML loading
  - Metric helpers (MAE, RMSE, MAPE, skill_score)
  - WalkForwardBacktester.run() with synthetic DataFrames
  - Naive baseline inclusion
  - Insufficient-data guard paths
  - BacktestResult serialisation / summary
  - ForecastResult.backtest_confidence integration with SentimentForecaster.run()

Note on the test environment
-----------------------------
The conftest stubs out numpy and pandas with minimal mocks when they are not
installed in the test virtualenv.  Tests that require a functioning DataFrame
import pandas via importlib and patch sys.modules to use the real package path.
Where pandas/numpy are unavailable in the test runner we fall back to a
lightweight pure-Python DataFrame-like object so all tests remain runnable.
"""

from __future__ import annotations

import importlib
import math
import sys
import textwrap
import types
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List
from unittest.mock import MagicMock, patch

import pytest

# ── Real pandas / numpy import helpers ────────────────────────────────────
#
# The conftest stubs numpy and pandas when not installed.  For tests that
# need a real DataFrame we build one using the stdlib + the
# SentimentForecaster.load_history() pattern (dict list → pd.DataFrame).
# If the real package is unavailable we use a simple stand-in.


def _real_pd():
    """Return the real pandas module or None if unavailable."""
    real = sys.modules.get("pandas")
    if real is not None and hasattr(real, "Timestamp"):
        return real
    try:
        import importlib
        spec = importlib.util.find_spec("pandas")
        if spec is None:
            return None
        # Temporarily clear the stub so the real package loads
        stub = sys.modules.pop("pandas", None)
        try:
            m = importlib.import_module("pandas")
            return m if hasattr(m, "Timestamp") else None
        finally:
            if stub is not None:
                sys.modules["pandas"] = stub
    except Exception:
        return None


def _make_df(n: int, start_score: float = 0.3, step: float = 0.01):
    """Return a DataFrame (real or stub-compatible) of *n* rows.

    If real pandas is unavailable, returns a MagicMock whose attributes
    behave like a minimal DataFrame for the guard-path tests.
    """
    real_pd = _real_pd()
    base = datetime(2024, 1, 1, tzinfo=timezone.utc)
    rows = []
    for i in range(n):
        rows.append(
            {
                "timestamp": base + timedelta(hours=i),
                "sentiment_score": round(start_score + i * step, 6),
                "news_count": 10,
                "positive_pct": 0.5,
                "negative_pct": 0.2,
                "neutral_pct": 0.3,
            }
        )
    if real_pd is not None:
        df = real_pd.DataFrame(rows)
        df["timestamp"] = real_pd.to_datetime(df["timestamp"], utc=True)
        return df

    # Fallback: minimal DataFrame-like object
    return _StubDataFrame(rows)


class _StubDataFrame:
    """Minimal DataFrame stand-in for guard-path tests when pandas is stubbed."""

    def __init__(self, rows: List[Dict[str, Any]]) -> None:
        self._rows = rows

    @property
    def empty(self) -> bool:
        return len(self._rows) == 0

    def __len__(self) -> int:
        return len(self._rows)

    def __bool__(self) -> bool:
        return True


# ── Determine whether the full harness tests can run ──────────────────────

_HAS_REAL_PANDAS = _real_pd() is not None

# Mark that skips tests requiring a real DataFrame
needs_pandas = pytest.mark.skipif(
    not _HAS_REAL_PANDAS,
    reason="real pandas not available in test virtualenv",
)


# ── Module under test ──────────────────────────────────────────────────────

from src.analytics.backtesting import (
    BacktestConfig,
    BacktestResult,
    BacktestWindow,
    WalkForwardBacktester,
    _mae,
    _mape,
    _rmse,
    _skill_score,
    load_backtest_config,
)


# ─────────────────────────────────────────────────────────────────────────────
# BacktestConfig
# ─────────────────────────────────────────────────────────────────────────────


class TestBacktestConfig:
    def test_default_values(self):
        cfg = BacktestConfig()
        assert cfg.min_train_points == 10
        assert cfg.step_size == 1
        assert cfg.horizon_24h == 1
        assert cfg.horizon_48h == 2
        assert cfg.max_windows == 0
        assert cfg.random_seed == 42
        assert cfg.confidence_mae_threshold_good == 0.05
        assert cfg.confidence_mae_threshold_ok == 0.15

    def test_custom_values(self):
        cfg = BacktestConfig(
            min_train_points=5,
            max_windows=3,
            confidence_mae_threshold_good=0.02,
        )
        assert cfg.min_train_points == 5
        assert cfg.max_windows == 3
        assert cfg.confidence_mae_threshold_good == 0.02


# ─────────────────────────────────────────────────────────────────────────────
# load_backtest_config
# ─────────────────────────────────────────────────────────────────────────────


class TestLoadBacktestConfig:
    def test_returns_default_when_file_missing(self, tmp_path):
        cfg = load_backtest_config(tmp_path / "nonexistent.yaml")
        assert isinstance(cfg, BacktestConfig)
        assert cfg.min_train_points == 10

    def test_loads_nested_yaml(self, tmp_path):
        yaml_content = textwrap.dedent(
            """\
            backtesting:
              min_train_points: 7
              step_size: 2
              random_seed: 99
              confidence_mae_threshold_good: 0.03
              confidence_mae_threshold_ok: 0.12
            """
        )
        p = tmp_path / "cfg.yaml"
        p.write_text(yaml_content)
        cfg = load_backtest_config(p)
        assert cfg.min_train_points == 7
        assert cfg.step_size == 2
        assert cfg.random_seed == 99
        assert cfg.confidence_mae_threshold_good == 0.03
        assert cfg.confidence_mae_threshold_ok == 0.12

    def test_loads_flat_yaml(self, tmp_path):
        yaml_content = textwrap.dedent(
            """\
            min_train_points: 4
            max_windows: 5
            """
        )
        p = tmp_path / "flat.yaml"
        p.write_text(yaml_content)
        cfg = load_backtest_config(p)
        assert cfg.min_train_points == 4
        assert cfg.max_windows == 5

    def test_partial_override_preserves_defaults(self, tmp_path):
        yaml_content = "backtesting:\n  min_train_points: 20\n"
        p = tmp_path / "partial.yaml"
        p.write_text(yaml_content)
        cfg = load_backtest_config(p)
        assert cfg.min_train_points == 20
        assert cfg.step_size == 1
        assert cfg.random_seed == 42


# ─────────────────────────────────────────────────────────────────────────────
# Metric helpers — pure Python, no pandas/numpy needed
# ─────────────────────────────────────────────────────────────────────────────


class TestMetricHelpers:
    # MAE
    def test_mae_perfect(self):
        assert _mae([1.0, 2.0, 3.0], [1.0, 2.0, 3.0]) == pytest.approx(0.0)

    def test_mae_basic(self):
        assert _mae([0.0, 1.0], [1.0, 0.0]) == pytest.approx(1.0)

    def test_mae_asymmetric(self):
        # errors = [1, 3] → mean = 2
        assert _mae([0.0, 0.0], [1.0, 3.0]) == pytest.approx(2.0)

    def test_mae_empty(self):
        assert math.isnan(_mae([], []))

    # RMSE
    def test_rmse_perfect(self):
        assert _rmse([1.0, 2.0], [1.0, 2.0]) == pytest.approx(0.0)

    def test_rmse_basic(self):
        # errors = [1, 1], RMSE = sqrt(mean([1, 1])) = 1
        assert _rmse([0.0, 0.0], [1.0, 1.0]) == pytest.approx(1.0)

    def test_rmse_penalises_large_errors(self):
        # RMSE penalises large errors more than MAE for same data
        rmse = _rmse([0.0, 0.0], [0.0, 2.0])
        mae = _mae([0.0, 0.0], [0.0, 2.0])
        assert rmse > mae

    def test_rmse_empty(self):
        assert math.isnan(_rmse([], []))

    # MAPE
    def test_mape_perfect(self):
        assert _mape([1.0, 2.0], [1.0, 2.0]) == pytest.approx(0.0)

    def test_mape_skips_zero_actuals(self):
        # actual=0 skipped; only (1.0, 2.0) contributes → |1-2|/|1| * 100 = 100%
        result = _mape([0.0, 1.0], [0.5, 2.0])
        assert result == pytest.approx(100.0)

    def test_mape_all_zero_actuals_returns_nan(self):
        assert math.isnan(_mape([0.0, 0.0], [1.0, 2.0]))

    def test_mape_empty(self):
        assert math.isnan(_mape([], []))

    # Skill score
    def test_skill_score_better_than_naive(self):
        assert _skill_score(0.05, 0.10) == pytest.approx(0.5)

    def test_skill_score_equal_to_naive(self):
        assert _skill_score(0.10, 0.10) == pytest.approx(0.0)

    def test_skill_score_worse_than_naive(self):
        assert _skill_score(0.20, 0.10) == pytest.approx(-1.0)

    def test_skill_score_zero_naive_returns_nan(self):
        assert math.isnan(_skill_score(0.05, 0.0))

    def test_skill_score_nan_inputs_return_nan(self):
        assert math.isnan(_skill_score(float("nan"), 0.10))
        assert math.isnan(_skill_score(0.05, float("nan")))


# ─────────────────────────────────────────────────────────────────────────────
# BacktestResult helpers — pure Python
# ─────────────────────────────────────────────────────────────────────────────


class TestBacktestResult:
    def _make_result(self, confidence: str = "high") -> BacktestResult:
        return BacktestResult(
            windows=[],
            mean_mae_24h=0.03,
            mean_rmse_24h=0.04,
            mean_mape_24h=3.0,
            mean_mae_48h=0.05,
            mean_rmse_48h=0.06,
            mean_mape_48h=5.0,
            mean_naive_mae_24h=0.10,
            mean_naive_mae_48h=0.12,
            skill_score_24h=0.7,
            skill_score_48h=0.6,
            backtest_confidence=confidence,
            n_windows=10,
            config_snapshot={},
        )

    def test_summary_contains_confidence(self):
        result = self._make_result("high")
        summary = result.summary()
        assert "high" in summary

    def test_summary_contains_metrics(self):
        result = self._make_result()
        summary = result.summary()
        assert "MAE" in summary
        assert "RMSE" in summary
        assert "Skill" in summary

    def test_to_dict_is_json_safe(self):
        import json
        result = self._make_result()
        d = result.to_dict()
        # Should not raise
        json.dumps(d)

    def test_to_dict_replaces_nan_with_none(self):
        result = BacktestResult(backtest_confidence="insufficient_data")
        d = result.to_dict()
        assert d["mean_mae_24h"] is None

    def test_insufficient_data_default(self):
        result = BacktestResult()
        assert result.backtest_confidence == "insufficient_data"
        assert result.n_windows == 0


# ─────────────────────────────────────────────────────────────────────────────
# WalkForwardBacktester — guard paths (no real pandas needed)
# ─────────────────────────────────────────────────────────────────────────────


class TestWalkForwardBacktesterGuardPaths:
    """Tests that only check guard conditions; no real DataFrame needed."""

    def test_empty_df_returns_insufficient_data(self):
        """Passing a DataFrame-like with .empty=True should short-circuit."""
        bt = WalkForwardBacktester(BacktestConfig())
        mock_df = MagicMock()
        mock_df.empty = True
        result = bt.run(mock_df)
        assert result.backtest_confidence == "insufficient_data"
        assert result.n_windows == 0

    def test_too_few_rows_returns_insufficient_data(self):
        """DataFrame with fewer rows than min_train_points + horizons."""
        cfg = BacktestConfig(min_train_points=10, horizon_24h=2, horizon_48h=4)
        bt = WalkForwardBacktester(cfg)
        mock_df = MagicMock()
        mock_df.empty = False
        mock_df.__len__ = lambda self: 5  # 5 rows, need 10+4=14
        result = bt.run(mock_df)
        assert result.backtest_confidence == "insufficient_data"

    def test_derive_confidence_high(self):
        cfg = BacktestConfig(
            confidence_mae_threshold_good=0.5,
            confidence_mae_threshold_ok=0.8,
        )
        bt = WalkForwardBacktester(cfg)
        assert bt._derive_confidence(0.01) == "high"

    def test_derive_confidence_medium(self):
        cfg = BacktestConfig(
            confidence_mae_threshold_good=0.05,
            confidence_mae_threshold_ok=0.20,
        )
        bt = WalkForwardBacktester(cfg)
        assert bt._derive_confidence(0.10) == "medium"

    def test_derive_confidence_low(self):
        cfg = BacktestConfig(
            confidence_mae_threshold_good=0.05,
            confidence_mae_threshold_ok=0.15,
        )
        bt = WalkForwardBacktester(cfg)
        assert bt._derive_confidence(0.50) == "low"

    def test_derive_confidence_nan_returns_insufficient_data(self):
        bt = WalkForwardBacktester()
        assert bt._derive_confidence(float("nan")) == "insufficient_data"

    def test_aggregate_empty_windows_returns_insufficient_data(self):
        bt = WalkForwardBacktester()
        result = bt._aggregate([])
        assert result.backtest_confidence == "insufficient_data"
        assert result.n_windows == 0

    def test_aggregate_single_window(self):
        bt = WalkForwardBacktester(BacktestConfig(
            confidence_mae_threshold_good=0.5,
            confidence_mae_threshold_ok=0.9,
        ))
        window = BacktestWindow(
            window_index=0,
            train_size=10,
            mae_24h=0.02,
            rmse_24h=0.02,
            mape_24h=2.0,
            mae_48h=0.03,
            rmse_48h=0.03,
            mape_48h=3.0,
            naive_mae_24h=0.10,
            naive_mae_48h=0.12,
            model_backend="heuristic",
        )
        result = bt._aggregate([window])
        assert result.n_windows == 1
        assert result.mean_mae_24h == pytest.approx(0.02)
        assert result.mean_mae_48h == pytest.approx(0.03)
        assert result.backtest_confidence == "high"
        assert result.skill_score_24h == pytest.approx(1.0 - 0.02 / 0.10)

    def test_aggregate_preserves_config_snapshot(self):
        cfg = BacktestConfig(random_seed=77, max_windows=5)
        bt = WalkForwardBacktester(cfg)
        window = BacktestWindow(0, 10, 0.02, 0.02, 2.0, 0.03, 0.03, 3.0, 0.10, 0.12, "heuristic")
        result = bt._aggregate([window])
        assert result.config_snapshot["random_seed"] == 77
        assert result.config_snapshot["max_windows"] == 5

    def test_aggregate_nan_mape_handled(self):
        """Windows with NaN MAPE (zero actuals) should not crash aggregation."""
        bt = WalkForwardBacktester(BacktestConfig(
            confidence_mae_threshold_good=0.5,
            confidence_mae_threshold_ok=0.9,
        ))
        window = BacktestWindow(
            window_index=0,
            train_size=10,
            mae_24h=0.02,
            rmse_24h=0.02,
            mape_24h=float("nan"),
            mae_48h=0.03,
            rmse_48h=0.03,
            mape_48h=float("nan"),
            naive_mae_24h=0.10,
            naive_mae_48h=0.12,
            model_backend="heuristic",
        )
        result = bt._aggregate([window])
        assert math.isnan(result.mean_mape_24h)
        assert math.isnan(result.mean_mape_48h)


# ─────────────────────────────────────────────────────────────────────────────
# WalkForwardBacktester — full run tests (require real pandas)
# ─────────────────────────────────────────────────────────────────────────────


@needs_pandas
class TestWalkForwardBacktesterFullRun:
    """Integration-style tests requiring real pandas DataFrames."""

    def test_run_produces_windows(self):
        cfg = BacktestConfig(
            min_train_points=5,
            step_size=2,
            horizon_24h=1,
            horizon_48h=2,
            max_windows=0,
        )
        bt = WalkForwardBacktester(cfg)
        df = _make_df(30)
        result = bt.run(df)
        assert result.n_windows > 0

    def test_run_aggregates_are_finite(self):
        cfg = BacktestConfig(
            min_train_points=5,
            step_size=2,
            horizon_24h=1,
            horizon_48h=2,
        )
        bt = WalkForwardBacktester(cfg)
        df = _make_df(30)
        result = bt.run(df)
        for attr in ("mean_mae_24h", "mean_rmse_24h", "mean_mae_48h", "mean_rmse_48h"):
            val = getattr(result, attr)
            if not math.isnan(val):
                assert math.isfinite(val), f"{attr} should be finite, got {val}"

    def test_run_confidence_is_valid_label(self):
        cfg = BacktestConfig(min_train_points=5, step_size=3, horizon_24h=1, horizon_48h=2)
        bt = WalkForwardBacktester(cfg)
        df = _make_df(30)
        result = bt.run(df)
        valid = {"high", "medium", "low", "insufficient_data"}
        assert result.backtest_confidence in valid

    def test_max_windows_cap(self):
        cfg = BacktestConfig(
            min_train_points=5,
            step_size=1,
            horizon_24h=1,
            horizon_48h=2,
            max_windows=3,
        )
        bt = WalkForwardBacktester(cfg)
        df = _make_df(50)
        result = bt.run(df)
        assert result.n_windows <= 3

    def test_naive_mae_is_nonnegative(self):
        cfg = BacktestConfig(min_train_points=5, step_size=3, horizon_24h=1, horizon_48h=2)
        bt = WalkForwardBacktester(cfg)
        df = _make_df(30)
        result = bt.run(df)
        if not math.isnan(result.mean_naive_mae_24h):
            assert result.mean_naive_mae_24h >= 0.0
        if not math.isnan(result.mean_naive_mae_48h):
            assert result.mean_naive_mae_48h >= 0.0

    def test_skill_score_is_finite(self):
        cfg = BacktestConfig(min_train_points=5, step_size=3, horizon_24h=1, horizon_48h=2)
        bt = WalkForwardBacktester(cfg)
        df = _make_df(30)
        result = bt.run(df)
        for ss in (result.skill_score_24h, result.skill_score_48h):
            if not math.isnan(ss):
                assert math.isfinite(ss)

    def test_same_config_produces_same_result(self):
        cfg = BacktestConfig(min_train_points=5, step_size=2, horizon_24h=1, horizon_48h=2, random_seed=42)
        df = _make_df(30)
        r1 = WalkForwardBacktester(cfg).run(df)
        r2 = WalkForwardBacktester(cfg).run(df)
        assert r1.n_windows == r2.n_windows
        if not math.isnan(r1.mean_mae_24h) and not math.isnan(r2.mean_mae_24h):
            assert r1.mean_mae_24h == pytest.approx(r2.mean_mae_24h)

    def test_result_contains_config_snapshot(self):
        cfg = BacktestConfig(min_train_points=5, random_seed=77, max_windows=5)
        bt = WalkForwardBacktester(cfg)
        df = _make_df(30)
        result = bt.run(df)
        snap = result.config_snapshot
        assert snap["random_seed"] == 77
        assert snap["max_windows"] == 5

    def test_infer_horizons_from_hourly_data(self):
        """With 1-hour spacing the inferred horizons should be 24 and 48."""
        bt = WalkForwardBacktester(BacktestConfig())
        df = _make_df(100)
        h24, h48 = bt._infer_horizons(df)
        assert h24 == 24
        assert h48 == 48

    def test_infer_horizons_single_row_falls_back(self):
        bt = WalkForwardBacktester(BacktestConfig(horizon_24h=1, horizon_48h=2))
        df = _make_df(1)
        h24, h48 = bt._infer_horizons(df)
        assert h24 == 1
        assert h48 == 2

    def test_window_mae_is_non_negative(self):
        cfg = BacktestConfig(min_train_points=5, step_size=5, horizon_24h=1, horizon_48h=2)
        bt = WalkForwardBacktester(cfg)
        df = _make_df(30)
        result = bt.run(df)
        for w in result.windows:
            assert w.mae_24h >= 0.0
            assert w.mae_48h >= 0.0
            assert w.naive_mae_24h >= 0.0
            assert w.naive_mae_48h >= 0.0

    def test_window_model_backend_is_valid(self):
        cfg = BacktestConfig(min_train_points=5, step_size=5, horizon_24h=1, horizon_48h=2)
        bt = WalkForwardBacktester(cfg)
        df = _make_df(30)
        result = bt.run(df)
        valid_backends = {"prophet", "sklearn", "heuristic"}
        for w in result.windows:
            assert w.model_backend in valid_backends


# ─────────────────────────────────────────────────────────────────────────────
# Integration: ForecastResult has backtest_confidence field
# ─────────────────────────────────────────────────────────────────────────────


class TestForecastResultBacktestConfidence:
    """Verify the forecaster wires backtest_confidence into ForecastResult."""

    def test_backtest_confidence_field_exists(self):
        from src.analytics.forecaster import ForecastResult

        result = ForecastResult(
            predicted_trend_24h="bullish",
            predicted_trend_48h="neutral",
            confidence_24h=0.7,
            confidence_48h=0.5,
            sentiment_velocity=0.01,
            forecast_score_24h=0.3,
            forecast_score_48h=0.1,
            model_backend="heuristic",
            data_points_used=5,
            generated_at="2024-01-01T00:00:00+00:00",
        )
        assert hasattr(result, "backtest_confidence")
        assert result.backtest_confidence == "insufficient_data"

    def test_backtest_confidence_in_to_dict(self):
        from src.analytics.forecaster import ForecastResult

        result = ForecastResult(
            predicted_trend_24h="bullish",
            predicted_trend_48h="neutral",
            confidence_24h=0.7,
            confidence_48h=0.5,
            sentiment_velocity=0.01,
            forecast_score_24h=0.3,
            forecast_score_48h=0.1,
            model_backend="heuristic",
            data_points_used=5,
            generated_at="2024-01-01T00:00:00+00:00",
            backtest_confidence="high",
        )
        d = result.to_dict()
        assert "backtest_confidence" in d
        assert d["backtest_confidence"] == "high"

    def test_backtest_confidence_custom_value_survives_round_trip(self):
        from src.analytics.forecaster import ForecastResult

        for label in ("high", "medium", "low", "insufficient_data"):
            result = ForecastResult(
                predicted_trend_24h="neutral",
                predicted_trend_48h="neutral",
                confidence_24h=0.5,
                confidence_48h=0.5,
                sentiment_velocity=0.0,
                forecast_score_24h=0.0,
                forecast_score_48h=0.0,
                model_backend="heuristic",
                data_points_used=0,
                generated_at="2024-01-01T00:00:00+00:00",
                backtest_confidence=label,
            )
            assert result.to_dict()["backtest_confidence"] == label

    def test_run_with_backtest_disabled_gives_insufficient_data(self):
        from src.analytics.forecaster import SentimentForecaster

        fc = SentimentForecaster()
        # Stub load_history to return empty df (triggers heuristic / no-train path)
        fc.load_history = lambda *_a, **_kw: MagicMock(
            **{"empty": True, "__len__": lambda s: 0}
        )
        result = fc.run(run_backtest=False)
        assert result.backtest_confidence == "insufficient_data"

    def test_backtest_exception_leaves_field_as_insufficient_data(self):
        """If the backtest raises, run() should not propagate the exception."""
        from src.analytics.forecaster import SentimentForecaster

        fc = SentimentForecaster()
        # Return a truthy empty-like mock so predict path runs
        mock_df = MagicMock()
        mock_df.__bool__ = lambda s: True
        mock_df.__len__ = lambda s: 0
        mock_df.empty = True
        mock_df.empty = True
        fc.load_history = lambda *_a, **_kw: mock_df

        with patch(
            "src.analytics.backtesting.WalkForwardBacktester",
            side_effect=RuntimeError("boom"),
        ):
            result = fc.run(run_backtest=True)

        assert result.backtest_confidence == "insufficient_data"
