"""
Anomaly Detector module - Detects abnormal spikes in trade volume or social sentiment
using statistical methods (Z-Score) and Machine Learning (Isolation Forest) to identify
outliers and complex pump-and-dump patterns.
"""

from src.utils.logger import setup_logger
import json
from src.utils.metrics import ANOMALIES_DETECTED_TOTAL
from typing import List, Dict, Any, Tuple, Optional, Union
from datetime import datetime, timedelta
from collections import deque
import numpy as np
from dataclasses import dataclass, field
from sklearn.ensemble import IsolationForest
import joblib
import os

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
    ml_anomaly_score: Optional[float] = None  # Isolation Forest anomaly score
    ml_is_anomaly: Optional[bool] = None  # Isolation Forest prediction

    def to_dict(self) -> Dict[str, Any]:
        result = {
            "is_anomaly": self.is_anomaly,
            "severity_score": self.severity_score,
            "metric_name": self.metric_name,
            "current_value": self.current_value,
            "baseline_mean": self.baseline_mean,
            "baseline_std": self.baseline_std,
            "z_score": self.z_score,
            "timestamp": self.timestamp.isoformat(),
        }
        if self.ml_anomaly_score is not None:
            result["ml_anomaly_score"] = self.ml_anomaly_score
            result["ml_is_anomaly"] = self.ml_is_anomaly
        return result


@dataclass
class MultiDimensionalAnomalyResult:
    """Result for multi-dimensional anomaly detection using Isolation Forest"""

    is_anomaly: bool
    anomaly_score: float  # Lower = more anomalous (typical for Isolation Forest)
    severity_score: float  # 0.0 - 1.0
    features_used: List[str]
    feature_values: Dict[str, float]
    timestamp: datetime

    def to_dict(self) -> Dict[str, Any]:
        return {
            "is_anomaly": self.is_anomaly,
            "anomaly_score": self.anomaly_score,
            "severity_score": self.severity_score,
            "features_used": self.features_used,
            "feature_values": self.feature_values,
            "timestamp": self.timestamp.isoformat(),
        }


class IsolationForestDetector:
    """
    ML-based anomaly detector using Isolation Forest algorithm.
    Detects multi-dimensional anomalies that might be missed by univariate methods.
    """

    DEFAULT_CONTAMINATION = 0.1  # Expected proportion of anomalies (10%)
    DEFAULT_N_ESTIMATORS = 100
    DEFAULT_MAX_SAMPLES = 'auto'
    DEFAULT_FEATURES = ['volume', 'sentiment', 'volume_change_rate', 'sentiment_change_rate']

    def __init__(
        self,
        contamination: float = None,
        n_estimators: int = None,
        max_samples: Union[str, int] = 'auto',
        random_state: int = 42,
        feature_columns: List[str] = None
    ):
        """
        Initialize Isolation Forest detector.

        Args:
            contamination: Expected proportion of anomalies (0.0 to 0.5)
            n_estimators: Number of base estimators in the ensemble
            max_samples: Number of samples to draw for training
            random_state: Random seed for reproducibility
            feature_columns: List of feature names to use
        """
        self.contamination = contamination or self.DEFAULT_CONTAMINATION
        self.n_estimators = n_estimators or self.DEFAULT_N_ESTIMATORS
        self.max_samples = max_samples
        self.random_state = random_state
        self.feature_columns = feature_columns or self.DEFAULT_FEATURES

        self.model = IsolationForest(
            contamination=self.contamination,
            n_estimators=self.n_estimators,
            max_samples=self.max_samples,
            random_state=self.random_state,
            verbose=0
        )

        self.is_trained = False
        self.training_data = deque(maxlen=1000)  # Store recent data for retraining
        self.min_training_samples = 50  # Minimum samples needed for training

        logger.info(
            f"IsolationForestDetector initialized with contamination={self.contamination}, "
            f"n_estimators={self.n_estimators}, features={self.feature_columns}"
        )

    def _extract_features(
        self,
        volume: float,
        sentiment: float,
        volume_history: List[float] = None,
        sentiment_history: List[float] = None
    ) -> np.ndarray:
        """
        Extract feature vector for anomaly detection.

        Args:
            volume: Current volume value
            sentiment: Current sentiment value
            volume_history: Historical volume values for rate calculation
            sentiment_history: Historical sentiment values for rate calculation

        Returns:
            Feature vector as numpy array
        """
        features = {}

        # Basic features
        features['volume'] = volume
        features['sentiment'] = sentiment

        # Rate of change features (if history available)
        if volume_history and len(volume_history) >= 2:
            volume_change_rate = (volume - volume_history[-1]) / (volume_history[-1] + 1e-10)
            features['volume_change_rate'] = np.clip(volume_change_rate, -10, 10)  # Cap extreme values
        else:
            features['volume_change_rate'] = 0.0

        if sentiment_history and len(sentiment_history) >= 2:
            sentiment_change_rate = (sentiment - sentiment_history[-1]) / (abs(sentiment_history[-1]) + 1e-10)
            features['sentiment_change_rate'] = np.clip(sentiment_change_rate, -5, 5)
        else:
            features['sentiment_change_rate'] = 0.0

        # Interaction feature (volume * sentiment) - captures pump-and-dump patterns
        features['volume_sentiment_product'] = volume * (sentiment + 1)  # Shift sentiment to positive range

        # Return only configured features
        feature_vector = [features[f] for f in self.feature_columns if f in features]

        # Pad with zeros if some features are missing
        while len(feature_vector) < len(self.feature_columns):
            feature_vector.append(0.0)

        return np.array(feature_vector).reshape(1, -1)

    def train(self, historical_data: List[Dict[str, float]]) -> bool:
        """
        Train the Isolation Forest model on historical data.

        Args:
            historical_data: List of dictionaries containing historical data points
                           each with 'volume' and 'sentiment' keys at minimum

        Returns:
            bool: True if training successful, False otherwise
        """
        if len(historical_data) < self.min_training_samples:
            logger.warning(
                f"Insufficient data for training: {len(historical_data)}/{self.min_training_samples}"
            )
            return False

        # Extract features from historical data
        features = []
        for i, point in enumerate(historical_data):
            # Use previous points for rate calculation
            volume_history = [p['volume'] for p in historical_data[max(0, i-5):i]]
            sentiment_history = [p['sentiment'] for p in historical_data[max(0, i-5):i]]

            feature_vec = self._extract_features(
                point['volume'],
                point['sentiment'],
                volume_history,
                sentiment_history
            )
            features.append(feature_vec.flatten())

        X_train = np.array(features)

        # Train the model
        try:
            self.model.fit(X_train)
            self.is_trained = True
            logger.info(f"Isolation Forest trained successfully on {len(historical_data)} samples")
            return True
        except Exception as e:
            logger.error(f"Failed to train Isolation Forest: {e}")
            return False

    def detect_anomaly(
        self,
        volume: float,
        sentiment: float,
        volume_history: List[float] = None,
        sentiment_history: List[float] = None
    ) -> Optional[MultiDimensionalAnomalyResult]:
        """
        Detect anomaly in the current data point.

        Args:
            volume: Current volume
            sentiment: Current sentiment
            volume_history: Historical volumes for context
            sentiment_history: Historical sentiments for context

        Returns:
            MultiDimensionalAnomalyResult if model is trained, None otherwise
        """
        if not self.is_trained:
            logger.debug("Isolation Forest not trained yet, skipping detection")
            return None

        # Extract features
        features = self._extract_features(volume, sentiment, volume_history, sentiment_history)

        # Predict anomaly (-1 for anomaly, 1 for normal)
        prediction = self.model.predict(features)[0]
        anomaly_score = self.model.score_samples(features)[0]  # Lower = more anomalous

        is_anomaly = prediction == -1

        # Calculate severity score (0-1, higher = more severe)
        # Convert anomaly score to severity (anomaly scores are typically negative)
        # Map typical range (-0.5 to 0) to severity (0 to 1)
        normalized_score = np.clip(-anomaly_score * 2, 0, 1)
        severity_score = normalized_score if is_anomaly else 0.0

        if is_anomaly:
            ANOMALIES_DETECTED_TOTAL.labels(metric_name="ml_multi_dimensional").inc()
            logger.info(f"ML anomaly detected! Score: {anomaly_score:.3f}, Severity: {severity_score:.3f}")

        # Create feature value dictionary for result
        feature_values = {
            'volume': volume,
            'sentiment': sentiment,
            'volume_change_rate': float(features[0][2]) if features.shape[1] > 2 else 0.0,
            'sentiment_change_rate': float(features[0][3]) if features.shape[1] > 3 else 0.0
        }

        return MultiDimensionalAnomalyResult(
            is_anomaly=is_anomaly,
            anomaly_score=float(anomaly_score),
            severity_score=severity_score,
            features_used=self.feature_columns,
            feature_values=feature_values,
            timestamp=datetime.utcnow()
        )

    def add_training_point(self, volume: float, sentiment: float):
        """
        Add a data point to the training buffer for future retraining.

        Args:
            volume: Volume value
            sentiment: Sentiment value
        """
        self.training_data.append({
            'volume': volume,
            'sentiment': sentiment,
            'timestamp': datetime.utcnow()
        })

        # Auto-retrain every 200 new points if enough data
        if len(self.training_data) >= 200 and len(self.training_data) % 50 == 0:
            self.train(list(self.training_data))

    def save_model(self, filepath: str):
        """Save the trained model to disk."""
        if self.is_trained:
            joblib.dump(self.model, filepath)
            # Save configuration
            config = {
                'contamination': self.contamination,
                'n_estimators': self.n_estimators,
                'max_samples': self.max_samples,
                'feature_columns': self.feature_columns
            }
            with open(f"{filepath}.config.json", 'w') as f:
                json.dump(config, f)
            logger.info(f"Model saved to {filepath}")

    def load_model(self, filepath: str) -> bool:
        """Load a trained model from disk."""
        if os.path.exists(filepath):
            self.model = joblib.load(filepath)
            self.is_trained = True
            logger.info(f"Model loaded from {filepath}")
            return True
        return False


class AnomalyDetector:
    """
    Statistical anomaly detector using Z-Score methodology to identify outliers
    in time-series data for trade volume and social sentiment metrics.

    Now enhanced with Isolation Forest for multi-dimensional anomaly detection.
    """

    # Default configuration
    DEFAULT_WINDOW_SIZE_HOURS = 24
    DEFAULT_Z_THRESHOLD = 2.5  # Standard deviations from mean
    MIN_DATA_POINTS = 10  # Minimum data points required for reliable statistics
    DEFAULT_USE_ML = True  # Enable ML-based detection by default
    DEFAULT_ML_CONTAMINATION = 0.1  # 10% expected anomalies

    def __init__(
        self,
        window_size_hours: int = None,
        z_threshold: float = None,
        use_ml: bool = None,
        ml_contamination: float = None,
        enable_comparison_mode: bool = False
    ):
        """
        Initialize the anomaly detector.

        Args:
            window_size_hours: Size of rolling window in hours (default: 24)
            z_threshold: Z-score threshold for anomaly detection (default: 2.5)
            use_ml: Enable Isolation Forest for multi-dimensional detection
            ml_contamination: Expected proportion of anomalies for ML model
            enable_comparison_mode: Run both Z-score and ML and compare results
        """
        self.window_size_hours = window_size_hours or self.DEFAULT_WINDOW_SIZE_HOURS
        self.z_threshold = z_threshold or self.DEFAULT_Z_THRESHOLD
        self.use_ml = use_ml if use_ml is not None else self.DEFAULT_USE_ML
        self.enable_comparison_mode = enable_comparison_mode

        # Data storage for rolling windows
        self.volume_data = deque(maxlen=self.window_size_hours * 4)
        self.sentiment_data = deque(maxlen=self.window_size_hours * 4)
        self.timestamp_data = deque(maxlen=self.window_size_hours * 4)

        # Initialize ML detector if enabled
        self.ml_detector = None
        if self.use_ml:
            self.ml_detector = IsolationForestDetector(
                contamination=ml_contamination or self.DEFAULT_ML_CONTAMINATION
            )

        # Historical storage for ML training
        self.historical_points = []

        logger.info(
            f"AnomalyDetector initialized with {self.window_size_hours}h window, "
            f"Z-threshold: {self.z_threshold}, ML-enabled: {self.use_ml}, "
            f"Comparison mode: {self.enable_comparison_mode}"
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
        std = np.std(data_points, ddof=1)

        if std == 0:
            std = 1e-10

        return float(mean), float(std)

    def _calculate_z_score(self, value: float, mean: float, std: float) -> float:
        """Calculate Z-score for a value given mean and standard deviation."""
        return (value - mean) / std

    def _calculate_severity_score(self, z_score: float) -> float:
        """
        Convert Z-score to severity score (0.0-1.0).
        Higher absolute Z-scores result in higher severity.
        """
        abs_z = abs(z_score)

        if abs_z <= self.z_threshold:
            return 0.0
        elif abs_z <= self.z_threshold * 2:
            return (abs_z - self.z_threshold) / self.z_threshold
        else:
            return 1.0

    def _clean_old_data(self, current_timestamp: datetime):
        """Remove data points older than the window size."""
        cutoff_time = current_timestamp - timedelta(hours=self.window_size_hours)

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
        """Add a new data point to the rolling window."""
        if timestamp is None:
            timestamp = datetime.utcnow()

        self._clean_old_data(timestamp)

        self.timestamp_data.append(timestamp)
        self.volume_data.append(float(volume))
        self.sentiment_data.append(float(sentiment_score))

        # Store for ML training
        self.historical_points.append({
            'volume': float(volume),
            'sentiment': float(sentiment_score),
            'timestamp': timestamp
        })

        # Keep only last 1000 points
        if len(self.historical_points) > 1000:
            self.historical_points = self.historical_points[-1000:]

        # Train ML model if we have enough data and it's not trained yet
        if self.ml_detector and not self.ml_detector.is_trained:
            if len(self.historical_points) >= self.ml_detector.min_training_samples:
                self.ml_detector.train(self.historical_points)

        # Add to ML training buffer
        if self.ml_detector:
            self.ml_detector.add_training_point(float(volume), float(sentiment_score))

        logger.debug(f"Added data point: volume={volume}, sentiment={sentiment_score}")

    def detect_volume_anomaly(
        self, current_volume: float, timestamp: datetime = None
    ) -> AnomalyResult:
        """Detect anomalies in trade volume data."""
        if timestamp is None:
            timestamp = datetime.utcnow()

        try:
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

            if is_anomaly:
                ANOMALIES_DETECTED_TOTAL.labels(metric_name="volume").inc()

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
        """Detect anomalies in social sentiment data."""
        if timestamp is None:
            timestamp = datetime.utcnow()

        try:
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

            if is_anomaly:
                ANOMALIES_DETECTED_TOTAL.labels(metric_name="sentiment").inc()

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

    def detect_multi_dimensional_anomaly(
        self, volume: float, sentiment: float, timestamp: datetime = None
    ) -> Optional[MultiDimensionalAnomalyResult]:
        """
        Detect anomalies using Isolation Forest (multi-dimensional).

        Returns:
            MultiDimensionalAnomalyResult or None if ML not enabled/trained
        """
        if not self.ml_detector or not self.ml_detector.is_trained:
            return None

        volume_history = list(self.volume_data)[-10:] if self.volume_data else []
        sentiment_history = list(self.sentiment_data)[-10:] if self.sentiment_data else []

        return self.ml_detector.detect_anomaly(
            volume, sentiment, volume_history, sentiment_history
        )

    def detect_anomalies(
        self, volume: float, sentiment_score: float, timestamp: datetime = None
    ) -> Dict[str, Any]:
        """
        Detect anomalies for both volume and sentiment simultaneously.

        Now enhanced with ML-based multi-dimensional detection.

        Args:
            volume: Current trade volume
            sentiment_score: Current sentiment score
            timestamp: Timestamp of current data point

        Returns:
            Dictionary containing all anomaly detection results
        """
        if timestamp is None:
            timestamp = datetime.utcnow()

        # Add data point first
        self.add_data_point(volume, sentiment_score, timestamp)

        # Detect univariate anomalies
        volume_result = self.detect_volume_anomaly(volume, timestamp)
        sentiment_result = self.detect_sentiment_anomaly(sentiment_score, timestamp)

        results = {
            'volume_anomaly': volume_result,
            'sentiment_anomaly': sentiment_result,
            'timestamp': timestamp,
            'ml_anomaly': None
        }

        # Detect multi-dimensional anomaly if ML is enabled
        if self.use_ml:
            ml_result = self.detect_multi_dimensional_anomaly(volume, sentiment_score, timestamp)
            results['ml_anomaly'] = ml_result

            # Enhanced detection: Combine signals for better accuracy
            if ml_result and ml_result.is_anomaly:
                # Log when ML detects something Z-score might miss
                if not (volume_result.is_anomaly or sentiment_result.is_anomaly):
                    logger.warning(
                        f"ML detected multi-dimensional anomaly missed by univariate methods! "
                        f"Volume: {volume:.2f}, Sentiment: {sentiment_score:.3f}, "
                        f"ML Score: {ml_result.anomaly_score:.3f}"
                    )

                # Boost severity if multiple methods agree
                if volume_result.is_anomaly or sentiment_result.is_anomaly:
                    combined_severity = max(
                        volume_result.severity_score,
                        sentiment_result.severity_score,
                        ml_result.severity_score
                    )
                    results['combined_severity'] = combined_severity
                    results['is_anomaly_consensus'] = True

        # Comparison mode: Run both and generate comparison report
        if self.enable_comparison_mode and self.ml_detector and self.ml_detector.is_trained:
            results['comparison'] = self._compare_detection_methods(
                volume_result, sentiment_result, ml_result
            )

        return results

    def _compare_detection_methods(
        self,
        volume_result: AnomalyResult,
        sentiment_result: AnomalyResult,
        ml_result: Optional[MultiDimensionalAnomalyResult]
    ) -> Dict[str, Any]:
        """
        Compare performance between Z-score and Isolation Forest methods.
        """
        z_score_anomaly = volume_result.is_anomaly or sentiment_result.is_anomaly
        ml_anomaly = ml_result.is_anomaly if ml_result else False

        comparison = {
            'z_score_detected': z_score_anomaly,
            'ml_detected': ml_anomaly,
            'agreement': z_score_anomaly == ml_anomaly,
            'z_score_severity': max(volume_result.severity_score, sentiment_result.severity_score),
            'ml_severity': ml_result.severity_score if ml_result else 0.0,
        }

        # Analysis of detection differences
        if z_score_anomaly and not ml_anomaly:
            comparison['analysis'] = "Z-score detected anomaly but ML didn't - possible false positive from simple outlier"
        elif not z_score_anomaly and ml_anomaly:
            comparison['analysis'] = "ML detected complex multi-dimensional anomaly missed by univariate Z-score"
        elif z_score_anomaly and ml_anomaly:
            comparison['analysis'] = "Both methods agree - high confidence anomaly detected"
        else:
            comparison['analysis'] = "No anomaly detected by either method"

        return comparison

    def get_window_stats(self) -> Dict[str, Any]:
        """Get current window statistics for monitoring/debugging."""
        volume_list = list(self.volume_data)
        sentiment_list = list(self.sentiment_data)

        stats = {
            "window_size_hours": self.window_size_hours,
            "z_threshold": self.z_threshold,
            "data_points_count": len(self.timestamp_data),
            "use_ml": self.use_ml,
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

        # Add ML stats if available
        if self.ml_detector:
            stats["ml"] = {
                "is_trained": self.ml_detector.is_trained,
                "contamination": self.ml_detector.contamination,
                "training_samples": len(self.ml_detector.training_data),
                "features": self.ml_detector.feature_columns
            }

        return stats

    def reset(self):
        """Reset the detector by clearing all stored data."""
        self.volume_data.clear()
        self.sentiment_data.clear()
        self.timestamp_data.clear()
        self.historical_points.clear()
        if self.ml_detector:
            self.ml_detector = IsolationForestDetector(
                contamination=self.ml_detector.contamination
            )
        logger.info("AnomalyDetector reset completed")

    def save_ml_model(self, filepath: str):
        """Save the ML model to disk."""
        if self.ml_detector:
            self.ml_detector.save_model(filepath)

    def load_ml_model(self, filepath: str) -> bool:
        """Load a pre-trained ML model."""
        if self.ml_detector:
            return self.ml_detector.load_model(filepath)
        return False


# Convenience functions for easy usage
def create_detector(
    window_size_hours: int = 24,
    z_threshold: float = 2.5,
    use_ml: bool = True,
    ml_contamination: float = 0.1,
    enable_comparison_mode: bool = False
) -> AnomalyDetector:
    """
    Factory function to create an AnomalyDetector instance.

    Args:
        window_size_hours: Size of rolling window in hours
        z_threshold: Z-score threshold for anomaly detection
        use_ml: Enable ML-based multi-dimensional detection
        ml_contamination: Expected proportion of anomalies (0.0-0.5)
        enable_comparison_mode: Compare Z-score vs ML performance

    Returns:
        Configured AnomalyDetector instance
    """
    return AnomalyDetector(
        window_size_hours=window_size_hours,
        z_threshold=z_threshold,
        use_ml=use_ml,
        ml_contamination=ml_contamination,
        enable_comparison_mode=enable_comparison_mode
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

    detector = AnomalyDetector(z_threshold=z_threshold, use_ml=False)

    dummy_timestamp = datetime.utcnow()
    for value in baseline_values:
        detector.add_data_point(value, 0.0, dummy_timestamp)

    result = detector.detect_volume_anomaly(current_value, dummy_timestamp)
    return result.is_anomaly, result.severity_score
