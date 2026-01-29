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
        host: str = None,
        port: int = None,
        db: int = None,
        ttl_seconds: int = None,
    ):
        """
        Initialize the cache manager with Redis connection parameters.

        Args:
            host: Redis host (defaults to REDIS_HOST env var or 'localhost')
            port: Redis port (defaults to REDIS_PORT env var or 6379)
            db: Redis database number (defaults to REDIS_DB env var or 0)
            ttl_seconds: Time-to-live in seconds (defaults to 24 hours)
        """
        self.host = host or os.getenv("REDIS_HOST", "localhost")
        self.port = port or int(os.getenv("REDIS_PORT", 6379))
        self.db = db or int(os.getenv("REDIS_DB", 0))
        self.ttl_seconds = ttl_seconds or self.DEFAULT_TTL_SECONDS

        # Create Redis connection
        try:
            self.redis_client = redis.Redis(
                host=self.host,
                port=self.port,
                db=self.db,
                decode_responses=True,
                socket_connect_timeout=5,
                socket_timeout=5,
            )

            # Test the connection
            self.redis_client.ping()
            logger.info(f"Connected to Redis at {self.host}:{self.port}, DB: {self.db}")
        except redis.ConnectionError as e:
            logger.error(f"Failed to connect to Redis: {e}")
            raise
        except Exception as e:
            logger.error(f"Unexpected error connecting to Redis: {e}")
            raise

    def _generate_key(self, text: str) -> str:
        """
        Generate a unique key for the given text using SHA-256 hash.

        Args:
            text: Text to generate cache key for

        Returns:
            Hashed key string
        """
        # Create a hash of the text to use as cache key
        text_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
        return f"sentiment:{text_hash}"

    def get(self, text: str) -> Optional[Any]:
        """
        Retrieve cached result for the given text.

        Args:
            text: Text to look up in cache

        Returns:
            Cached result if found, None otherwise
        """
        try:
            key = self._generate_key(text)
            cached_result = self.redis_client.get(key)

            if cached_result:
                logger.debug(f"Cache HIT for text: {text[:50]}...")
                return json.loads(cached_result)
            else:
                logger.debug(f"Cache MISS for text: {text[:50]}...")
                return None
        except Exception as e:
            logger.error(f"Error retrieving from cache: {e}")
            return None

    def set(self, text: str, result: Any) -> bool:
        """
        Store result in cache with TTL.

        Args:
            text: Original text that was analyzed
            result: Result to cache

        Returns:
            True if successful, False otherwise
        """
        try:
            key = self._generate_key(text)
            serialized_result = json.dumps(
                result, default=str
            )  # default=str handles datetime serialization
            success = self.redis_client.setex(key, self.ttl_seconds, serialized_result)

            if success:
                logger.debug(
                    f"Cache SET for text: {text[:50]}... (TTL: {self.ttl_seconds}s)"
                )
                return True
            else:
                logger.warning(f"Failed to set cache for text: {text[:50]}...")
                return False
        except Exception as e:
            logger.error(f"Error storing in cache: {e}")
            return False

    def delete(self, text: str) -> bool:
        """
        Delete cached result for the given text.

        Args:
            text: Text to remove from cache

        Returns:
            True if successful, False otherwise
        """
        try:
            key = self._generate_key(text)
            deleted_count = self.redis_client.delete(key)
            return deleted_count > 0
        except Exception as e:
            logger.error(f"Error deleting from cache: {e}")
            return False

    def clear_all_sentiment_cache(self) -> int:
        """
        Clear all sentiment-related cache entries.

        Returns:
            Number of entries deleted
        """
        try:
            # Use pattern to find all sentiment cache keys
            pattern = "sentiment:*"
            keys = self.redis_client.keys(pattern)

            if keys:
                deleted_count = self.redis_client.delete(*keys)
                logger.info(f"Cleared {deleted_count} sentiment cache entries")
                return deleted_count
            else:
                logger.info("No sentiment cache entries found to clear")
                return 0
        except Exception as e:
            logger.error(f"Error clearing sentiment cache: {e}")
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
