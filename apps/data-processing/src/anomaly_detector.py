"""
Anomaly Detector module - Detects abnormal spikes in trade volume or social sentiment
using statistical methods (Z-Score) to identify outliers that deviate significantly
from baseline statistics.
"""

import logging
from typing import List, Dict, Any, Tuple, Optional
from datetime import datetime, timedelta
from collections import deque
import numpy as np
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class AnomalyResult:
    """Result of anomaly detection"""

    is_anomaly: bool
    severity_score: float  # 0.0 - 1.0
    metric_name: str
    current_value: float
    baseline_mean: float
    baseline_std: float
    z_score: float
    timestamp: datetime

    def to_dict(self) -> Dict[str, Any]:
        return {
            "is_anomaly": self.is_anomaly,
            "severity_score": self.severity_score,
            "metric_name": self.metric_name,
            "current_value": self.current_value,
            "baseline_mean": self.baseline_mean,
            "baseline_std": self.baseline_std,
            "z_score": self.z_score,
            "timestamp": self.timestamp.isoformat(),
        }


class AnomalyDetector:
    """
    Statistical anomaly detector using Z-Score methodology to identify outliers
    in time-series data for trade volume and social sentiment metrics.

    Features:
    - Rolling window statistics (24-hour baseline)
    - Z-Score based anomaly detection
    - Configurable sensitivity thresholds
    - Severity scoring (0.0-1.0)
    """

    # Default configuration
    DEFAULT_WINDOW_SIZE_HOURS = 24
    DEFAULT_Z_THRESHOLD = 2.5  # Standard deviations from mean
    MIN_DATA_POINTS = 10  # Minimum data points required for reliable statistics

    def __init__(self, window_size_hours: int = None, z_threshold: float = None):
        """
        Initialize the anomaly detector.

        Args:
            window_size_hours: Size of rolling window in hours (default: 24)
            z_threshold: Z-score threshold for anomaly detection (default: 2.5)
        """
        self.window_size_hours = window_size_hours or self.DEFAULT_WINDOW_SIZE_HOURS
        self.z_threshold = z_threshold or self.DEFAULT_Z_THRESHOLD

        # Data storage for rolling windows
        self.volume_data = deque(
            maxlen=self.window_size_hours * 4
        )  # Assuming 15-min intervals
        self.sentiment_data = deque(maxlen=self.window_size_hours * 4)
        self.timestamp_data = deque(maxlen=self.window_size_hours * 4)

        logger.info(
            f"AnomalyDetector initialized with {self.window_size_hours}h window, "
            f"Z-threshold: {self.z_threshold}"
        )

    def _calculate_statistics(self, data_points: List[float]) -> Tuple[float, float]:
        """
        Calculate mean and standard deviation for a list of data points.

        Args:
            data_points: List of numerical values

        Returns:
            Tuple of (mean, standard_deviation)
        """
        if len(data_points) < self.MIN_DATA_POINTS:
            raise ValueError(
                f"Need at least {self.MIN_DATA_POINTS} data points for reliable statistics"
            )

        mean = np.mean(data_points)
        std = np.std(data_points, ddof=1)  # Sample standard deviation

        # Handle case where std is zero (all values identical)
        if std == 0:
            std = 1e-10  # Small epsilon to avoid division by zero

        return float(mean), float(std)

    def _calculate_z_score(self, value: float, mean: float, std: float) -> float:
        """
        Calculate Z-score for a value given mean and standard deviation.

        Args:
            value: Current value to evaluate
            mean: Baseline mean
            std: Baseline standard deviation

        Returns:
            Z-score (standard deviations from mean)
        """
        return (value - mean) / std

    def _calculate_severity_score(self, z_score: float) -> float:
        """
        Convert Z-score to severity score (0.0-1.0).
        Higher absolute Z-scores result in higher severity.

        Args:
            z_score: Z-score value

        Returns:
            Severity score between 0.0 and 1.0
        """
        # Map Z-score to severity using sigmoid-like function
        abs_z = abs(z_score)

        # Linear mapping for typical range, capped at 1.0
        if abs_z <= self.z_threshold:
            return 0.0
        elif abs_z <= self.z_threshold * 2:
            # Linear interpolation between threshold and double threshold
            return (abs_z - self.z_threshold) / self.z_threshold
        else:
            # Cap at maximum severity
            return 1.0

    def _clean_old_data(self, current_timestamp: datetime):
        """
        Remove data points older than the window size.

        Args:
            current_timestamp: Current timestamp for comparison
        """
        cutoff_time = current_timestamp - timedelta(hours=self.window_size_hours)

        # Remove old data points
        while (
            self.timestamp_data
            and len(self.timestamp_data) > 0
            and self.timestamp_data[0] < cutoff_time
        ):
            self.timestamp_data.popleft()
            if self.volume_data:
                self.volume_data.popleft()
            if self.sentiment_data:
                self.sentiment_data.popleft()

    def add_data_point(
        self, volume: float, sentiment_score: float, timestamp: datetime = None
    ):
        """
        Add a new data point to the rolling window.

        Args:
            volume: Trade volume value
            sentiment_score: Social sentiment score (-1.0 to 1.0)
            timestamp: Timestamp of the data point (defaults to current time)
        """
        if timestamp is None:
            timestamp = datetime.utcnow()

        # Clean old data first
        self._clean_old_data(timestamp)

        # Add new data point
        self.timestamp_data.append(timestamp)
        self.volume_data.append(float(volume))
        self.sentiment_data.append(float(sentiment_score))

        logger.debug(f"Added data point: volume={volume}, sentiment={sentiment_score}")

    def detect_volume_anomaly(
        self, current_volume: float, timestamp: datetime = None
    ) -> AnomalyResult:
        """
        Detect anomalies in trade volume data.

        Args:
            current_volume: Current volume to evaluate
            timestamp: Timestamp of current data point

        Returns:
            AnomalyResult indicating whether an anomaly was detected
        """
        if timestamp is None:
            timestamp = datetime.utcnow()

        try:
            # Get baseline statistics
            baseline_values = list(self.volume_data)
            if len(baseline_values) < self.MIN_DATA_POINTS:
                return AnomalyResult(
                    is_anomaly=False,
                    severity_score=0.0,
                    metric_name="volume",
                    current_value=current_volume,
                    baseline_mean=0.0,
                    baseline_std=0.0,
                    z_score=0.0,
                    timestamp=timestamp,
                )

            mean, std = self._calculate_statistics(baseline_values)
            z_score = self._calculate_z_score(current_volume, mean, std)
            severity = self._calculate_severity_score(z_score)
            is_anomaly = abs(z_score) > self.z_threshold

            return AnomalyResult(
                is_anomaly=is_anomaly,
                severity_score=severity,
                metric_name="volume",
                current_value=current_volume,
                baseline_mean=mean,
                baseline_std=std,
                z_score=z_score,
                timestamp=timestamp,
            )

        except Exception as e:
            logger.error(f"Error detecting volume anomaly: {e}")
            return AnomalyResult(
                is_anomaly=False,
                severity_score=0.0,
                metric_name="volume",
                current_value=current_volume,
                baseline_mean=0.0,
                baseline_std=0.0,
                z_score=0.0,
                timestamp=timestamp,
            )

    def detect_sentiment_anomaly(
        self, current_sentiment: float, timestamp: datetime = None
    ) -> AnomalyResult:
        """
        Detect anomalies in social sentiment data.

        Args:
            current_sentiment: Current sentiment score to evaluate
            timestamp: Timestamp of current data point

        Returns:
            AnomalyResult indicating whether an anomaly was detected
        """
        if timestamp is None:
            timestamp = datetime.utcnow()

        try:
            # Get baseline statistics
            baseline_values = list(self.sentiment_data)
            if len(baseline_values) < self.MIN_DATA_POINTS:
                return AnomalyResult(
                    is_anomaly=False,
                    severity_score=0.0,
                    metric_name="sentiment",
                    current_value=current_sentiment,
                    baseline_mean=0.0,
                    baseline_std=0.0,
                    z_score=0.0,
                    timestamp=timestamp,
                )

            mean, std = self._calculate_statistics(baseline_values)
            z_score = self._calculate_z_score(current_sentiment, mean, std)
            severity = self._calculate_severity_score(z_score)
            is_anomaly = abs(z_score) > self.z_threshold

            return AnomalyResult(
                is_anomaly=is_anomaly,
                severity_score=severity,
                metric_name="sentiment",
                current_value=current_sentiment,
                baseline_mean=mean,
                baseline_std=std,
                z_score=z_score,
                timestamp=timestamp,
            )

        except Exception as e:
            logger.error(f"Error detecting sentiment anomaly: {e}")
            return AnomalyResult(
                is_anomaly=False,
                severity_score=0.0,
                metric_name="sentiment",
                current_value=current_sentiment,
                baseline_mean=0.0,
                baseline_std=0.0,
                z_score=0.0,
                timestamp=timestamp,
            )

    def detect_anomalies(
        self, volume: float, sentiment_score: float, timestamp: datetime = None
    ) -> List[AnomalyResult]:
        """
        Detect anomalies for both volume and sentiment simultaneously.

        Args:
            volume: Current trade volume
            sentiment_score: Current sentiment score
            timestamp: Timestamp of current data point

        Returns:
            List of AnomalyResult objects for both metrics
        """
        if timestamp is None:
            timestamp = datetime.utcnow()

        # Add data point first
        self.add_data_point(volume, sentiment_score, timestamp)

        # Detect anomalies
        volume_result = self.detect_volume_anomaly(volume, timestamp)
        sentiment_result = self.detect_sentiment_anomaly(sentiment_score, timestamp)

        return [volume_result, sentiment_result]

    def get_window_stats(self) -> Dict[str, Any]:
        """
        Get current window statistics for monitoring/debugging.

        Returns:
            Dictionary with window statistics
        """
        volume_list = list(self.volume_data)
        sentiment_list = list(self.sentiment_data)

        stats = {
            "window_size_hours": self.window_size_hours,
            "z_threshold": self.z_threshold,
            "data_points_count": len(self.timestamp_data),
            "volume_stats": {},
            "sentiment_stats": {},
        }

        if volume_list:
            stats["volume_stats"] = {
                "count": len(volume_list),
                "mean": float(np.mean(volume_list)),
                "std": float(np.std(volume_list, ddof=1)),
                "min": float(np.min(volume_list)),
                "max": float(np.max(volume_list)),
            }

        if sentiment_list:
            stats["sentiment_stats"] = {
                "count": len(sentiment_list),
                "mean": float(np.mean(sentiment_list)),
                "std": float(np.std(sentiment_list, ddof=1)),
                "min": float(np.min(sentiment_list)),
                "max": float(np.max(sentiment_list)),
            }

        return stats

    def reset(self):
        """Reset the detector by clearing all stored data."""
        self.volume_data.clear()
        self.sentiment_data.clear()
        self.timestamp_data.clear()
        logger.info("AnomalyDetector reset completed")


# Convenience functions for easy usage
def create_detector(
    window_size_hours: int = 24, z_threshold: float = 2.5
) -> AnomalyDetector:
    """
    Factory function to create an AnomalyDetector instance.

    Args:
        window_size_hours: Size of rolling window in hours
        z_threshold: Z-score threshold for anomaly detection

    Returns:
        Configured AnomalyDetector instance
    """
    return AnomalyDetector(window_size_hours=window_size_hours, z_threshold=z_threshold)


def detect_spike(
    current_value: float, baseline_values: List[float], z_threshold: float = 2.5
) -> Tuple[bool, float]:
    """
    Simple spike detection for a single value against baseline.

    Args:
        current_value: Value to test
        baseline_values: Historical baseline values
        z_threshold: Z-score threshold for anomaly detection

    Returns:
        Tuple of (is_anomaly, severity_score)
    """
    if len(baseline_values) < 10:
        return False, 0.0

    detector = AnomalyDetector(z_threshold=z_threshold)

    # Populate detector with baseline data
    dummy_timestamp = datetime.utcnow()
    for value in baseline_values:
        detector.add_data_point(value, 0.0, dummy_timestamp)

    # Test current value (using volume detection)
    result = detector.detect_volume_anomaly(current_value, dummy_timestamp)
    return result.is_anomaly, result.severity_score
