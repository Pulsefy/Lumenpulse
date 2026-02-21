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
            self.cache = CacheManager(ttl_seconds=60)  # 1 minute TTL for testing
        except Exception as e:
            self.skipTest(f"Could not connect to Redis: {e}")

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
        self.assertTrue(success, "Failed to set value in cache")

        # Get value from cache
        cached_result = self.cache.get(test_text)
        self.assertIsNotNone(cached_result, "Failed to retrieve value from cache")
        self.assertEqual(
            cached_result["compound_score"], 0.5, "Retrieved value doesn't match"
        )

    def test_cache_miss(self):
        """Test cache returns None for non-existent key"""
        result = self.cache.get("non-existent text")
        self.assertIsNone(result, "Expected None for non-existent key")

    def test_cache_ttl_expiration(self):
        """Test that cache entries expire after TTL"""
        test_text = "This is a test sentence for TTL testing."
        test_result = {"compound_score": 0.5}

        # Create cache with very short TTL for testing
        short_ttl_cache = CacheManager(ttl_seconds=1)  # 1 second TTL

        # Set value
        short_ttl_cache.set(test_text, test_result)

        # Should be able to get it immediately
        cached_result = short_ttl_cache.get(test_text)
        self.assertIsNotNone(
            cached_result, "Value should exist immediately after setting"
        )

        # Wait for TTL to expire
        time.sleep(2)

        # Should not be able to get it after TTL expiration
        expired_result = short_ttl_cache.get(test_text)
        self.assertIsNone(expired_result, "Value should have expired")

    def test_cache_key_generation(self):
        """Test that cache keys are properly generated"""
        test_text = "Sample text for testing."

        # Test key generation
        key = self.cache._generate_key(test_text)
        self.assertTrue(
            key.startswith("sentiment:"), "Cache key should start with 'sentiment:'"
        )
        self.assertEqual(
            len(key), len("sentiment:") + 64, "SHA-256 hash should be 64 characters"
        )


class TestSentimentAnalyzerWithCache(unittest.TestCase):
    """Test cases for SentimentAnalyzer with caching"""

    def setUp(self):
        """Set up test environment"""
        try:
            self.analyzer = SentimentAnalyzer()
        except Exception as e:
            self.skipTest(f"Could not initialize SentimentAnalyzer: {e}")

    def test_sentiment_analysis_with_caching(self):
        """Test that sentiment analysis uses caching appropriately"""
        test_text = "This is a positive news article about cryptocurrency growth."

        # First analysis - should not be cached
        result1 = self.analyzer.analyze(test_text)

        # Second analysis of same text - should be cached
        result2 = self.analyzer.analyze(test_text)

        # Results should be identical
        self.assertEqual(
            result1.compound_score,
            result2.compound_score,
            "Cached and computed results should be identical",
        )
        self.assertEqual(
            result1.sentiment_label,
            result2.sentiment_label,
            "Cached and computed labels should be identical",
        )

    def test_different_texts_not_cached(self):
        """Test that different texts are not incorrectly cached together"""
        text1 = "This is a positive news article."
        text2 = "This is a negative news article."

        result1 = self.analyzer.analyze(text1)
        result2 = self.analyzer.analyze(text2)

        # Both should complete but likely have different sentiments
        self.assertIsNotNone(result1)
        self.assertIsNotNone(result2)


if __name__ == "__main__":
    unittest.main()
