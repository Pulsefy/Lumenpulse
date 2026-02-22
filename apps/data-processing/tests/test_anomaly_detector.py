"""
Unit tests for AnomalyDetector class.
Tests statistical anomaly detection for trade volume and social sentiment.
"""

import unittest
import math
from datetime import datetime, timedelta
from src.anomaly_detector import AnomalyDetector, AnomalyResult, detect_spike


class TestAnomalyDetector(unittest.TestCase):
    """Test cases for AnomalyDetector functionality"""

    def setUp(self):
        """Set up test environment"""
        self.detector = AnomalyDetector(window_size_hours=24, z_threshold=2.5)

    def test_initialization(self):
        """Test detector initialization with default parameters"""
        detector = AnomalyDetector()
        self.assertEqual(detector.window_size_hours, 24)
        self.assertEqual(detector.z_threshold, 2.5)
        self.assertEqual(len(detector.volume_data), 0)
        self.assertEqual(len(detector.sentiment_data), 0)

    def test_custom_parameters(self):
        """Test detector initialization with custom parameters"""
        detector = AnomalyDetector(window_size_hours=12, z_threshold=3.0)
        self.assertEqual(detector.window_size_hours, 12)
        self.assertEqual(detector.z_threshold, 3.0)

    def test_add_data_point(self):
        """Test adding data points to the detector"""
        timestamp = datetime.utcnow()

        # Add a data point
        self.detector.add_data_point(
            volume=1000.0, sentiment_score=0.5, timestamp=timestamp
        )

        # Check that data was stored
        self.assertEqual(len(self.detector.volume_data), 1)
        self.assertEqual(len(self.detector.sentiment_data), 1)
        self.assertEqual(len(self.detector.timestamp_data), 1)

        # Check values
        self.assertEqual(self.detector.volume_data[0], 1000.0)
        self.assertEqual(self.detector.sentiment_data[0], 0.5)

    def test_rolling_window_cleanup(self):
        """Test that old data is automatically cleaned up"""
        base_time = datetime.utcnow()

        # Add data points over 48 hours
        for i in range(48 * 4):  # 48 hours with 15-minute intervals
            timestamp = base_time - timedelta(hours=48) + timedelta(minutes=i * 15)
            volume = 1000.0 + (i * 10)  # Gradually increasing volume
            sentiment = 0.1 + (i * 0.01)  # Gradually increasing sentiment

            self.detector.add_data_point(volume, sentiment, timestamp)

        # Check that window is maintained (should be ~96 points for 24h at 15-min intervals)
        self.assertLessEqual(len(self.detector.volume_data), 96)
        self.assertLessEqual(len(self.detector.sentiment_data), 96)

    def test_statistics_calculation(self):
        """Test statistical calculations"""
        # Add normal data points
        base_time = datetime.utcnow()
        for i in range(20):
            timestamp = base_time - timedelta(minutes=i * 15)
            self.detector.add_data_point(
                volume=1000.0 + (i * 10),
                sentiment_score=0.1 + (i * 0.01),
                timestamp=timestamp,
            )

        # Test statistics
        volume_list = list(self.detector.volume_data)
        mean, std = self.detector._calculate_statistics(volume_list)

        self.assertGreater(mean, 1000.0)  # Mean should be greater than base value
        self.assertGreater(std, 0.0)  # Std should be positive

    def test_zero_standard_deviation_handling(self):
        """Test handling of zero standard deviation (identical values)"""
        # Add identical values
        base_time = datetime.utcnow()
        for i in range(15):
            timestamp = base_time - timedelta(minutes=i * 15)
            self.detector.add_data_point(
                volume=1000.0, sentiment_score=0.5, timestamp=timestamp
            )

        volume_list = list(self.detector.volume_data)
        mean, std = self.detector._calculate_statistics(volume_list)

        # Should handle zero std without crashing
        self.assertEqual(mean, 1000.0)
        self.assertGreater(std, 0)  # Should be small epsilon, not zero

    def test_insufficient_data_handling(self):
        """Test handling when insufficient data is available"""
        # Add minimal data
        base_time = datetime.utcnow()
        for i in range(5):  # Less than minimum required (10)
            timestamp = base_time - timedelta(minutes=i * 15)
            self.detector.add_data_point(
                volume=1000.0, sentiment_score=0.5, timestamp=timestamp
            )

        # Should not crash and return appropriate result
        result = self.detector.detect_volume_anomaly(1500.0)
        self.assertFalse(result.is_anomaly)
        self.assertEqual(result.severity_score, 0.0)

    def test_volume_anomaly_detection_normal(self):
        """Test normal volume detection (no anomaly)"""
        # Create baseline with normal variation
        base_time = datetime.utcnow()
        for i in range(30):
            timestamp = base_time - timedelta(minutes=i * 15)
            # Normal variation around 1000 with some noise
            volume = 1000.0 + (i % 10) * 50 - 250  # Variation between 750-1250
            sentiment = 0.1 + (i % 5) * 0.1 - 0.25  # Variation around 0.1
            self.detector.add_data_point(volume, sentiment, timestamp)

        # Test normal value
        result = self.detector.detect_volume_anomaly(1050.0)
        self.assertFalse(result.is_anomaly)
        self.assertEqual(result.severity_score, 0.0)

    def test_volume_anomaly_detection_spike(self):
        """Test detection of volume spike (500% increase)"""
        # Create baseline data
        base_time = datetime.utcnow()
        base_volume = 1000.0

        # Add 30 normal data points
        for i in range(30):
            timestamp = base_time - timedelta(minutes=(30 - i) * 15)
            volume = base_volume + (i % 10) * 50 - 250  # Normal variation
            sentiment = 0.1
            self.detector.add_data_point(volume, sentiment, timestamp)

        # Test 500% spike (5x increase)
        spike_volume = base_volume * 5  # 5000.0
        result = self.detector.detect_volume_anomaly(spike_volume)

        # Should detect as anomaly with high severity
        self.assertTrue(result.is_anomaly)
        self.assertGreater(result.severity_score, 0.8)  # High severity for 500% spike
        self.assertGreater(abs(result.z_score), self.detector.z_threshold)
        self.assertEqual(result.current_value, spike_volume)

    def test_sentiment_anomaly_detection_extreme(self):
        """Test detection of extreme sentiment anomaly"""
        # Create baseline sentiment data around neutral (0.0)
        base_time = datetime.utcnow()
        for i in range(30):
            timestamp = base_time - timedelta(minutes=(30 - i) * 15)
            volume = 1000.0
            sentiment = (i % 3) * 0.2 - 0.2  # Variation between -0.2 and 0.2
            self.detector.add_data_point(volume, sentiment, timestamp)

        # Test extreme positive sentiment (+0.9)
        extreme_sentiment = 0.9
        result = self.detector.detect_sentiment_anomaly(extreme_sentiment)

        # Should detect as anomaly
        self.assertTrue(result.is_anomaly)
        self.assertGreater(result.severity_score, 0.5)
        self.assertEqual(result.current_value, extreme_sentiment)

    def test_severity_scoring(self):
        """Test severity score calculation"""
        # Test severity scores for different z-scores
        test_cases = [
            (0.0, 0.0),  # No deviation
            (1.0, 0.0),  # Below threshold
            (2.5, 0.0),  # At threshold
            (3.0, 0.2),  # Above threshold
            (5.0, 1.0),  # High deviation
            (-3.0, 0.2),  # Negative deviation
            (-5.0, 1.0),  # High negative deviation
        ]

        for z_score, expected_severity in test_cases:
            severity = self.detector._calculate_severity_score(z_score)
            self.assertAlmostEqual(
                severity,
                expected_severity,
                places=1,
                msg=f"Z-score {z_score} should give severity ~{expected_severity}",
            )

    def test_detect_anomalies_combined(self):
        """Test simultaneous detection of volume and sentiment anomalies"""
        # Create baseline
        base_time = datetime.utcnow()
        for i in range(25):
            timestamp = base_time - timedelta(minutes=(25 - i) * 15)
            volume = 1000.0 + (i % 5) * 100  # Normal variation
            sentiment = 0.0 + (i % 3) * 0.1  # Normal variation
            self.detector.add_data_point(volume, sentiment, timestamp)

        # Test with spike values
        spike_volume = 5000.0  # 500% increase
        extreme_sentiment = 0.8  # Extreme positive

        results = self.detector.detect_anomalies(spike_volume, extreme_sentiment)

        # Should return two results
        self.assertEqual(len(results), 2)

        # Both should be detected as anomalies
        volume_result = results[0]
        sentiment_result = results[1]

        self.assertEqual(volume_result.metric_name, "volume")
        self.assertEqual(sentiment_result.metric_name, "sentiment")
        self.assertTrue(volume_result.is_anomaly)
        self.assertTrue(sentiment_result.is_anomaly)

    def test_five_sigma_outlier_detection(self):
        """
        Test that a synthetic time series with one point exactly 5σ away from
        the mean is correctly identified as an anomaly with maximum severity.

        Issue #370 requirement: synthetic time series where one point is 5σ away.
        """
        # Build a controlled baseline: mean=100, std≈10
        # Using 20 evenly spaced values so sample std is predictable
        base_time = datetime.utcnow()
        baseline_mean = 100.0
        baseline_std = 10.0

        # 20 points symmetrically distributed around the mean
        # values: 81, 83, 85, ..., 119 (step=2) -> mean=100, std≈12
        # Use a simpler set: 10 points below, 10 points above
        baseline_values = [baseline_mean + (i - 10) * baseline_std / 10 for i in range(20)]
        # That gives: 0, 10, 20 ... wait, let me be more precise
        # We want ~20 points where mean≈100 and std≈10
        baseline_values = [90, 91, 92, 93, 94, 95, 96, 97, 98, 99,
                           101, 102, 103, 104, 105, 106, 107, 108, 109, 110]

        for i, vol in enumerate(baseline_values):
            ts = base_time - timedelta(minutes=(len(baseline_values) - i) * 15)
            self.detector.add_data_point(volume=vol, sentiment_score=0.0, timestamp=ts)

        # Calculate the actual mean and std of what we fed in
        import numpy as np
        actual_mean = float(np.mean(baseline_values))
        actual_std = float(np.std(baseline_values, ddof=1))

        # Construct a value exactly 5σ above the mean
        five_sigma_value = actual_mean + 5 * actual_std

        # Detect anomaly
        result = self.detector.detect_volume_anomaly(five_sigma_value)

        # Must be flagged as anomaly
        self.assertTrue(
            result.is_anomaly,
            f"A 5σ outlier ({five_sigma_value:.2f}) must be detected as an anomaly"
        )
        # Z-score should be 5σ within floating-point tolerance
        self.assertTrue(
            math.isclose(abs(result.z_score), 5.0, rel_tol=1e-12, abs_tol=1e-12),
            f"Z-score should be ~5.0, got {result.z_score:.16f}",
        )
        # Maximum severity (1.0) since 5σ >> 2*threshold (2*2.5=5.0)
        self.assertAlmostEqual(
            result.severity_score,
            1.0,
            places=12,
            msg=f"Severity should be 1.0 for a 5σ outlier, got {result.severity_score}",
        )
        # Sanity check: the reported baseline stats match what we fed in
        self.assertAlmostEqual(result.baseline_mean, actual_mean, places=5)
        self.assertAlmostEqual(result.baseline_std, actual_std, places=5)

    def test_reset_functionality(self):
        """Test detector reset functionality"""
        # Add some data
        base_time = datetime.utcnow()
        for i in range(15):
            timestamp = base_time - timedelta(minutes=i * 15)
            self.detector.add_data_point(1000.0, 0.5, timestamp)

        self.assertGreater(len(self.detector.volume_data), 0)

        # Reset detector
        self.detector.reset()

        # Should be empty
        self.assertEqual(len(self.detector.volume_data), 0)
        self.assertEqual(len(self.detector.sentiment_data), 0)
        self.assertEqual(len(self.detector.timestamp_data), 0)

    def test_window_stats(self):
        """Test window statistics reporting"""
        # Add some data
        base_time = datetime.utcnow()
        for i in range(20):
            timestamp = base_time - timedelta(minutes=i * 15)
            self.detector.add_data_point(1000.0 + i * 50, 0.1 + i * 0.05, timestamp)

        stats = self.detector.get_window_stats()

        # Check structure
        self.assertIn("window_size_hours", stats)
        self.assertIn("data_points_count", stats)
        self.assertIn("volume_stats", stats)
        self.assertIn("sentiment_stats", stats)

        # Check values
        self.assertEqual(stats["window_size_hours"], 24)
        self.assertEqual(stats["data_points_count"], 20)
        self.assertGreater(stats["volume_stats"]["mean"], 1000.0)
        self.assertGreater(stats["sentiment_stats"]["mean"], 0.1)


class TestSpikeDetectionFunction(unittest.TestCase):
    """Test the standalone spike detection function"""

    def test_simple_spike_detection(self):
        """Test basic spike detection functionality"""
        # Normal baseline data
        baseline = [100, 105, 95, 110, 90, 102, 98, 107, 93, 101, 99, 103]

        # Test normal value
        is_anomaly, severity = detect_spike(105, baseline)
        self.assertFalse(is_anomaly)
        self.assertEqual(severity, 0.0)

        # Test spike value (500% of average)
        spike_value = 500  # Much higher than baseline average (~100)
        is_anomaly, severity = detect_spike(spike_value, baseline)
        self.assertTrue(is_anomaly)
        self.assertGreater(severity, 0.8)

    def test_insufficient_baseline_data(self):
        """Test handling of insufficient baseline data"""
        # Very small baseline
        baseline = [100, 105]

        # Should not crash and return no anomaly
        is_anomaly, severity = detect_spike(200, baseline)
        self.assertFalse(is_anomaly)
        self.assertEqual(severity, 0.0)


if __name__ == "__main__":
    unittest.main()
