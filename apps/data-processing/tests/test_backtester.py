# -*- coding: utf-8 -*-
"""Tests for the walk-forward backtesting harness (Issue #1244)."""

import math
from typing import Dict

import numpy as np
import pandas as pd
import pytest

from src.analytics.backtester import (
    BacktestConfig,
    BacktestHarness,
    BacktestReport,
    HorizonMetrics,
    load_config,
    mae,
    mape,
    rmse,
)


# ─────────────────────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────────────────────


def _make_df(n: int = 80, seed: int = 42) -> pd.DataFrame:
    """Generate a synthetic sentiment DataFrame with `n` hourly rows."""
    rng = np.random.default_rng(seed)
    timestamps = pd.date_range("2024-01-01", periods=n, freq="h")
    # Slightly trending sentiment with noise
    scores = np.clip(
        0.1 + np.linspace(0, 0.3, n) + rng.normal(0, 0.05, n), -1.0, 1.0
    )
    return pd.DataFrame(
        {
            "timestamp": timestamps,
            "sentiment_score": scores.tolist(),
            "news_count": rng.integers(5, 50, n).tolist(),
            "positive_pct": rng.uniform(0.3, 0.7, n).tolist(),
            "negative_pct": rng.uniform(0.1, 0.4, n).tolist(),
            "neutral_pct": rng.uniform(0.1, 0.3, n).tolist(),
        }
    )


# ─────────────────────────────────────────────────────────────────────────────
# Error metric unit tests
# ─────────────────────────────────────────────────────────────────────────────


class TestErrorMetrics:
    def test_mae_perfect(self):
        assert mae([1.0, 2.0, 3.0], [1.0, 2.0, 3.0]) == pytest.approx(0.0)

    def test_mae_known(self):
        assert mae([0.0, 1.0], [1.0, 0.0]) == pytest.approx(1.0)

    def test_mae_empty(self):
        assert math.isnan(mae([], []))

    def test_rmse_perfect(self):
        assert rmse([1.0, 2.0], [1.0, 2.0]) == pytest.approx(0.0)

    def test_rmse_known(self):
        # errors = [1, -1], squared = [1, 1], mean = 1, sqrt = 1
        assert rmse([0.0, 2.0], [1.0, 1.0]) == pytest.approx(1.0)

    def test_rmse_empty(self):
        assert math.isnan(rmse([], []))

    def test_mape_known(self):
        # |actual - pred| / |actual| = |(1 - 2)| / 1 = 1.0 → 100%
        result = mape([1.0], [2.0])
        assert result == pytest.approx(100.0)

    def test_mape_zero_actuals_excluded(self):
        # When all actuals are zero, result should be NaN
        assert math.isnan(mape([0.0, 0.0], [1.0, 1.0]))

    def test_mape_empty(self):
        assert math.isnan(mape([], []))


# ─────────────────────────────────────────────────────────────────────────────
# BacktestConfig and load_config tests
# ─────────────────────────────────────────────────────────────────────────────


class TestBacktestConfig:
    def test_defaults(self):
        cfg = BacktestConfig()
        assert cfg.initial_train_size == 20
        assert cfg.step_size == 1
        assert cfg.horizons == [24, 48]
        assert cfg.random_seed == 42

    def test_load_config_missing_file_uses_defaults(self, tmp_path):
        cfg = load_config(tmp_path / "nonexistent.yaml")
        assert isinstance(cfg, BacktestConfig)
        assert cfg.initial_train_size == 20

    def test_load_config_from_yaml(self, tmp_path):
        config_file = tmp_path / "backtest.yaml"
        config_file.write_text(
            "initial_train_size: 30\nstep_size: 2\nhorizons: [24]\n"
            "mae_good_threshold: 0.05\nmae_warn_threshold: 0.15\nrandom_seed: 7\n"
        )
        cfg = load_config(config_file)
        assert cfg.initial_train_size == 30
        assert cfg.step_size == 2
        assert cfg.horizons == [24]
        assert cfg.mae_good_threshold == pytest.approx(0.05)
        assert cfg.random_seed == 7


# ─────────────────────────────────────────────────────────────────────────────
# BacktestHarness tests
# ─────────────────────────────────────────────────────────────────────────────


class TestBacktestHarness:
    def _small_config(self) -> BacktestConfig:
        """Fast config for unit testing."""
        return BacktestConfig(
            initial_train_size=10,
            step_size=5,
            horizons=[24, 48],
            mae_good_threshold=0.10,
            mae_warn_threshold=0.25,
            random_seed=42,
        )

    def test_run_returns_report(self):
        df = _make_df(n=100)
        harness = BacktestHarness(self._small_config())
        report = harness.run(df)
        assert isinstance(report, BacktestReport)

    def test_report_has_both_horizons(self):
        df = _make_df(n=100)
        harness = BacktestHarness(self._small_config())
        report = harness.run(df)
        assert 24 in report.horizons
        assert 48 in report.horizons

    def test_report_has_positive_folds(self):
        df = _make_df(n=100)
        harness = BacktestHarness(self._small_config())
        report = harness.run(df)
        assert report.n_folds_run > 0

    def test_metrics_finite(self):
        df = _make_df(n=100)
        harness = BacktestHarness(self._small_config())
        report = harness.run(df)
        for h, m in report.horizons.items():
            assert not math.isnan(m.mae), f"MAE is NaN for horizon {h}h"
            assert not math.isnan(m.rmse), f"RMSE is NaN for horizon {h}h"
            assert m.mae >= 0.0
            assert m.rmse >= 0.0

    def test_baseline_included(self):
        df = _make_df(n=100)
        harness = BacktestHarness(self._small_config())
        report = harness.run(df)
        for h, m in report.horizons.items():
            assert m.baseline_mae >= 0.0

    def test_confidence_indication_valid(self):
        df = _make_df(n=100)
        harness = BacktestHarness(self._small_config())
        report = harness.run(df)
        assert report.confidence_indication in ("high", "medium", "low")

    def test_empty_dataframe_raises(self):
        harness = BacktestHarness(self._small_config())
        with pytest.raises(ValueError, match="non-empty"):
            harness.run(pd.DataFrame())

    def test_insufficient_rows_raises(self):
        harness = BacktestHarness(self._small_config())
        df = _make_df(n=5)  # too few rows
        with pytest.raises(ValueError):
            harness.run(df)

    def test_to_dict_serialisable(self):
        df = _make_df(n=100)
        harness = BacktestHarness(self._small_config())
        report = harness.run(df)
        d = report.to_dict()
        assert "horizons" in d
        assert "confidence_indication" in d
        assert "n_folds_run" in d

    def test_summary_contains_horizons(self):
        df = _make_df(n=100)
        harness = BacktestHarness(self._small_config())
        report = harness.run(df)
        summary = report.summary()
        assert "24h" in summary
        assert "48h" in summary

    def test_naive_baseline_is_last_value(self):
        """Naive pred should equal the last training sentiment score."""
        df = _make_df(n=100)
        train = df.iloc[:15]
        naive = BacktestHarness._predict_naive(train)
        assert naive == pytest.approx(float(train["sentiment_score"].iloc[-1]))

    def test_reproducible_results(self):
        """Same config + data must yield identical results."""
        df = _make_df(n=100)
        cfg = self._small_config()
        report1 = BacktestHarness(cfg).run(df)
        report2 = BacktestHarness(cfg).run(df)
        for h in report1.horizons:
            assert report1.horizons[h].mae == pytest.approx(
                report2.horizons[h].mae
            )


# ─────────────────────────────────────────────────────────────────────────────
# Confidence derivation unit tests
# ─────────────────────────────────────────────────────────────────────────────


class TestConfidenceDerivation:
    def _harness(self):
        return BacktestHarness(
            BacktestConfig(
                mae_good_threshold=0.10,
                mae_warn_threshold=0.25,
            )
        )

    def _metrics(self, mae_val: float) -> Dict[int, HorizonMetrics]:
        return {
            24: HorizonMetrics(
                horizon_h=24,
                n_folds=10,
                mae=mae_val,
                rmse=mae_val,
                mape=5.0,
                baseline_mae=0.30,
                baseline_rmse=0.30,
                improvement_pct=0.0,
            )
        }

    def test_high_confidence(self):
        h = self._harness()
        assert h._derive_confidence(self._metrics(0.05)) == "high"

    def test_medium_confidence(self):
        h = self._harness()
        assert h._derive_confidence(self._metrics(0.15)) == "medium"

    def test_low_confidence(self):
        h = self._harness()
        assert h._derive_confidence(self._metrics(0.30)) == "low"

    def test_empty_metrics_gives_low(self):
        h = self._harness()
        assert h._derive_confidence({}) == "low"
