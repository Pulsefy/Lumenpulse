"""
Market Trend Heuristic Algorithm
Combines news sentiment and on-chain volume to produce Market Health score.
"""

from enum import Enum
from typing import Tuple, Optional
from dataclasses import dataclass


class Trend(Enum):
    """Market trend classification"""

    BULLISH = "bullish"
    BEARISH = "bearish"
    NEUTRAL = "neutral"


@dataclass
class MarketData:
    """Container for market data inputs"""

    sentiment_score: float  # Range: -1.0 to 1.0
    volume_change: float  # Percentage change (e.g., 0.15 for 15% increase)
    current_volume: Optional[float] = None
    previous_volume: Optional[float] = None


class MarketAnalyzer:
    """
    Analyzes market health using weighted average of sentiment and volume changes.

    Formula:
        Market Health Score = (Sentiment × 0.7) + (Normalized_Volume_Change × 0.3)

    Where:
        - Sentiment: Direct sentiment score (-1.0 to 1.0)
        - Normalized_Volume_Change: tanh(volume_change) to bound between -1 and 1

    Classification:
        - Score > 0.2: BULLISH
        - Score < -0.2: BEARISH
        - Otherwise: NEUTRAL
    """

    # Weights for the weighted average
    SENTIMENT_WEIGHT = 0.7
    VOLUME_WEIGHT = 0.3

    # Thresholds for trend classification
    BULLISH_THRESHOLD = 0.2
    BEARISH_THRESHOLD = -0.2

    @staticmethod
    def _normalize_volume_change(volume_change: float) -> float:
        """
        Normalize volume change using hyperbolic tangent to bound between -1 and 1.
        This prevents extreme volume spikes from dominating the score.
        """
        from math import tanh

        return tanh(volume_change)

    @staticmethod
    def _calculate_health_score(sentiment: float, volume_change: float) -> float:
        """
        Calculate market health score using weighted average.

        Args:
            sentiment: News sentiment score (-1.0 to 1.0)
            volume_change: Volume percentage change

        Returns:
            Market health score between -1.0 and 1.0
        """
        normalized_volume = MarketAnalyzer._normalize_volume_change(volume_change)

        health_score = (
            sentiment * MarketAnalyzer.SENTIMENT_WEIGHT
            + normalized_volume * MarketAnalyzer.VOLUME_WEIGHT
        )

        # Ensure score stays within bounds
        return max(-1.0, min(1.0, health_score))

    @classmethod
    def analyze_trend(cls, market_data: MarketData) -> Tuple[Trend, float, dict]:
        """
        Analyze market trend based on sentiment and volume data.

        Args:
            market_data: MarketData object containing sentiment and volume

        Returns:
            Tuple of (trend, score, metrics) where:
            - trend: Trend enum (BULLISH/BEARISH/NEUTRAL)
            - score: Raw health score
            - metrics: Dictionary with component scores
        """
        # Calculate component scores
        normalized_volume = cls._normalize_volume_change(market_data.volume_change)
        sentiment_component = market_data.sentiment_score * cls.SENTIMENT_WEIGHT
        volume_component = normalized_volume * cls.VOLUME_WEIGHT

        # Calculate total score
        health_score = sentiment_component + volume_component

        # Classify trend
        if health_score > cls.BULLISH_THRESHOLD:
            trend = Trend.BULLISH
        elif health_score < cls.BEARISH_THRESHOLD:
            trend = Trend.BEARISH
        else:
            trend = Trend.NEUTRAL

        # Prepare metrics
        metrics = {
            "health_score": health_score,
            "sentiment_score": market_data.sentiment_score,
            "sentiment_component": sentiment_component,
            "volume_change": market_data.volume_change,
            "normalized_volume": normalized_volume,
            "volume_component": volume_component,
            "weights": {"sentiment": cls.SENTIMENT_WEIGHT, "volume": cls.VOLUME_WEIGHT},
        }

        return trend, health_score, metrics

    @classmethod
    def analyze_from_sources(
        cls, sentiment_score: float, volume_data: dict
    ) -> Tuple[Trend, float, dict]:
        """
        Convenience method to analyze from raw data sources.

        Args:
            sentiment_score: From NewsFetcher
            volume_data: From StellarDataFetcher, expected to have 'current' and 'previous' keys

        Returns:
            Same as analyze_trend method
        """
        # Calculate volume change percentage
        current_volume = volume_data.get("current", 0)
        previous_volume = volume_data.get("previous", 0)

        if previous_volume > 0:
            volume_change = (current_volume - previous_volume) / previous_volume
        else:
            volume_change = 0.0  # Handle division by zero

        market_data = MarketData(
            sentiment_score=sentiment_score,
            volume_change=volume_change,
            current_volume=current_volume,
            previous_volume=previous_volume,
        )

        return cls.analyze_trend(market_data)


def get_explanation(score: float, trend: Trend) -> str:
    """
    Generate human-readable explanation of the market trend.

    Args:
        score: Market health score
        trend: Determined trend

    Returns:
        Explanation string
    """
    explanations = {
        Trend.BULLISH: [
            "Strong positive sentiment combined with increasing volume suggests bullish momentum.",
            "Positive market sentiment supported by healthy volume growth indicates upward trend.",
            "Bullish indicators from both news sentiment and trading volume.",
        ],
        Trend.BEARISH: [
            "Negative sentiment coupled with volume patterns suggests bearish pressure.",
            "Pessimistic market outlook reinforced by volume contraction indicates downward trend.",
            "Bearish signals from sentiment analysis and on-chain volume metrics.",
        ],
        Trend.NEUTRAL: [
            "Mixed or neutral signals with balanced sentiment and volume activity.",
            "Market shows indecision with offsetting positive and negative indicators.",
            "Neutral stance as sentiment and volume signals counterbalance each other.",
        ],
    }

    import random

    base_explanation = random.choice(explanations[trend])

    if trend == Trend.NEUTRAL:
        if score > 0:
            return f"{base_explanation} Leaning slightly positive (score: {score:.2f})."
        elif score < 0:
            return f"{base_explanation} Leaning slightly negative (score: {score:.2f})."

    return f"{base_explanation} Market Health Score: {score:.2f}"
