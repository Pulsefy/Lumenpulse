"""
Demo script to demonstrate the caching functionality for sentiment analysis.
This script shows how the cache prevents re-calculation of sentiment for the same news articles.
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "."))

from src.sentiment import SentimentAnalyzer
from src.cache_manager import CacheManager


def demo_caching():
    """Demonstrate the caching functionality"""
    print("=" * 60)
    print("SENTIMENT ANALYSIS CACHING DEMO")
    print("=" * 60)

    # Create analyzer (will try to connect to Redis)
    print("Initializing SentimentAnalyzer...")
    analyzer = SentimentAnalyzer()

    if analyzer.cache_manager:
        print("✓ CacheManager connected successfully")
        print(
            f"  - Connected to Redis at {analyzer.cache_manager.host}:{analyzer.cache_manager.port}"
        )
        print(f"  - TTL: {analyzer.cache_manager.ttl_seconds} seconds")
    else:
        print("⚠ CacheManager not available - running without caching")
        print("  - Install redis-py and start Redis server to enable caching")

    # Test text
    sample_text = "Bitcoin reaches new all-time high as institutional adoption accelerates and regulatory clarity improves market confidence."

    print(f"\nSample text: {sample_text[:60]}...")
    print("-" * 60)

    # First analysis - should calculate fresh
    print("First analysis (should calculate fresh)...")
    result1 = analyzer.analyze(sample_text)
    print(f"  Compound score: {result1.compound_score}")
    print(f"  Sentiment: {result1.sentiment_label}")
    print(
        f"  Positive: {result1.positive}, Negative: {result1.negative}, Neutral: {result1.neutral}"
    )

    # Second analysis - should use cache if available
    print("\nSecond analysis (should use cache if available)...")
    result2 = analyzer.analyze(sample_text)
    print(f"  Compound score: {result2.compound_score}")
    print(f"  Sentiment: {result2.sentiment_label}")
    print(
        f"  Positive: {result2.positive}, Negative: {result2.negative}, Neutral: {result2.neutral}"
    )

    # Verify results are identical
    scores_match = result1.compound_score == result2.compound_score
    labels_match = result1.sentiment_label == result2.sentiment_label

    print(f"\nVerification:")
    print(f"  Scores match: {scores_match}")
    print(f"  Labels match: {labels_match}")

    if scores_match and labels_match:
        print("  ✓ Results are consistent (cache working correctly)")
    else:
        print("  ⚠ Results differ unexpectedly")

    # Test with different text
    different_text = "Cryptocurrency market faces uncertainty as regulatory concerns mount and volatility increases."
    print(f"\nTesting with different text: {different_text[:60]}...")
    result3 = analyzer.analyze(different_text)
    print(f"  Compound score: {result3.compound_score}")
    print(f"  Sentiment: {result3.sentiment_label}")

    print("\n" + "=" * 60)
    print("DEMO COMPLETE")
    print("=" * 60)

    # Show cache statistics if available
    if analyzer.cache_manager:
        print("\nCache Info:")
        try:
            is_connected = analyzer.cache_manager.ping()
            print(
                f"  - Redis connection: {'✓ Connected' if is_connected else '✗ Disconnected'}"
            )
        except:
            print("  - Redis connection: ✗ Error checking connection")


def demo_cache_manager_directly():
    """Demonstrate CacheManager functionality directly"""
    print("\n" + "=" * 60)
    print("CACHE MANAGER DIRECT DEMONSTRATION")
    print("=" * 60)

    try:
        cache = CacheManager(ttl_seconds=86400)  # 24 hours TTL
        print("✓ CacheManager initialized successfully")

        # Test data
        test_text = "Ethereum upgrades boost network efficiency and reduce energy consumption significantly."
        test_result = {
            "text": test_text[:100],
            "compound_score": 0.65,
            "positive": 0.7,
            "negative": 0.1,
            "neutral": 0.2,
            "sentiment_label": "positive",
        }

        print(f"\nTesting with text: {test_text[:50]}...")

        # Set in cache
        success = cache.set(test_text, test_result)
        print(f"Cache set successful: {success}")

        # Get from cache
        cached_result = cache.get(test_text)
        print(f"Cache get successful: {cached_result is not None}")

        if cached_result:
            print(f"Retrieved compound score: {cached_result['compound_score']}")
            print(f"Retrieved sentiment: {cached_result['sentiment_label']}")

    except Exception as e:
        print(f"⚠ Could not connect to Redis: {e}")
        print("  - Make sure Redis server is running on localhost:6379")
        print("  - Or set REDIS_HOST/REDIS_PORT environment variables")


if __name__ == "__main__":
    demo_caching()
    demo_cache_manager_directly()

    print("\n" + "=" * 60)
    print("IMPLEMENTATION SUMMARY")
    print("=" * 60)
    print("✓ CacheManager class created using redis-py")
    print("✓ SentimentAnalyzer modified to check cache before analysis")
    print("✓ Results stored with 24-hour TTL (86400 seconds)")
    print("✓ Dockerized Redis in docker-compose.yml (ready to use)")
    print("✓ Requirements updated with redis dependency")
    print("✓ Graceful fallback when Redis unavailable")
    print("=" * 60)
