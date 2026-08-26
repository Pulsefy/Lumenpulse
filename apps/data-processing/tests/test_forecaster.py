from datetime import datetime, timedelta, timezone

import pandas as pd
import pytest

from src.analytics.forecaster import SentimentForecaster


def _history(size=120):
    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    timestamps = [start + timedelta(hours=index) for index in range(size)]
    scores = [0.1 + index * 0.002 for index in range(size)]
    return pd.DataFrame(
        {
            "timestamp": timestamps,
            "sentiment_score": scores,
            "news_count": [20] * size,
            "positive_pct": [0.6] * size,
            "negative_pct": [0.2] * size,
            "neutral_pct": [0.2] * size,
        }
    )


def _require_real_pandas():
    if not hasattr(pd.DataFrame, "sort_values"):
        pytest.skip("pandas is unavailable; tests/conftest.py installed a stub")


def test_walk_forward_reports_model_and_naive_metrics_per_horizon():
    _require_real_pandas()
    forecaster = SentimentForecaster()
    result = forecaster.run_backtest(
        _history(),
        {
            "horizons_hours": [24, 48],
            "min_training_points": 48,
            "max_windows": 4,
            "step": 2,
        },
    )

    assert result["config"]["max_windows"] == 4
    for horizon in ("24", "48"):
        metrics = result["horizons"][horizon]
        assert metrics["windows"] == 4
        assert set(metrics["model"]) == {"mae", "rmse", "mape"}
        assert set(metrics["naive"]) == {"mae", "rmse", "mape"}
        assert metrics["naive"]["rmse"] > 0
        assert metrics["improvement"] is not None


def test_backtest_is_reproducible_and_calibrates_confidence():
    _require_real_pandas()
    history = _history()
    config = {
        "horizons_hours": [24, 48],
        "min_training_points": 48,
        "max_windows": 3,
        "step": 1,
    }
    first = SentimentForecaster()
    second = SentimentForecaster()
    assert first.run_backtest(history, config) == second.run_backtest(history, config)

    first.run_backtest(history, config)
    first.train(history)
    result = first.predict(history)
    assert result.backtest_metrics["horizons"]["24"]["windows"] == 3
    assert 0.0 <= result.confidence_24h <= 1.0


def test_run_loads_committed_backtest_configuration(tmp_path):
    history_path = tmp_path / "analytics.jsonl"
    history_path.write_text("")
    forecaster = SentimentForecaster(jsonl_path=history_path)
    config = forecaster.load_backtest_config()

    assert config == {
        "horizons_hours": [24, 48],
        "min_training_points": 24,
        "max_windows": 12,
        "step": 1,
    }
