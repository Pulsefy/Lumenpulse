"""
Cache Manager module - Implements caching layer for expensive operations using Redis
"""

import hashlib
import json
import logging
import os
from typing import Any, Optional, Tuple

import redis

logger = logging.getLogger(__name__)

# Caching can be disabled globally for debugging by setting CACHE_ENABLED=false.
CACHE_ENABLED = os.getenv("CACHE_ENABLED", "true").strip().lower() in (
    "1",
    "true",
    "yes",
    "on",
)


def _load_cache_metrics() -> Tuple[Any, Any]:
    """
    Return the shared cache metrics (operations counter, hit-rate gauge).

    The metrics live in ``src.utils.metrics`` so every import style of this
    module (``cache_manager`` vs ``src.cache_manager``) reuses the same
    registered collectors. When the ``src`` package is not importable the
    collectors are registered here instead.
    """
    try:
        from src.utils.metrics import CACHE_HIT_RATE, CACHE_OPERATIONS_TOTAL

        return CACHE_HIT_RATE, CACHE_OPERATIONS_TOTAL
    except ImportError:  # pragma: no cover - depends on how the module is imported
        from prometheus_client import Counter, Gauge

        operations = Counter(
            "lumenpulse_cache_operations_total",
            "Total number of cache lookup operations by outcome",
            ["namespace", "outcome"],
        )
        hit_rate = Gauge(
            "lumenpulse_cache_hit_rate",
            "Ratio of cache hits to total cache lookups, per namespace",
            ["namespace"],
        )
        return hit_rate, operations


CACHE_HIT_RATE, CACHE_OPERATIONS_TOTAL = _load_cache_metrics()


class CacheManager:
    """
    Manages caching using Redis for expensive operations like sentiment analysis.
    Uses a 24-hour TTL for cached results.

    The cache can be disabled at runtime via the ``CACHE_ENABLED`` environment
    variable (or the ``enabled`` constructor argument) so that deployments can
    bypass Redis entirely for debugging or load testing.
    """

    DEFAULT_TTL_SECONDS = 24 * 60 * 60  # 24 hours

    def __init__(
        self,
        host: Optional[str] = None,
        port: Optional[int] = None,
        db: Optional[int] = None,
        ttl_seconds: Optional[int] = None,
        namespace: str = "cache",
        enabled: Optional[bool] = None,
    ):
        self.host = host if host is not None else os.getenv("REDIS_HOST", "localhost")
        self.port = port if port is not None else int(os.getenv("REDIS_PORT", "6379"))
        self.db = db if db is not None else int(os.getenv("REDIS_DB", "0"))
        self.ttl_seconds = (
            ttl_seconds
            if ttl_seconds is not None
            else int(os.getenv("CACHE_TTL_SECONDS", str(self.DEFAULT_TTL_SECONDS)))
        )
        self.namespace = namespace
        self.enabled = CACHE_ENABLED if enabled is None else bool(enabled)
        self._hits = 0
        self._misses = 0

        self.redis_client: Optional[redis.Redis] = None
        if not self.enabled:
            logger.info(
                "Caching disabled for namespace=%s (CACHE_ENABLED=false)",
                self.namespace,
            )
            return

        self.redis_client = redis.Redis(
            host=self.host,
            port=self.port,
            db=self.db,
            decode_responses=True,
            socket_connect_timeout=5,
            socket_timeout=5,
        )
        self.redis_client.ping()
        logger.info(
            "Connected to Redis at %s:%s/%s (namespace=%s, ttl=%ss)",
            self.host,
            self.port,
            self.db,
            self.namespace,
            self.ttl_seconds,
        )

    def _generate_key(self, raw_key: str) -> str:
        """Return ``namespace:sha256(raw_key)``."""
        digest = hashlib.sha256(raw_key.encode("utf-8")).hexdigest()
        return f"{self.namespace}:{digest}"

    @staticmethod
    def make_key(*parts: Any) -> str:
        """Build a deterministic cache key from arbitrary ordered parts."""
        return "|".join(str(p) for p in parts)

    def _record_outcome(self, outcome: str) -> None:
        """Record a hit/miss and refresh the exported hit-rate gauge."""
        CACHE_OPERATIONS_TOTAL.labels(namespace=self.namespace, outcome=outcome).inc()
        if outcome == "hit":
            self._hits += 1
        else:
            self._misses += 1
        total = self._hits + self._misses
        if total:
            CACHE_HIT_RATE.labels(namespace=self.namespace).set(self._hits / total)

    def hit_rate(self) -> Optional[float]:
        """Return the observed hit rate (hits / lookups), or None if no lookups yet."""
        total = self._hits + self._misses
        if not total:
            return None
        return self._hits / total

    def get(self, raw_key: str) -> Optional[Any]:
        """
        Return deserialised value for raw_key, or None on miss.

        Args:
            raw_key: Key to retrieve the result from

        Returns:
            Cached result if found, None otherwise
        """
        if not self.enabled or self.redis_client is None:
            return None
        try:
            key = self._generate_key(raw_key)
            cached = self.redis_client.get(key)
            if cached is not None:
                self._record_outcome("hit")
                logger.info("CACHE HIT  [%s] %s", self.namespace, raw_key[:80])
                return json.loads(cached)
            self._record_outcome("miss")
            logger.debug("CACHE MISS [%s] %s", self.namespace, raw_key[:80])
            return None
        except Exception as e:
            logger.error("Cache get error: %s", e)
            return None

    def set(self, raw_key: str, value: Any) -> bool:
        """
        Store result in cache with TTL.

        Args:
            raw_key: Key to store the result under
            value: Result to store in cache

        Returns:
            True if successful, False otherwise
        """
        if not self.enabled or self.redis_client is None:
            return False
        try:
            key = self._generate_key(raw_key)
            serialised = json.dumps(value, default=str)
            ok = self.redis_client.setex(key, self.ttl_seconds, serialised)
            if ok:
                logger.debug(
                    "CACHE SET  [%s] ttl=%ss", self.namespace, self.ttl_seconds
                )
            return bool(ok)
        except Exception as e:
            logger.error("Cache set error: %s", e)
            return False

    def delete(self, raw_key: str) -> bool:
        """Remove a single entry."""
        if not self.enabled or self.redis_client is None:
            return False
        try:
            return self.redis_client.delete(self._generate_key(raw_key)) > 0
        except Exception as e:
            logger.error("Cache delete error: %s", e)
            return False

    def clear_namespace(self) -> int:
        """Delete every key that belongs to this namespace."""
        if not self.enabled or self.redis_client is None:
            return 0
        try:
            keys = list(self.redis_client.scan_iter(match=f"{self.namespace}:*"))
            count = self.redis_client.delete(*keys) if keys else 0
            if count:
                logger.info("Cleared %d entries from [%s]", count, self.namespace)
            return count
        except Exception as e:
            logger.error("Cache clear error: %s", e)
            return 0

    def ping(self) -> bool:
        """
        Test Redis connection.

        Returns:
            True if connected, False otherwise
        """
        if not self.enabled or self.redis_client is None:
            return False
        try:
            return self.redis_client.ping()
        except Exception:
            return False
