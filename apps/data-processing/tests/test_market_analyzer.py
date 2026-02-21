"""
Unit tests for MarketAnalyzer class.
"""

import unittest
from src.analytics.market_analyzer import (
    MarketAnalyzer,
    Trend,
    MarketData,
    get_explanation,
)


class TestMarketAnalyzer(unittest.TestCase):
    """Test cases for MarketAnalyzer functionality"""

    def test_bullish_scenario(self):
        """Test high sentiment + high volume = BULLISH"""
        market_data = MarketData(
            sentiment_score=0.8,  # Very positive sentiment
            volume_change=0.5,  # 50% volume increase
        )

        trend, score, metrics = MarketAnalyzer.analyze_trend(market_data)

        self.assertEqual(trend, Trend.BULLISH)
        self.assertGreater(score, 0.2)
        self.assertIn("sentiment_score", metrics)
        self.assertIn("volume_change", metrics)

    def test_bearish_scenario(self):
        """Test low sentiment + decreasing volume = BEARISH"""
        market_data = MarketData(
            sentiment_score=-0.7,  # Very negative sentiment
            volume_change=-0.3,  # 30% volume decrease
        )

        trend, score, metrics = MarketAnalyzer.analyze_trend(market_data)

        self.assertEqual(trend, Trend.BEARISH)
        self.assertLess(score, -0.2)

    def test_neutral_scenario(self):
        """Test mixed signals = NEUTRAL"""
        market_data = MarketData(
            sentiment_score=0.1,  # Slightly positive sentiment
            volume_change=-0.1,  # Slightly decreasing volume
        )

        trend, score, metrics = MarketAnalyzer.analyze_trend(market_data)

        self.assertEqual(trend, Trend.NEUTRAL)
        self.assertGreaterEqual(score, -0.2)
        self.assertLessEqual(score, 0.2)

    def test_boundary_cases(self):
        """Test edge cases and boundaries"""
        # Test exactly at threshold
        market_data = MarketData(sentiment_score=0.3, volume_change=0.0)
        trend, score, _ = MarketAnalyzer.analyze_trend(market_data)
        self.assertGreater(score, 0.2)

        # Test extreme values
        market_data = MarketData(sentiment_score=1.0, volume_change=10.0)
        trend, score, _ = MarketAnalyzer.analyze_trend(market_data)
        self.assertLessEqual(score, 1.0)  # Should be bounded

    def test_analyze_from_sources(self):
        """Test convenience method with raw data"""
        sentiment_score = 0.6
        volume_data = {"current": 1500, "previous": 1000}  # 50% increase

        trend, score, metrics = MarketAnalyzer.analyze_from_sources(
            sentiment_score, volume_data
        )

        self.assertEqual(trend, Trend.BULLISH)
        self.assertEqual(metrics["volume_change"], 0.5)  # 50% increase

    def test_volume_normalization(self):
        """Test that volume normalization works correctly"""
        # Large volume spike should be normalized
        normalized = MarketAnalyzer._normalize_volume_change(5.0)
        self.assertLess(normalized, 1.0)
        self.assertGreater(normalized, 0.99)  # tanh(5) ≈ 0.9999

        # Negative volume should be normalized
        normalized = MarketAnalyzer._normalize_volume_change(-3.0)
        self.assertGreater(normalized, -1.0)
        self.assertLess(normalized, -0.99)  # tanh(-3) ≈ -0.995

    def test_explanation_generation(self):
        """Test human-readable explanations"""
        trend, score, _ = MarketAnalyzer.analyze_trend(
            MarketData(sentiment_score=0.8, volume_change=0.4)
        )

        explanation = get_explanation(score, trend)
        self.assertIsInstance(explanation, str)
        self.assertIn(str(round(score, 2)), explanation)


class TestMarketData(unittest.TestCase):
    """Test MarketData dataclass"""

    def test_market_data_creation(self):
        """Test MarketData instantiation"""
        data = MarketData(
            sentiment_score=0.5,
            volume_change=0.2,
            current_volume=1000,
            previous_volume=800,
        )

        self.assertEqual(data.sentiment_score, 0.5)
        self.assertEqual(data.volume_change, 0.2)
        self.assertEqual(data.current_volume, 1000)
        self.assertEqual(data.previous_volume, 800)


if __name__ == "__main__":
    unittest.main()
