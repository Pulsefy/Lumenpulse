"""
Analytics module for market analysis and trend detection.
"""

from .market_analyzer import MarketAnalyzer, Trend, MarketData, get_explanation
from .correlation_engine import CorrelationEngine, CorrelationResult, DataPoint

__all__ = [
    "MarketAnalyzer",
    "Trend",
    "MarketData",
    "get_explanation",
    "CorrelationEngine",
    "CorrelationResult",
    "DataPoint",
]
