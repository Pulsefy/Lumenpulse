"""
Integration tests for CacheManager ↔ sentiment / trends pipelines.

Requirements:
  - A running Redis instance (REDIS_HOST / REDIS_PORT env vars, defaults to localhost:6379).
  - ``pip install redis vaderSentiment pytest``

Run:
    pytest tests/integration/test_cache_pipeline_integration.py -v -s
"""

import json
import logging
import time

import pytest

from cache_manager import CacheManager
from sentiment import SentimentAnalyzer
from trends import TrendCalculator

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _redis_available() -> bool:
    try:
        CacheManager(namespace="__probe__", ttl_seconds=1).ping()
        return True
    except Exception:
        return False


skip_no_redis = pytest.mark.skipif(not _redis_available(), reason="Redis not reachable")


# ---------------------------------------------------------------------------
# CacheManager unit-level integration
# ---------------------------------------------------------------------------


@skip_no_redis
class TestCacheManagerIntegration:
    """Verify CacheManager basics against a real Redis instance."""

    def setup_method(self) -> None:
        self.cache = CacheManager(namespace="test_integration", ttl_seconds=5)
        self.cache.clear_namespace()

    def teardown_method(self) -> None:
        self.cache.clear_namespace()

    def test_set_get_roundtrip(self) -> None:
        self.cache.set("key1", {"score": 0.42})
        result = self.cache.get("key1")
        assert result is not None
        assert result["score"] == 0.42

    def test_cache_miss_returns_none(self) -> None:
        assert self.cache.get("nonexistent") is None

    def test_ttl_expiration(self) -> None:
        short = CacheManager(namespace="test_ttl", ttl_seconds=1)
        short.set("ephemeral", {"v": 1})
        assert short.get("ephemeral") is not None
        time.sleep(2)
        assert short.get("ephemeral") is None
        short.clear_namespace()

    def test_namespace_isolation(self) -> None:
        ns_a = CacheManager(namespace="ns_a", ttl_seconds=60)
        ns_b = CacheManager(namespace="ns_b", ttl_seconds=60)
        ns_a.set("shared_key", {"from": "a"})
        ns_b.set("shared_key", {"from": "b"})
        assert ns_a.get("shared_key")["from"] == "a"
        assert ns_b.get("shared_key")["from"] == "b"
        ns_a.clear_namespace()
        ns_b.clear_namespace()


# ---------------------------------------------------------------------------
# Sentiment pipeline integration
# ---------------------------------------------------------------------------


@skip_no_redis
class TestSentimentCacheIntegration:
    """Second identical sentiment call must hit cache and be faster."""

    def setup_method(self) -> None:
        self.analyzer = SentimentAnalyzer()
        if self.analyzer.cache:
            self.analyzer.cache.clear_namespace()

    def teardown_method(self) -> None:
        if self.analyzer.cache:
            self.analyzer.cache.clear_namespace()

    def test_second_call_hits_cache(self, caplog) -> None:
        text = "Bitcoin surges to new all-time high amid institutional adoption."

        with caplog.at_level(logging.INFO):
            r1 = self.analyzer.analyze(text)
            r2 = self.analyzer.analyze(text)

        assert r1.compound_score == r2.compound_score
        assert r1.sentiment_label == r2.sentiment_label
        assert "CACHE HIT" in caplog.text

    def test_cached_call_is_faster(self) -> None:
        texts = [f"Market analysis paragraph number {i}." for i in range(50)]

        # Cold run
        t0 = time.perf_counter()
        for t in texts:
            self.analyzer.analyze(t)
        cold_ms = (time.perf_counter() - t0) * 1000

        # Warm run (everything cached)
        t0 = time.perf_counter()
        for t in texts:
            self.analyzer.analyze(t)
        warm_ms = (time.perf_counter() - t0) * 1000

        logger.info("Cold: %.1f ms  |  Warm: %.1f ms", cold_ms, warm_ms)
        assert warm_ms <= cold_ms, "Cached run should not be slower than cold run"


# ---------------------------------------------------------------------------
# Trends pipeline integration
# ---------------------------------------------------------------------------


@skip_no_redis
class TestTrendsCacheIntegration:
    """Second identical trends call must hit cache and be faster."""

    def setup_method(self) -> None:
        self.calculator = TrendCalculator()
        if self.calculator.cache:
            self.calculator.cache.clear_namespace()

    def teardown_method(self) -> None:
        if self.calculator.cache:
            self.calculator.cache.clear_namespace()

    def test_second_call_hits_cache(self, caplog) -> None:
        summary = {
            "total_items": 20,
            "average_compound_score": 0.35,
            "positive_count": 12,
            "negative_count": 3,
            "neutral_count": 5,
            "sentiment_distribution": {
                "positive": 0.6,
                "negative": 0.15,
                "neutral": 0.25,
            },
        }

        with caplog.at_level(logging.INFO):
            t1 = self.calculator.calculate_all_trends(summary)
            t2 = self.calculator.calculate_all_trends(summary)

        assert len(t1) == len(t2) == 3
        for a, b in zip(t1, t2):
            assert a.metric_name == b.metric_name
            assert a.current_value == b.current_value
        assert "CACHE HIT" in caplog.text

    def test_different_summaries_not_mixed(self) -> None:
        summary_a = {
            "total_items": 10,
            "average_compound_score": 0.8,
            "sentiment_distribution": {
                "positive": 0.9,
                "negative": 0.05,
                "neutral": 0.05,
            },
        }
        summary_b = {
            "total_items": 10,
            "average_compound_score": -0.5,
            "sentiment_distribution": {
                "positive": 0.1,
                "negative": 0.7,
                "neutral": 0.2,
            },
        }

        trends_a = self.calculator.calculate_all_trends(summary_a)
        trends_b = self.calculator.calculate_all_trends(summary_b)

        assert trends_a[0].current_value != trends_b[0].current_value
