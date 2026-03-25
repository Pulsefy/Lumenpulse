"""
Anomaly Detector module - Detects abnormal spikes in trade volume or social sentiment
using both statistical methods (Z-Score) and a machine learning model
(Isolation Forest) to identify outliers that deviate significantly from
baseline behavior.
"""

import os
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from sklearn.ensemble import IsolationForest

from src.utils.logger import setup_logger
from src.utils.metrics import ANOMALIES_DETECTED_TOTAL

logger = setup_logger(__name__)


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
    detection_method: str = "zscore"
    comparison: Dict[str, Any] = field(default_factory=dict)

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
            "detection_method": self.detection_method,
            "comparison": self.comparison,
        }


class AnomalyDetector:
    """
    Anomaly detector for trade volume and social sentiment metrics.

    Features:
    - Rolling window statistics (24-hour baseline)
    - Isolation Forest based multi-dimensional anomaly detection
    - Z-Score based comparison for backwards compatibility
    - Configurable sensitivity thresholds
    - Severity scoring (0.0-1.0)
    """

    # Default configuration
    DEFAULT_WINDOW_SIZE_HOURS = 24
    DEFAULT_Z_THRESHOLD = 2.5  # Standard deviations from mean
    DEFAULT_CONTAMINATION = 0.1
    DEFAULT_DETECTION_METHOD = "isolation_forest"
    MIN_DATA_POINTS = 10  # Minimum data points required for reliable statistics

    def __init__(
        self,
        window_size_hours: int = None,
        z_threshold: float = None,
        contamination: float = None,
        detection_method: Optional[str] = None,
        random_state: int = 42,
    ):
        """
        Initialize the anomaly detector.

        Args:
            window_size_hours: Size of rolling window in hours (default: 24)
            z_threshold: Z-score threshold for anomaly detection (default: 2.5)
            contamination: Expected anomaly ratio for Isolation Forest
            detection_method: Primary detector to use ("isolation_forest" or "zscore")
            random_state: Random seed for deterministic model behavior
        """
        self.window_size_hours = window_size_hours or int(
            os.getenv("ANOMALY_WINDOW_SIZE_HOURS", self.DEFAULT_WINDOW_SIZE_HOURS)
        )
        self.z_threshold = z_threshold or float(
            os.getenv("ANOMALY_Z_THRESHOLD", self.DEFAULT_Z_THRESHOLD)
        )
        self.contamination = self._validate_contamination(
            contamination
            if contamination is not None
            else float(
                os.getenv(
                    "ANOMALY_DETECTOR_CONTAMINATION", self.DEFAULT_CONTAMINATION
                )
            )
        )
        self.detection_method = self._validate_detection_method(
            detection_method
            or os.getenv(
                "ANOMALY_DETECTOR_METHOD", self.DEFAULT_DETECTION_METHOD
            )
        )
        self.random_state = random_state

        # Data storage for rolling windows
        self.volume_data = deque(
            maxlen=self.window_size_hours * 4
        )  # Assuming 15-min intervals
        self.sentiment_data = deque(maxlen=self.window_size_hours * 4)
        self.timestamp_data = deque(maxlen=self.window_size_hours * 4)
        self.comparison_stats: Dict[str, Any] = {
            "total_evaluations": 0,
            "method_counts": {
                "isolation_forest": 0,
                "zscore": 0,
            },
            "agreement_count": 0,
            "disagreement_count": 0,
        }

        logger.info(
            f"AnomalyDetector initialized with {self.window_size_hours}h window, "
            f"method={self.detection_method}, "
            f"Z-threshold: {self.z_threshold}, "
            f"contamination={self.contamination}"
        )

    def _validate_contamination(self, contamination: float) -> float:
        """Validate and normalize Isolation Forest contamination."""
        if 0.0 < contamination <= 0.5:
            return float(contamination)
        raise ValueError("contamination must be between 0 and 0.5")

    def _validate_detection_method(self, detection_method: str) -> str:
        """Validate the configured primary detection method."""
        normalized = detection_method.strip().lower()
        if normalized in {"isolation_forest", "zscore"}:
            return normalized
        raise ValueError(
            "detection_method must be either 'isolation_forest' or 'zscore'"
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

    def _calculate_ml_severity_score(
        self, anomaly_score: float, baseline_scores: np.ndarray, is_anomaly: bool
    ) -> float:
        """
        Convert Isolation Forest anomaly score into a severity score (0.0-1.0).
        """
        if not is_anomaly or baseline_scores.size == 0:
            return 0.0

        score_mean = float(np.mean(baseline_scores))
        score_std = float(np.std(baseline_scores, ddof=1)) if baseline_scores.size > 1 else 0.0
        if score_std <= 0:
            score_std = 1e-10

        normalized = max(0.0, (anomaly_score - score_mean) / (2 * score_std))
        return float(min(1.0, normalized))

    def _get_feature_matrix(self) -> np.ndarray:
        """Build the multivariate feature matrix for model training."""
        if not self.volume_data or not self.sentiment_data:
            return np.empty((0, 2), dtype=float)

        return np.column_stack(
            (
                np.asarray(self.volume_data, dtype=float),
                np.asarray(self.sentiment_data, dtype=float),
            )
        )

    def _compare_methods(
        self,
        isolation_result: Dict[str, Any],
        zscore_result: Dict[str, Any],
    ) -> None:
        """Track agreement between the ML and legacy methods."""
        self.comparison_stats["total_evaluations"] += 1
        self.comparison_stats["method_counts"]["isolation_forest"] += int(
            isolation_result["is_anomaly"]
        )
        self.comparison_stats["method_counts"]["zscore"] += int(
            zscore_result["is_anomaly"]
        )

        if isolation_result["is_anomaly"] == zscore_result["is_anomaly"]:
            self.comparison_stats["agreement_count"] += 1
        else:
            self.comparison_stats["disagreement_count"] += 1

    def _run_zscore_detection(
        self, current_value: float, baseline_values: List[float]
    ) -> Dict[str, float]:
        """Run the legacy Z-score detector for a single metric."""
        mean, std = self._calculate_statistics(baseline_values)
        z_score = self._calculate_z_score(current_value, mean, std)
        severity = self._calculate_severity_score(z_score)
        return {
            "baseline_mean": mean,
            "baseline_std": std,
            "z_score": z_score,
            "severity_score": severity,
            "is_anomaly": abs(z_score) > self.z_threshold,
        }

    def _run_isolation_forest_detection(
        self, current_volume: float, current_sentiment: float
    ) -> Optional[Dict[str, float]]:
        """Run the Isolation Forest model on the joint feature space."""
        feature_matrix = self._get_feature_matrix()
        if len(feature_matrix) < self.MIN_DATA_POINTS:
            return None

        model = IsolationForest(
            contamination=self.contamination,
            random_state=self.random_state,
        )
        model.fit(feature_matrix)

        sample = np.array([[float(current_volume), float(current_sentiment)]])
        prediction = model.predict(sample)[0]
        anomaly_score = float(-model.score_samples(sample)[0])
        baseline_scores = -model.score_samples(feature_matrix)
        is_anomaly = prediction == -1
        severity = self._calculate_ml_severity_score(
            anomaly_score=anomaly_score,
            baseline_scores=baseline_scores,
            is_anomaly=is_anomaly,
        )

        return {
            "anomaly_score": anomaly_score,
            "severity_score": severity,
            "is_anomaly": is_anomaly,
        }

    def _build_result(
        self,
        metric_name: str,
        current_value: float,
        companion_value: float,
        timestamp: datetime,
    ) -> AnomalyResult:
        """Build a result using the configured method plus legacy comparison."""
        baseline_values = (
            list(self.volume_data) if metric_name == "volume" else list(self.sentiment_data)
        )
        if len(baseline_values) < self.MIN_DATA_POINTS:
            return AnomalyResult(
                is_anomaly=False,
                severity_score=0.0,
                metric_name=metric_name,
                current_value=current_value,
                baseline_mean=0.0,
                baseline_std=0.0,
                z_score=0.0,
                timestamp=timestamp,
                detection_method=self.detection_method,
                comparison={},
            )

        zscore_result = self._run_zscore_detection(current_value, baseline_values)
        isolation_result = self._run_isolation_forest_detection(
            current_volume=current_value if metric_name == "volume" else companion_value,
            current_sentiment=companion_value if metric_name == "volume" else current_value,
        )

        if isolation_result is None:
            primary_method = "zscore"
            primary_result = zscore_result
        elif self.detection_method == "zscore":
            primary_method = "zscore"
            primary_result = zscore_result
        else:
            primary_method = "isolation_forest"
            primary_result = isolation_result
            self._compare_methods(isolation_result, zscore_result)

        severity_score = max(
            float(primary_result["severity_score"]),
            float(zscore_result["severity_score"]),
        )

        comparison = {
            "zscore": zscore_result,
            "isolation_forest": isolation_result,
        }

        return AnomalyResult(
            is_anomaly=bool(primary_result["is_anomaly"]),
            severity_score=severity_score,
            metric_name=metric_name,
            current_value=current_value,
            baseline_mean=float(zscore_result["baseline_mean"]),
            baseline_std=float(zscore_result["baseline_std"]),
            z_score=float(zscore_result["z_score"]),
            timestamp=timestamp,
            detection_method=primary_method,
            comparison=comparison,
        )

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
            companion_sentiment = (
                float(self.sentiment_data[-1]) if self.sentiment_data else 0.0
            )
            result = self._build_result(
                metric_name="volume",
                current_value=float(current_volume),
                companion_value=companion_sentiment,
                timestamp=timestamp,
            )

            if result.is_anomaly:
                ANOMALIES_DETECTED_TOTAL.labels(metric_name="volume").inc()

            return result

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
                detection_method=self.detection_method,
                comparison={},
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
            companion_volume = float(self.volume_data[-1]) if self.volume_data else 0.0
            result = self._build_result(
                metric_name="sentiment",
                current_value=float(current_sentiment),
                companion_value=companion_volume,
                timestamp=timestamp,
            )

            if result.is_anomaly:
                ANOMALIES_DETECTED_TOTAL.labels(metric_name="sentiment").inc()

            return result

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
                detection_method=self.detection_method,
                comparison={},
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

        try:
            volume_result = self._build_result(
                metric_name="volume",
                current_value=float(volume),
                companion_value=float(sentiment_score),
                timestamp=timestamp,
            )
            sentiment_result = self._build_result(
                metric_name="sentiment",
                current_value=float(sentiment_score),
                companion_value=float(volume),
                timestamp=timestamp,
            )

            if volume_result.is_anomaly:
                ANOMALIES_DETECTED_TOTAL.labels(metric_name="volume").inc()
            if sentiment_result.is_anomaly:
                ANOMALIES_DETECTED_TOTAL.labels(metric_name="sentiment").inc()
        except Exception as e:
            logger.error(f"Error detecting combined anomalies: {e}")
            volume_result = AnomalyResult(
                is_anomaly=False,
                severity_score=0.0,
                metric_name="volume",
                current_value=float(volume),
                baseline_mean=0.0,
                baseline_std=0.0,
                z_score=0.0,
                timestamp=timestamp,
                detection_method=self.detection_method,
                comparison={},
            )
            sentiment_result = AnomalyResult(
                is_anomaly=False,
                severity_score=0.0,
                metric_name="sentiment",
                current_value=float(sentiment_score),
                baseline_mean=0.0,
                baseline_std=0.0,
                z_score=0.0,
                timestamp=timestamp,
                detection_method=self.detection_method,
                comparison={},
            )

        self.add_data_point(volume, sentiment_score, timestamp)

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
            "contamination": self.contamination,
            "detection_method": self.detection_method,
            "data_points_count": len(self.timestamp_data),
            "comparison_stats": self.comparison_stats.copy(),
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
    window_size_hours: int = 24,
    z_threshold: float = 2.5,
    contamination: Optional[float] = None,
    detection_method: Optional[str] = None,
) -> AnomalyDetector:
    """
    Factory function to create an AnomalyDetector instance.

    Args:
        window_size_hours: Size of rolling window in hours
        z_threshold: Z-score threshold for anomaly detection
        contamination: Expected anomaly ratio for Isolation Forest
        detection_method: Primary detection strategy

    Returns:
        Configured AnomalyDetector instance
    """
    return AnomalyDetector(
        window_size_hours=window_size_hours,
        z_threshold=z_threshold,
        contamination=contamination,
        detection_method=detection_method,
    )


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

    detector = AnomalyDetector(z_threshold=z_threshold, detection_method="zscore")

    # Populate detector with baseline data
    dummy_timestamp = datetime.utcnow()
    for value in baseline_values:
        detector.add_data_point(value, 0.0, dummy_timestamp)

    # Test current value (using volume detection)
    result = detector.detect_volume_anomaly(current_value, dummy_timestamp)
    return result.is_anomaly, result.severity_score
