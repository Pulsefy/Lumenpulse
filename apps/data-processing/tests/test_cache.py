"""
Unit tests for CacheManager and sentiment analysis caching functionality.
"""

import unittest
import time
from src.cache_manager import CacheManager
from src.sentiment import SentimentAnalyzer


class TestCacheManager(unittest.TestCase):
    """Test cases for CacheManager functionality"""

    def setUp(self):
        """Set up test environment"""
        try:
            self.cache = CacheManager(namespace="test_unit", ttl_seconds=60)
        except Exception as e:
            self.skipTest(f"Could not connect to Redis: {e}")

    def tearDown(self):
        try:
            self.cache.clear_namespace()
        except Exception:
            pass

    def test_cache_set_and_get(self):
        """Test basic cache set and get functionality"""
        test_text = "This is a test sentence for sentiment analysis."
        test_result = {
            "text": test_text[:100],
            "compound_score": 0.5,
            "positive": 0.3,
            "negative": 0.1,
            "neutral": 0.6,
            "sentiment_label": "positive",
        }

        # Set value in cache
        success = self.cache.set(test_text, test_result)
        self.assertTrue(success)

        # Get value from cache
        cached_result = self.cache.get(test_text)
        self.assertIsNotNone(cached_result)
        self.assertEqual(cached_result["compound_score"], 0.5)

    def test_cache_miss(self):
        """Test cache returns None for non-existent key"""
        result = self.cache.get("non-existent text")
        self.assertIsNone(result)

    def test_cache_ttl_expiration(self):
        """Test that cache entries expire after TTL"""
        short_ttl_cache = CacheManager(namespace="test_ttl", ttl_seconds=1)
        test_text = "This is a test sentence for TTL testing."
        short_ttl_cache.set(test_text, {"compound_score": 0.5})

        self.assertIsNotNone(short_ttl_cache.get(test_text))
        time.sleep(2)
        self.assertIsNone(short_ttl_cache.get(test_text))
        short_ttl_cache.clear_namespace()

    def test_cache_key_generation(self):
        key = self.cache._generate_key("Sample text for testing.")
        self.assertTrue(key.startswith("test_unit:"))
        self.assertEqual(len(key), len("test_unit:") + 64)

    def test_make_key(self):
        k = CacheManager.make_key("BTC", "7d")
        self.assertEqual(k, "BTC|7d")


class TestSentimentAnalyzerWithCache(unittest.TestCase):
    """Test cases for SentimentAnalyzer with caching"""

    def setUp(self):
        """Set up test environment"""
        try:
            self.analyzer = SentimentAnalyzer()
        except Exception as e:
            self.skipTest(f"Could not initialize SentimentAnalyzer: {e}")

    def tearDown(self):
        if self.analyzer.cache:
            self.analyzer.cache.clear_namespace()

    def test_sentiment_analysis_with_caching(self):
        """Test that sentiment analysis uses caching appropriately"""
        test_text = "This is a positive news article about cryptocurrency growth."
        result1 = self.analyzer.analyze(test_text)
        result2 = self.analyzer.analyze(test_text)

        self.assertEqual(result1.compound_score, result2.compound_score)
        self.assertEqual(result1.sentiment_label, result2.sentiment_label)

    def test_different_texts_not_cached_together(self):
        r1 = self.analyzer.analyze("This is a positive news article.")
        r2 = self.analyzer.analyze("This is a negative news article.")
        self.assertIsNotNone(r1)
        self.assertIsNotNone(r2)


if __name__ == "__main__":
    unittest.main()
