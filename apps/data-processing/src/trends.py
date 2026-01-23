"""
Trend calculator module - calculates market trends from sentiment and data
"""
import logging
from typing import List, Dict, Any
from datetime import datetime, timedelta
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
            "timestamp": self.timestamp.isoformat()
        }


class TrendCalculator:
    """Calculates trends from sentiment analysis and market data"""

    def __init__(self):
        self.trend_history = {}

    def calculate_sentiment_trend(self, sentiment_summary: Dict[str, Any]) -> Trend:
        """
        Calculate trend from sentiment analysis results
        
        Args:
            sentiment_summary: Summary from SentimentAnalyzer
            
        Returns:
            Trend object
        """
        current_sentiment_score = sentiment_summary.get('average_compound_score', 0)
        metric_name = "sentiment_score"
        
        # Get previous value or use current as baseline
        previous_value = self.trend_history.get(metric_name, {}).get('value', current_sentiment_score)
        
        # Calculate change
        if previous_value != 0:
            change_pct = ((current_sentiment_score - previous_value) / abs(previous_value)) * 100
        else:
            change_pct = 0

        # Determine trend direction
        if change_pct > 2:
            direction = 'up'
        elif change_pct < -2:
            direction = 'down'
        else:
            direction = 'stable'

        # Update history
        self.trend_history[metric_name] = {
            'value': current_sentiment_score,
            'timestamp': datetime.utcnow()
        }

        trend = Trend(
            metric_name=metric_name,
            current_value=round(current_sentiment_score, 4),
            previous_value=round(previous_value, 4),
            change_percentage=round(change_pct, 2),
            trend_direction=direction,
            timestamp=datetime.utcnow()
        )

        logger.info(f"Sentiment trend: {trend.trend_direction} ({change_pct:.2f}%)")
        return trend

    def calculate_positive_sentiment_trend(self, sentiment_summary: Dict[str, Any]) -> Trend:
        """
        Calculate trend for positive sentiment percentage
        
        Args:
            sentiment_summary: Summary from SentimentAnalyzer
            
        Returns:
            Trend object
        """
        current_positive = sentiment_summary.get('sentiment_distribution', {}).get('positive', 0)
        metric_name = "positive_sentiment_percentage"
        
        previous_value = self.trend_history.get(metric_name, {}).get('value', current_positive)
        
        if previous_value != 0:
            change_pct = ((current_positive - previous_value) / previous_value) * 100
        else:
            change_pct = 0

        if change_pct > 2:
            direction = 'up'
        elif change_pct < -2:
            direction = 'down'
        else:
            direction = 'stable'

        self.trend_history[metric_name] = {
            'value': current_positive,
            'timestamp': datetime.utcnow()
        }

        trend = Trend(
            metric_name=metric_name,
            current_value=round(current_positive, 4),
            previous_value=round(previous_value, 4),
            change_percentage=round(change_pct, 2),
            trend_direction=direction,
            timestamp=datetime.utcnow()
        )

        logger.info(f"Positive sentiment trend: {trend.trend_direction} ({change_pct:.2f}%)")
        return trend

    def calculate_negative_sentiment_trend(self, sentiment_summary: Dict[str, Any]) -> Trend:
        """
        Calculate trend for negative sentiment percentage
        
        Args:
            sentiment_summary: Summary from SentimentAnalyzer
            
        Returns:
            Trend object
        """
        current_negative = sentiment_summary.get('sentiment_distribution', {}).get('negative', 0)
        metric_name = "negative_sentiment_percentage"
        
        previous_value = self.trend_history.get(metric_name, {}).get('value', current_negative)
        
        if previous_value != 0:
            change_pct = ((current_negative - previous_value) / previous_value) * 100
        else:
            change_pct = 0

        if change_pct > 2:
            direction = 'up'
        elif change_pct < -2:
            direction = 'down'
        else:
            direction = 'stable'

        self.trend_history[metric_name] = {
            'value': current_negative,
            'timestamp': datetime.utcnow()
        }

        trend = Trend(
            metric_name=metric_name,
            current_value=round(current_negative, 4),
            previous_value=round(previous_value, 4),
            change_percentage=round(change_pct, 2),
            trend_direction=direction,
            timestamp=datetime.utcnow()
        )

        logger.info(f"Negative sentiment trend: {trend.trend_direction} ({change_pct:.2f}%)")
        return trend

    def calculate_all_trends(self, sentiment_summary: Dict[str, Any]) -> List[Trend]:
        """
        Calculate all trends
        
        Args:
            sentiment_summary: Summary from SentimentAnalyzer
            
        Returns:
            List of Trend objects
        """
        trends = [
            self.calculate_sentiment_trend(sentiment_summary),
            self.calculate_positive_sentiment_trend(sentiment_summary),
            self.calculate_negative_sentiment_trend(sentiment_summary)
        ]
        
        logger.info(f"Calculated {len(trends)} trends")
        return trends
