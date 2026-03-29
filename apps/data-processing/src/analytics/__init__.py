"""
Analytics module for market analysis and trend detection.
"""

from .market_analyzer import MarketAnalyzer, Trend, MarketData, get_explanation
from .forecaster import SentimentForecaster, ForecastResult
from .correlation_engine import CorrelationEngine, CorrelationResult, DataPoint
from .ner_service import NERService

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
