"""Analytics module for market analysis and trend detection."""

__all__ = [
    "MarketAnalyzer",
    "Trend",
    "MarketData",
    "get_explanation",
    "SentimentForecaster",
    "ForecastResult",
    "CorrelationEngine",
    "CorrelationResult",
    "DataPoint",
    "NERService",
]


def __getattr__(name: str):
    """Lazy-load analytics exports so lightweight NLP imports stay cheap."""
    if name in {"MarketAnalyzer", "Trend", "MarketData", "get_explanation"}:
        from .market_analyzer import MarketAnalyzer, MarketData, Trend, get_explanation

        values = {
            "MarketAnalyzer": MarketAnalyzer,
            "Trend": Trend,
            "MarketData": MarketData,
            "get_explanation": get_explanation,
        }
        return values[name]

    if name in {"SentimentForecaster", "ForecastResult"}:
        from .forecaster import ForecastResult, SentimentForecaster

        return {
            "SentimentForecaster": SentimentForecaster,
            "ForecastResult": ForecastResult,
        }[name]

    if name in {"CorrelationEngine", "CorrelationResult", "DataPoint"}:
        from .correlation_engine import CorrelationEngine, CorrelationResult, DataPoint

        return {
            "CorrelationEngine": CorrelationEngine,
            "CorrelationResult": CorrelationResult,
            "DataPoint": DataPoint,
        }[name]

    if name == "NERService":
        from .ner_service import NERService

        return NERService

    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
