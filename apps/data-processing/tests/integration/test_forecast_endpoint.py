# -*- coding: utf-8 -*-
"""
Integration tests for the /analytics/forecast endpoint.

Verifies that the forecast API response includes the backtest_confidence
field derived from walk-forward evaluation.
"""

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from src.analytics.forecaster import SentimentForecaster


def _make_synthetic_df(n: int = 100, seed: int = 42):
    """Create a synthetic analytics.jsonl-style DataFrame."""
    import numpy as np
    import pandas as pd

    rng = np.random.default_rng(seed)
    base = datetime(2025, 1, 1, tzinfo=timezone.utc)
    timestamps = [base + timedelta(hours=i) for i in range(n)]
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


def _write_jsonl(df, path: Path) -> None:
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


class TestForecastEndpoint:
    """Tests for the /analytics/forecast API endpoint."""

    @pytest.fixture
    def sample_jsonl(self, tmp_path: Path) -> Path:
        """Create a sample analytics.jsonl file for testing."""
        df = _make_synthetic_df(n=100)
        path = tmp_path / "analytics.jsonl"
        _write_jsonl(df, path)
        return path

    def test_forecast_response_includes_backtest_confidence(self, sample_jsonl):
        """Verify the forecast response includes backtest_confidence."""
        forecaster = SentimentForecaster(jsonl_path=sample_jsonl)
        result = forecaster.run()

        # The result should have backtest_confidence
        assert hasattr(result, "backtest_confidence")
        assert 0.0 <= result.backtest_confidence <= 1.0

    def test_forecast_response_dict_has_backtest_confidence(self, sample_jsonl):
        """Verify the forecast response dict includes backtest_confidence."""
        forecaster = SentimentForecaster(jsonl_path=sample_jsonl)
        result = forecaster.run()
        result_dict = result.to_dict()

        assert "backtest_confidence" in result_dict
        assert isinstance(result_dict["backtest_confidence"], float)

    def test_forecast_response_has_all_required_fields(self, sample_jsonl):
        """Verify the forecast response includes all required fields."""
        forecaster = SentimentForecaster(jsonl_path=sample_jsonl)
        result = forecaster.run()
        result_dict = result.to_dict()

        required_fields = [
            "predicted_trend_24h",
            "predicted_trend_48h",
            "confidence_24h",
            "confidence_48h",
            "sentiment_velocity",
            "forecast_score_24h",
            "forecast_score_48h",
            "model_backend",
            "data_points_used",
            "generated_at",
            "backtest_confidence",
        ]
        for field in required_fields:
            assert field in result_dict, f"Missing field: {field}"
