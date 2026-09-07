# -*- coding: utf-8 -*-
"""
Tests for the walk-forward backtesting harness.

Covers:
  - Configuration loading and reproducibility (hash stability).
  - Error metric correctness (MAE, RMSE, MAPE).
  - Naive baseline behaviour.
  - Walk-forward windowing logic.
  - End-to-end backtest on synthetic data.
  - Backtest confidence derivation.
  - ForecastResult includes backtest_confidence field.
"""

import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from src.analytics.backtest import (
    BacktestConfig,
    BacktestResult,
    BaselineMetrics,
    HorizonMetrics,
    _derive_confidence,
    _mae,
    _mape,
    _rmse,
    load_config,
    run_backtest,
)
from src.analytics.forecaster import ForecastResult, SentimentForecaster


# ── Helpers ────────────────────────────────────────────────────────────────


def _make_synthetic_df(n: int = 100, seed: int = 42) -> pd.DataFrame:
    """Create a synthetic analytics.jsonl-style DataFrame."""
    rng = np.random.default_rng(seed)
    base = datetime(2025, 1, 1, tzinfo=timezone.utc)
    timestamps = [base + timedelta(hours=i) for i in range(n)]
    # Smooth random walk for sentiment
    steps = rng.normal(0, 0.02, n)
    sentiment = np.cumsum(steps)
    sentiment = np.clip(sentiment, -1, 1)

    return pd.DataFrame(
        {
            "timestamp": timestamps,
            "sentiment_score": sentiment.tolist(),
            "news_count": rng.integers(1, 50, n).tolist(),
            "positive_pct": rng.uniform(0.1, 0.6, n).tolist(),
            "negative_pct": rng.uniform(0.1, 0.4, n).tolist(),
            "neutral_pct": rng.uniform(0.2, 0.5, n).tolist(),
        }
    )


def _write_jsonl(df: pd.DataFrame, path: Path) -> None:
    """Write a DataFrame to analytics.jsonl format."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as fh:
        for _, row in df.iterrows():
            record = {
                "timestamp": row["timestamp"].isoformat(),
                "news_count": int(row["news_count"]),
                "sentiment_data": {
                    "average_compound_score": float(row["sentiment_score"]),
                    "sentiment_distribution": {
                        "positive": float(row["positive_pct"]),
                        "negative": float(row["negative_pct"]),
                        "neutral": float(row["neutral_pct"]),
                    },
                },
            }
            fh.write(json.dumps(record) + "\n")


# ── Error metric tests ────────────────────────────────────────────────────


class TestErrorMetrics:
    def test_mae_perfect_prediction(self):
        y = np.array([0.1, 0.2, 0.3])
        assert _mae(y, y) == pytest.approx(0.0)

    def test_mae_known_value(self):
        y_true = np.array([0.0, 0.5, 1.0])
        y_pred = np.array([0.1, 0.4, 0.9])
        assert _mae(y_true, y_pred) == pytest.approx(0.1)

    def test_rmse_perfect_prediction(self):
        y = np.array([0.1, 0.2, 0.3])
        assert _rmse(y, y) == pytest.approx(0.0)

    def test_rmse_known_value(self):
        y_true = np.array([0.0, 0.0])
        y_pred = np.array([1.0, -1.0])
        assert _rmse(y_true, y_pred) == pytest.approx(1.0)

    def test_mape_perfect_prediction(self):
        y = np.array([0.5, 0.3])
        assert _mape(y, y) == pytest.approx(0.0)

    def test_mape_known_value(self):
        y_true = np.array([1.0, 1.0])
        y_pred = np.array([0.9, 0.8])
        # |1-0.9|/1 * 100 = 10, |1-0.8|/1 * 100 = 20 → mean = 15
        assert _mape(y_true, y_pred) == pytest.approx(15.0)


# ── Configuration tests ───────────────────────────────────────────────────


class TestBacktestConfig:
    def test_default_config(self):
        cfg = BacktestConfig()
        assert cfg.n_windows == 5
        assert cfg.min_train_points == 10
        assert cfg.horizons == [24, 48]

    def test_config_hash_stable(self):
        cfg = BacktestConfig()
        h1 = cfg.hash()
        h2 = cfg.hash()
        assert h1 == h2
        assert len(h1) == 12

    def test_config_hash_changes_with_values(self):
        cfg1 = BacktestConfig(n_windows=5)
        cfg2 = BacktestConfig(n_windows=10)
        assert cfg1.hash() != cfg2.hash()

    def test_load_config_from_file(self, tmp_path: Path):
        cfg_data = {"n_windows": 3, "min_train_points": 8}
        cfg_file = tmp_path / "backtest_config.yaml"
        import yaml

        with open(cfg_file, "w") as fh:
            yaml.safe_dump(cfg_data, fh)

        cfg = load_config(cfg_file)
        assert cfg.n_windows == 3
        assert cfg.min_train_points == 8
        # Defaults preserved for unspecified fields
        assert cfg.horizons == [24, 48]

    def test_load_config_missing_file(self, tmp_path: Path):
        cfg = load_config(tmp_path / "nonexistent.yaml")
        assert isinstance(cfg, BacktestConfig)
        assert cfg.n_windows == 5  # default


# ── Naive baseline tests ──────────────────────────────────────────────────


class TestNaiveBaseline:
    def test_naive_returns_last_value(self):
        df = _make_synthetic_df(n=20)
        from src.analytics.backtest import _naive_forecast

        result = _naive_forecast(df, 24)
        assert result == pytest.approx(float(df["sentiment_score"].iloc[-1]))

    def test_naive_empty_dataframe(self):
        from src.analytics.backtest import _naive_forecast

        result = _naive_forecast(pd.DataFrame(), 24)
        assert result == 0.0


# ── Confidence derivation tests ───────────────────────────────────────────


class TestConfidenceDerivation:
    def test_perfect_forecaster_high_confidence(self):
        metrics = [
            HorizonMetrics(horizon_hours=24, mae=0.01, rmse=0.02, mape=1.0, n_windows=3),
            HorizonMetrics(horizon_hours=48, mae=0.02, rmse=0.03, mape=2.0, n_windows=3),
        ]
        baseline = [
            BaselineMetrics(horizon_hours=24, mae=0.5, rmse=0.6, mape=30.0),
            BaselineMetrics(horizon_hours=48, mae=0.6, rmse=0.7, mape=40.0),
        ]
        conf = _derive_confidence(metrics, baseline)
        assert 0.0 <= conf <= 1.0
        # Much better than baseline → high confidence
        assert conf > 0.5

    def test_worse_than_baseline_low_confidence(self):
        metrics = [
            HorizonMetrics(horizon_hours=24, mae=0.8, rmse=0.9, mape=50.0, n_windows=3),
        ]
        baseline = [
            BaselineMetrics(horizon_hours=24, mae=0.2, rmse=0.3, mape=10.0),
        ]
        conf = _derive_confidence(metrics, baseline)
        assert conf == pytest.approx(0.0)

    def test_empty_metrics_returns_zero(self):
        conf = _derive_confidence([], [])
        assert conf == 0.0


# ── End-to-end backtest tests ─────────────────────────────────────────────


class TestRunBacktest:
    def test_backtest_runs_on_synthetic_data(self):
        df = _make_synthetic_df(n=100)
        cfg = BacktestConfig(n_windows=3, min_train_points=20)
        result = run_backtest(df, config=cfg)

        assert isinstance(result, BacktestResult)
        assert result.n_windows > 0
        assert len(result.metrics) == 2  # 24h and 48h
        assert result.config_hash == cfg.hash()
        assert result.generated_at

    def test_backtest_reproducibility(self):
        """Same data + same config → same result."""
        df = _make_synthetic_df(n=80)
        cfg = BacktestConfig(n_windows=2, min_train_points=15, seed=123)

        r1 = run_backtest(df, config=cfg)
        r2 = run_backtest(df, config=cfg)

        assert r1.config_hash == r2.config_hash
        assert r1.n_windows == r2.n_windows
        for m1, m2 in zip(r1.metrics, r2.metrics):
            assert m1.mae == pytest.approx(m2.mae)
            assert m1.rmse == pytest.approx(m2.rmse)

    def test_backtest_insufficient_data(self):
        df = _make_synthetic_df(n=5)
        cfg = BacktestConfig(min_train_points=20)
        result = run_backtest(df, config=cfg)
        assert result.n_windows == 0
        assert result.confidence_score == 0.0

    def test_backtest_includes_baseline(self):
        df = _make_synthetic_df(n=100)
        cfg = BacktestConfig(n_windows=2, min_train_points=20)
        result = run_backtest(df, config=cfg)

        assert len(result.baseline_metrics) == 2
        for bm in result.baseline_metrics:
            assert bm.mae >= 0
            assert bm.rmse >= 0

    def test_backtest_per_window_scores(self):
        df = _make_synthetic_df(n=100)
        cfg = BacktestConfig(n_windows=3, min_train_points=20)
        result = run_backtest(df, config=cfg)

        assert len(result.per_window_scores) == result.n_windows
        for w in result.per_window_scores:
            assert "window" in w
            assert "actual_24h" in w
            assert "pred_24h" in w
            assert "naive_24h" in w

    def test_backtest_result_to_dict(self):
        df = _make_synthetic_df(n=100)
        cfg = BacktestConfig(n_windows=2, min_train_points=20)
        result = run_backtest(df, config=cfg)
        d = result.to_dict()

        assert "config_hash" in d
        assert "n_windows" in d
        assert "horizons" in d
        assert "metrics" in d
        assert "baseline_metrics" in d
        assert "confidence_score" in d


# ── ForecastResult integration tests ──────────────────────────────────────


class TestForecastResultIntegration:
    def test_forecast_result_has_backtest_confidence_field(self):
        """Verify the ForecastResult dataclass includes backtest_confidence."""
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
            generated_at=datetime.now(timezone.utc).isoformat(),
        )
        assert result.backtest_confidence == 0.0  # default

    def test_forecast_result_to_dict_includes_backtest_confidence(self):
        result = ForecastResult(
            predicted_trend_24h="bullish",
            predicted_trend_48h="neutral",
            confidence_24h=0.7,
            confidence_48h=0.5,
            sentiment_velocity=0.01,
            forecast_score_24h=0.3,
            forecast_score_48h=0.1,
            model_backend="sklearn",
            data_points_used=50,
            generated_at=datetime.now(timezone.utc).isoformat(),
            backtest_confidence=0.75,
        )
        d = result.to_dict()
        assert "backtest_confidence" in d
        assert d["backtest_confidence"] == 0.75

    def test_predict_accepts_backtest_confidence(self):
        df = _make_synthetic_df(n=50)
        forecaster = SentimentForecaster()
        forecaster.train(df)

        result = forecaster.predict(df, backtest_confidence=0.85)
        assert result.backtest_confidence == pytest.approx(0.85)

    def test_run_includes_backtest_confidence(self, tmp_path: Path):
        """End-to-end: run() should include a backtest_confidence value."""
        df = _make_synthetic_df(n=100)
        jsonl_path = tmp_path / "analytics.jsonl"
        _write_jsonl(df, jsonl_path)

        forecaster = SentimentForecaster(jsonl_path=jsonl_path)
        result = forecaster.run()

        assert isinstance(result, ForecastResult)
        assert 0.0 <= result.backtest_confidence <= 1.0
