"""
Trend calculator module - calculates market trends from sentiment and data
"""

import json
import logging
from typing import List, Dict, Any
from datetime import datetime, timezone
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class Trend:
    """Market trend information"""

    metric_name: str
    current_value: float
    previous_value: float
    change_percentage: float
    trend_direction: str  # 'up', 'down', 'stable'
    timestamp: datetime

    def to_dict(self) -> Dict[str, Any]:
        return {
            "metric_name": self.metric_name,
            "current_value": self.current_value,
            "previous_value": self.previous_value,
            "change_percentage": self.change_percentage,
            "trend_direction": self.trend_direction,
            "timestamp": self.timestamp.isoformat(),
        }


class TrendCalculator:
    """Calculates trends from sentiment analysis and market data"""

    def __init__(self):
        self.trend_history: Dict[str, Any] = {}
        self.cache: object | None = None
        try:
            from cache_manager import CacheManager
        except ImportError:
            logger.info("CacheManager unavailable - trends caching disabled")
        else:
            try:
                self.cache = CacheManager(namespace="trends")
            except Exception as e:
                logger.warning("Redis unavailable - trends caching disabled: %s", e)
            else:
                logger.info("Trends cache ready")

    @staticmethod
    def _summary_cache_key(sentiment_summary: Dict[str, Any]) -> str:
        """Deterministic key from a sentiment summary dict."""
        return json.dumps(sentiment_summary, sort_keys=True, default=str)

    def _compute_trend(
        self,
        metric_name: str,
        current_value: float,
    ) -> Trend:
        previous_value = self.trend_history.get(metric_name, {}).get(
            "value", current_value
        )

        # Calculate change
        if previous_value != 0:
            change_pct = ((current_value - previous_value) / abs(previous_value)) * 100
        else:
            change_pct = 0.0

        # Determine trend direction
        if change_pct > 2:
            direction = "up"
        elif change_pct < -2:
            direction = "down"
        else:
            direction = "stable"

        # Update trend history
        self.trend_history[metric_name] = {
            "value": current_value,
            "timestamp": datetime.now(timezone.utc),
        }

        trend = Trend(
            metric_name=metric_name,
            current_value=round(current_value, 4),
            previous_value=round(previous_value, 4),
            change_percentage=round(change_pct, 2),
            trend_direction=direction,
            timestamp=datetime.now(timezone.utc),
        )
        logger.info("%s trend: %s (%.2f%%)", metric_name, direction, change_pct)
        return trend

    def calculate_sentiment_trend(self, sentiment_summary: Dict[str, Any]) -> Trend:
        current = sentiment_summary.get("average_compound_score", 0)
        return self._compute_trend("sentiment_score", current)

    def calculate_positive_sentiment_trend(
        self, sentiment_summary: Dict[str, Any]
    ) -> Trend:
        current = sentiment_summary.get("sentiment_distribution", {}).get("positive", 0)
        return self._compute_trend("positive_sentiment_percentage", current)

    def calculate_negative_sentiment_trend(
        self, sentiment_summary: Dict[str, Any]
    ) -> Trend:
        current = sentiment_summary.get("sentiment_distribution", {}).get("negative", 0)
        return self._compute_trend("negative_sentiment_percentage", current)

    def calculate_all_trends(self, sentiment_summary: Dict[str, Any]) -> List[Trend]:
        """
        Calculate all trends

        Args:
            sentiment_summary: Summary from SentimentAnalyzer

        Returns:
            List of Trend objects
        """
        cache_key = self._summary_cache_key(sentiment_summary)

        # Check cache for cached results
        if self.cache:
            cached = self.cache.get(cache_key)
            if cached:
                return [
                    Trend(
                        metric_name=t["metric_name"],
                        current_value=t["current_value"],
                        previous_value=t["previous_value"],
                        change_percentage=t["change_percentage"],
                        trend_direction=t["trend_direction"],
                        timestamp=datetime.fromisoformat(t["timestamp"]),
                    )
                    for t in cached
                ]

        trends = [
            self.calculate_sentiment_trend(sentiment_summary),
            self.calculate_positive_sentiment_trend(sentiment_summary),
            self.calculate_negative_sentiment_trend(sentiment_summary),
        ]

        if self.cache:
            self.cache.set(cache_key, [t.to_dict() for t in trends])

        logger.info("Calculated %d trends", len(trends))
        return trends
