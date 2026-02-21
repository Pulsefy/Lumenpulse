"""
Example usage of MarketAnalyzer with simulated data.
"""

import sys
import os

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from src.analytics.market_analyzer import (
    MarketAnalyzer,
    Trend,
    MarketData,
    get_explanation,
)


def run_example():
    """Run example market analysis scenarios"""

    print("=" * 60)
    print("MARKET TREND HEURISTIC EXAMPLE")
    print("=" * 60)

    # Example 1: Bullish scenario
    print("\n1. BULLISH SCENARIO:")
    print("-" * 40)
    bullish_data = MarketData(
        sentiment_score=0.75, volume_change=0.45  # Very positive news  # Volume up 45%
    )

    trend, score, metrics = MarketAnalyzer.analyze_trend(bullish_data)
    explanation = get_explanation(score, trend)

    print(f"Sentiment: {bullish_data.sentiment_score:.2f}")
    print(f"Volume Change: {bullish_data.volume_change:.1%}")
    print(f"Health Score: {score:.2f}")
    print(f"Trend: {trend.value.upper()}")
    print(f"Explanation: {explanation}")
    print(
        f"Components: Sentiment={metrics['sentiment_component']:.2f}, "
        f"Volume={metrics['volume_component']:.2f}"
    )

    # Example 2: Bearish scenario
    print("\n\n2. BEARISH SCENARIO:")
    print("-" * 40)
    bearish_data = MarketData(
        sentiment_score=-0.65, volume_change=-0.25  # Negative news  # Volume down 25%
    )

    trend, score, metrics = MarketAnalyzer.analyze_trend(bearish_data)
    explanation = get_explanation(score, trend)

    print(f"Sentiment: {bearish_data.sentiment_score:.2f}")
    print(f"Volume Change: {bearish_data.volume_change:.1%}")
    print(f"Health Score: {score:.2f}")
    print(f"Trend: {trend.value.upper()}")
    print(f"Explanation: {explanation}")

    # Example 3: Neutral scenario
    print("\n\n3. NEUTRAL SCENARIO:")
    print("-" * 40)
    neutral_data = MarketData(
        sentiment_score=0.15,  # Slightly positive
        volume_change=-0.10,  # Slightly negative
    )

    trend, score, metrics = MarketAnalyzer.analyze_trend(neutral_data)
    explanation = get_explanation(score, trend)

    print(f"Sentiment: {neutral_data.sentiment_score:.2f}")
    print(f"Volume Change: {neutral_data.volume_change:.1%}")
    print(f"Health Score: {score:.2f}")
    print(f"Trend: {trend.value.upper()}")
    print(f"Explanation: {explanation}")

    # Example 4: Using convenience method
    print("\n\n4. USING CONVENIENCE METHOD:")
    print("-" * 40)

    # Simulate data from external sources
    sentiment_from_news = 0.3
    volume_from_stellar = {"current": 1250.0, "previous": 1000.0}

    trend, score, metrics = MarketAnalyzer.analyze_from_sources(
        sentiment_from_news, volume_from_stellar
    )

    print(f"Raw Data - Sentiment: {sentiment_from_news:.2f}")
    print(f"Raw Data - Volume Current: {volume_from_stellar['current']}")
    print(f"Raw Data - Volume Previous: {volume_from_stellar['previous']}")
    print(f"Calculated Volume Change: {metrics['volume_change']:.1%}")
    print(f"Health Score: {score:.2f}")
    print(f"Trend: {trend.value.upper()}")

    print("\n" + "=" * 60)
    print("FORMULA USED:")
    print("=" * 60)
    print("Market Health Score = (Sentiment × 0.6) + (tanh(Volume_Change) × 0.4)")
    print("\nClassification:")
    print(f"- Score > {MarketAnalyzer.BULLISH_THRESHOLD}: BULLISH")
    print(f"- Score < {MarketAnalyzer.BEARISH_THRESHOLD}: BEARISH")
    print(f"- Otherwise: NEUTRAL")


if __name__ == "__main__":
    run_example()
