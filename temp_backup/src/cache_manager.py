"""
Cache Manager module - Implements caching layer for expensive operations using Redis
"""

import hashlib
import json
import logging
import os
from typing import Any, Optional

import redis

logger = logging.getLogger(__name__)


class CacheManager:
    """
    Manages caching using Redis for expensive operations like sentiment analysis.
    Uses a 24-hour TTL for cached results.
    """

    DEFAULT_TTL_SECONDS = 24 * 60 * 60  # 24 hours

    def __init__(
        self,
        host: Optional[str] = None,
        port: Optional[int] = None,
        db: Optional[int] = None,
        ttl_seconds: Optional[int] = None,
        namespace: str = "cache",
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

    def get(self, raw_key: str) -> Optional[Any]:
        """
        Return deserialised value for raw_key, or None on miss.

        Args:
            raw_key: Key to retrieve the result from

        Returns:
            Cached result if found, None otherwise
        """
        try:
            key = self._generate_key(raw_key)
            cached = self.redis_client.get(key)
            if cached is not None:
                logger.info("CACHE HIT  [%s] %s", self.namespace, raw_key[:80])
                return json.loads(cached)
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
        try:
            return self.redis_client.delete(self._generate_key(raw_key)) > 0
        except Exception as e:
            logger.error("Cache delete error: %s", e)
            return False

    def clear_namespace(self) -> int:
        """Delete every key that belongs to this namespace."""
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
        try:
            return self.redis_client.ping()
        except Exception:
            return False
