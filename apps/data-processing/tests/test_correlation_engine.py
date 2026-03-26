"""
Unit tests for CorrelationEngine class.
"""

import unittest
from datetime import datetime, timedelta
from src.analytics.correlation_engine import (
    CorrelationEngine,
    CorrelationResult,
    DataPoint,
)


class TestCorrelationEngine(unittest.TestCase):
    """Test cases for CorrelationEngine functionality"""

    def setUp(self):
        """Set up test data."""
        base_time = datetime(2024, 1, 1, 0, 0, 0)

        # Strongly correlated data (positive)
        self.sentiment_positive = [
            {"timestamp": (base_time + timedelta(hours=i)).isoformat(), "score": 0.1 * i}
            for i in range(20)
        ]
        self.volume_positive = [
            {"timestamp": (base_time + timedelta(hours=i)).isoformat(), "value": 100 + 10 * i}
            for i in range(20)
        ]

        # Negatively correlated data
        self.sentiment_negative = [
            {"timestamp": (base_time + timedelta(hours=i)).isoformat(), "score": 0.1 * i}
            for i in range(20)
        ]
        self.volume_negative = [
            {"timestamp": (base_time + timedelta(hours=i)).isoformat(), "value": 300 - 10 * i}
            for i in range(20)
        ]

        # Uncorrelated data
        self.sentiment_random = [
            {"timestamp": (base_time + timedelta(hours=i)).isoformat(), "score": (i % 3) * 0.3 - 0.3}
            for i in range(20)
        ]
        self.volume_random = [
            {"timestamp": (base_time + timedelta(hours=i)).isoformat(), "value": 100 + ((i * 7) % 11) * 10}
            for i in range(20)
        ]

    def test_positive_correlation(self):
        """Test detection of strong positive correlation."""
        result = CorrelationEngine.calculate_correlation(
            self.sentiment_positive, self.volume_positive, metric_type="volume"
        )

        self.assertIsInstance(result, CorrelationResult)
        self.assertGreater(result.correlation_score, 0.9)
        self.assertEqual(result.metric_type, "volume")
        self.assertGreater(result.sample_size, 0)

    def test_negative_correlation(self):
        """Test detection of strong negative correlation."""
        result = CorrelationEngine.calculate_correlation(
            self.sentiment_negative, self.volume_negative, metric_type="volume"
        )

        self.assertLess(result.correlation_score, -0.9)
        self.assertIn(result.confidence_level, ["high", "medium", "low"])

    def test_correlation_bounds(self):
        """Test that correlation score is bounded between -1 and 1."""
        result = CorrelationEngine.calculate_correlation(
            self.sentiment_positive, self.volume_positive, metric_type="price"
        )

        self.assertGreaterEqual(result.correlation_score, -1.0)
        self.assertLessEqual(result.correlation_score, 1.0)

    def test_empty_data(self):
        """Test handling of empty datasets."""
        result = CorrelationEngine.calculate_correlation([], [], metric_type="volume")

        self.assertEqual(result.correlation_score, 0.0)
        self.assertEqual(result.sample_size, 0)
        self.assertEqual(result.confidence_level, "insufficient_data")

    def test_insufficient_data(self):
        """Test handling of insufficient data points."""
        base_time = datetime(2024, 1, 1, 0, 0, 0)
        small_sentiment = [
            {"timestamp": (base_time + timedelta(hours=i)).isoformat(), "score": 0.5}
            for i in range(3)
        ]
        small_volume = [
            {"timestamp": (base_time + timedelta(hours=i)).isoformat(), "value": 100}
            for i in range(3)
        ]

        result = CorrelationEngine.calculate_correlation(
            small_sentiment, small_volume, metric_type="volume"
        )

        self.assertEqual(result.confidence_level, "insufficient_data")

    def test_to_dict(self):
        """Test CorrelationResult serialization."""
        result = CorrelationEngine.calculate_correlation(
            self.sentiment_positive, self.volume_positive, metric_type="volume"
        )

        result_dict = result.to_dict()

        self.assertIn("correlation_score", result_dict)
        self.assertIn("sample_size", result_dict)
        self.assertIn("scatter_data", result_dict)
        self.assertIn("interpretation", result_dict)
        self.assertIsInstance(result_dict["scatter_data"], list)

    def test_scatter_data_generation(self):
        """Test that scatter plot data points are generated."""
        result = CorrelationEngine.calculate_correlation(
            self.sentiment_positive, self.volume_positive, metric_type="volume"
        )

        self.assertGreater(len(result.data_points), 0)
        self.assertIsInstance(result.data_points[0], DataPoint)

        dp_dict = result.data_points[0].to_dict()
        self.assertIn("timestamp", dp_dict)
        self.assertIn("sentiment", dp_dict)
        self.assertIn("metric_value", dp_dict)
        self.assertIn("metric_type", dp_dict)

    def test_lag_analysis(self):
        """Test time-lagged correlation analysis."""
        result = CorrelationEngine.analyze_with_lags(
            self.sentiment_positive,
            self.volume_positive,
            metric_type="volume",
            max_lag_hours=5,
        )

        self.assertIn("best_lag_hours", result)
        self.assertIn("best_correlation", result)
        self.assertIn("lag_analysis", result)
        self.assertIn("recommendation", result)
        self.assertIsInstance(result["lag_analysis"], list)

    def test_full_analysis(self):
        """Test full correlation analysis with both price and volume."""
        base_time = datetime(2024, 1, 1, 0, 0, 0)
        price_data = [
            {"timestamp": (base_time + timedelta(hours=i)).isoformat(), "value": 1.0 + 0.01 * i}
            for i in range(20)
        ]

        result = CorrelationEngine.full_analysis(
            sentiment_data=self.sentiment_positive,
            price_data=price_data,
            volume_data=self.volume_positive,
            lag_hours=0,
        )

        self.assertIn("price_correlation", result)
        self.assertIn("volume_correlation", result)
        self.assertIn("summary", result)
        self.assertIn("sentiment_is_leading_indicator", result["summary"])
        self.assertIn("strongest_relationship", result["summary"])


class TestDataPoint(unittest.TestCase):
    """Test DataPoint dataclass"""

    def test_data_point_creation(self):
        """Test DataPoint instantiation."""
        dp = DataPoint(
            timestamp=datetime(2024, 1, 1, 12, 0),
            sentiment=0.75,
            metric_value=1500.0,
            metric_type="volume",
        )

        self.assertEqual(dp.sentiment, 0.75)
        self.assertEqual(dp.metric_value, 1500.0)
        self.assertEqual(dp.metric_type, "volume")

    def test_data_point_to_dict(self):
        """Test DataPoint serialization."""
        dp = DataPoint(
            timestamp=datetime(2024, 1, 1, 12, 0),
            sentiment=0.5,
            metric_value=100.0,
            metric_type="price",
        )

        dp_dict = dp.to_dict()

        self.assertEqual(dp_dict["sentiment"], 0.5)
        self.assertEqual(dp_dict["metric_value"], 100.0)
        self.assertEqual(dp_dict["metric_type"], "price")
        self.assertIn("timestamp", dp_dict)


class TestCorrelationResult(unittest.TestCase):
    """Test CorrelationResult dataclass"""

    def test_interpretation_strong_positive(self):
        """Test interpretation for strong positive correlation."""
        result = CorrelationResult(
            metric_type="volume",
            correlation_score=0.85,
            p_value=0.001,
            sample_size=50,
            confidence_level="high",
        )

        interpretation = result._interpret_correlation()
        self.assertIn("Strong", interpretation)
        self.assertIn("positive", interpretation)

    def test_interpretation_moderate_negative(self):
        """Test interpretation for moderate negative correlation."""
        result = CorrelationResult(
            metric_type="price",
            correlation_score=-0.55,
            p_value=0.02,
            sample_size=30,
            confidence_level="medium",
        )

        interpretation = result._interpret_correlation()
        self.assertIn("Moderate", interpretation)
        self.assertIn("negative", interpretation)

    def test_interpretation_no_correlation(self):
        """Test interpretation for no significant correlation."""
        result = CorrelationResult(
            metric_type="volume",
            correlation_score=0.05,
            p_value=0.5,
            sample_size=30,
            confidence_level="low",
        )

        interpretation = result._interpret_correlation()
        self.assertIn("No significant correlation", interpretation)

    def test_interpretation_insufficient_data(self):
        """Test interpretation with insufficient data."""
        result = CorrelationResult(
            metric_type="volume",
            correlation_score=0.8,
            p_value=None,
            sample_size=5,
            confidence_level="insufficient_data",
        )

        interpretation = result._interpret_correlation()
        self.assertIn("Insufficient data", interpretation)


if __name__ == "__main__":
    unittest.main()
