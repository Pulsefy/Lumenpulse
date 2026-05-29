"""
Correlation Analysis Engine
Calculates statistical correlation between social sentiment and Stellar on-chain metrics.
"""

from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime
import pandas as pd
import numpy as np


@dataclass
class DataPoint:
    """Single data point for scatter plot visualization."""

    timestamp: datetime
    sentiment: float
    metric_value: float
    metric_type: str  # 'price' or 'volume'

    def to_dict(self) -> Dict[str, Any]:
        return {
            "timestamp": self.timestamp.isoformat(),
            "sentiment": self.sentiment,
            "metric_value": self.metric_value,
            "metric_type": self.metric_type,
        }


@dataclass
class CorrelationResult:
    """Result of correlation analysis between sentiment and a market metric."""

    metric_type: str  # 'price' or 'volume'
    correlation_score: float  # Pearson correlation coefficient (-1 to 1)
    p_value: Optional[float]  # Statistical significance
    sample_size: int
    confidence_level: str  # 'high', 'medium', 'low', 'insufficient_data'
    data_points: List[DataPoint] = field(default_factory=list)
    lag_hours: int = 0  # Time lag between sentiment and metric

    def to_dict(self) -> Dict[str, Any]:
        return {
            "metric_type": self.metric_type,
            "correlation_score": round(self.correlation_score, 4),
            "p_value": round(self.p_value, 6) if self.p_value is not None else None,
            "sample_size": self.sample_size,
            "confidence_level": self.confidence_level,
            "lag_hours": self.lag_hours,
            "interpretation": self._interpret_correlation(),
            "scatter_data": [dp.to_dict() for dp in self.data_points],
        }

    def _interpret_correlation(self) -> str:
        """Provide human-readable interpretation of the correlation score."""
        score = abs(self.correlation_score)
        direction = "positive" if self.correlation_score > 0 else "negative"

        if self.sample_size < 10:
            return "Insufficient data for reliable interpretation."
        if score >= 0.7:
            return f"Strong {direction} correlation: sentiment is a strong leading indicator."
        if score >= 0.4:
            return f"Moderate {direction} correlation: sentiment shows predictive value."
        if score >= 0.2:
            return f"Weak {direction} correlation: limited predictive relationship."
        return "No significant correlation: sentiment does not predict this metric."


class CorrelationEngine:
    """
    Calculates statistical correlation between social sentiment and on-chain metrics.

    Supports:
    - Sentiment vs Price correlation
    - Sentiment vs Volume correlation
    - Time-lagged correlation analysis
    - Scatter plot data generation
    """

    MIN_SAMPLES = 5
    RECOMMENDED_SAMPLES = 30

    @staticmethod
    def _calculate_pearson(
        x: pd.Series, y: pd.Series
    ) -> Tuple[float, Optional[float]]:
        """
        Calculate Pearson correlation coefficient and p-value.

        Returns:
            Tuple of (correlation_score, p_value)
        """
        if len(x) < 2 or len(y) < 2:
            return 0.0, None

        # Remove any NaN values
        mask = ~(x.isna() | y.isna())
        x_clean = x[mask]
        y_clean = y[mask]

        if len(x_clean) < 2:
            return 0.0, None

        # Calculate correlation using pandas
        correlation = x_clean.corr(y_clean)

        if pd.isna(correlation):
            return 0.0, None

        # Calculate p-value using t-distribution approximation
        n = len(x_clean)
        if abs(correlation) >= 1.0:
            p_value = 0.0
        else:
            t_stat = correlation * np.sqrt((n - 2) / (1 - correlation**2))
            # Two-tailed p-value approximation
            from math import erfc, sqrt

            p_value = erfc(abs(t_stat) / sqrt(2))

        return float(correlation), float(p_value)

    @staticmethod
    def _determine_confidence(sample_size: int, p_value: Optional[float]) -> str:
        """Determine confidence level based on sample size and p-value."""
        if sample_size < CorrelationEngine.MIN_SAMPLES:
            return "insufficient_data"
        if p_value is None:
            return "low"
        if sample_size >= CorrelationEngine.RECOMMENDED_SAMPLES and p_value < 0.05:
            return "high"
        if sample_size >= 15 and p_value < 0.10:
            return "medium"
        return "low"

    @classmethod
    def calculate_correlation(
        cls,
        sentiment_data: List[Dict[str, Any]],
        metric_data: List[Dict[str, Any]],
        metric_type: str = "volume",
        lag_hours: int = 0,
    ) -> CorrelationResult:
        """
        Calculate correlation between sentiment and a market metric.

        Args:
            sentiment_data: List of dicts with 'timestamp' and 'score' keys
            metric_data: List of dicts with 'timestamp' and 'value' keys
            metric_type: Type of metric ('price' or 'volume')
            lag_hours: Hours to shift sentiment data (positive = sentiment leads)

        Returns:
            CorrelationResult with score, confidence, and scatter data
        """
        if not sentiment_data or not metric_data:
            return CorrelationResult(
                metric_type=metric_type,
                correlation_score=0.0,
                p_value=None,
                sample_size=0,
                confidence_level="insufficient_data",
                data_points=[],
                lag_hours=lag_hours,
            )

        # Convert to DataFrames
        sentiment_df = pd.DataFrame(sentiment_data)
        metric_df = pd.DataFrame(metric_data)

        # Parse timestamps
        sentiment_df["timestamp"] = pd.to_datetime(sentiment_df["timestamp"])
        metric_df["timestamp"] = pd.to_datetime(metric_df["timestamp"])

        # Apply lag to sentiment data
        if lag_hours > 0:
            sentiment_df["timestamp"] = sentiment_df["timestamp"] + pd.Timedelta(
                hours=lag_hours
            )

        # Round to hourly for alignment
        sentiment_df["hour"] = sentiment_df["timestamp"].dt.floor("h")
        metric_df["hour"] = metric_df["timestamp"].dt.floor("h")

        # Aggregate sentiment by hour (average)
        sentiment_hourly = (
            sentiment_df.groupby("hour")["score"].mean().reset_index()
        )
        sentiment_hourly.columns = ["hour", "sentiment"]

        # Aggregate metric by hour (average for price, sum for volume)
        if metric_type == "volume":
            metric_hourly = metric_df.groupby("hour")["value"].sum().reset_index()
        else:
            metric_hourly = metric_df.groupby("hour")["value"].mean().reset_index()
        metric_hourly.columns = ["hour", "metric_value"]

        # Merge on hour
        merged = pd.merge(sentiment_hourly, metric_hourly, on="hour", how="inner")

        if len(merged) < cls.MIN_SAMPLES:
            return CorrelationResult(
                metric_type=metric_type,
                correlation_score=0.0,
                p_value=None,
                sample_size=len(merged),
                confidence_level="insufficient_data",
                data_points=[],
                lag_hours=lag_hours,
            )

        # Calculate correlation
        correlation, p_value = cls._calculate_pearson(
            merged["sentiment"], merged["metric_value"]
        )

        # Build scatter data points
        data_points = [
            DataPoint(
                timestamp=row["hour"].to_pydatetime(),
                sentiment=float(row["sentiment"]),
                metric_value=float(row["metric_value"]),
                metric_type=metric_type,
            )
            for _, row in merged.iterrows()
        ]

        confidence = cls._determine_confidence(len(merged), p_value)

        return CorrelationResult(
            metric_type=metric_type,
            correlation_score=correlation,
            p_value=p_value,
            sample_size=len(merged),
            confidence_level=confidence,
            data_points=data_points,
            lag_hours=lag_hours,
        )

    @classmethod
    def analyze_with_lags(
        cls,
        sentiment_data: List[Dict[str, Any]],
        metric_data: List[Dict[str, Any]],
        metric_type: str = "volume",
        max_lag_hours: int = 24,
    ) -> Dict[str, Any]:
        """
        Analyze correlation across multiple time lags to find optimal lead time.

        Args:
            sentiment_data: List of dicts with 'timestamp' and 'score' keys
            metric_data: List of dicts with 'timestamp' and 'value' keys
            metric_type: Type of metric ('price' or 'volume')
            max_lag_hours: Maximum lag to test

        Returns:
            Dict with best lag, all correlations, and recommendation
        """
        lag_results = []

        for lag in range(0, max_lag_hours + 1, 1):
            result = cls.calculate_correlation(
                sentiment_data, metric_data, metric_type, lag_hours=lag
            )
            lag_results.append(
                {
                    "lag_hours": lag,
                    "correlation": result.correlation_score,
                    "p_value": result.p_value,
                    "confidence": result.confidence_level,
                }
            )

        # Find best correlation (highest absolute value with sufficient confidence)
        valid_results = [
            r for r in lag_results if r["confidence"] != "insufficient_data"
        ]

        if not valid_results:
            return {
                "best_lag_hours": 0,
                "best_correlation": 0.0,
                "lag_analysis": lag_results,
                "recommendation": "Insufficient data to determine optimal lag.",
            }

        best = max(valid_results, key=lambda x: abs(x["correlation"]))

        if abs(best["correlation"]) >= 0.4:
            recommendation = (
                f"Sentiment appears to lead {metric_type} changes by approximately "
                f"{best['lag_hours']} hours with {best['confidence']} confidence."
            )
        else:
            recommendation = (
                f"No strong leading relationship found. Best correlation of "
                f"{best['correlation']:.3f} at {best['lag_hours']}h lag."
            )

        return {
            "best_lag_hours": best["lag_hours"],
            "best_correlation": best["correlation"],
            "lag_analysis": lag_results,
            "recommendation": recommendation,
        }

    @classmethod
    def full_analysis(
        cls,
        sentiment_data: List[Dict[str, Any]],
        price_data: List[Dict[str, Any]],
        volume_data: List[Dict[str, Any]],
        lag_hours: int = 0,
    ) -> Dict[str, Any]:
        """
        Perform full correlation analysis for both price and volume.

        Args:
            sentiment_data: List of dicts with 'timestamp' and 'score' keys
            price_data: List of dicts with 'timestamp' and 'value' keys
            volume_data: List of dicts with 'timestamp' and 'value' keys
            lag_hours: Time lag to apply

        Returns:
            Complete analysis results with both correlations
        """
        price_result = cls.calculate_correlation(
            sentiment_data, price_data, metric_type="price", lag_hours=lag_hours
        )

        volume_result = cls.calculate_correlation(
            sentiment_data, volume_data, metric_type="volume", lag_hours=lag_hours
        )

        return {
            "price_correlation": price_result.to_dict(),
            "volume_correlation": volume_result.to_dict(),
            "summary": {
                "sentiment_is_leading_indicator": (
                    abs(price_result.correlation_score) >= 0.4
                    or abs(volume_result.correlation_score) >= 0.4
                )
                and (
                    price_result.confidence_level in ("high", "medium")
                    or volume_result.confidence_level in ("high", "medium")
                ),
                "strongest_relationship": (
                    "price"
                    if abs(price_result.correlation_score)
                    > abs(volume_result.correlation_score)
                    else "volume"
                ),
                "analysis_timestamp": datetime.utcnow().isoformat(),
            },
        }
