#!/usr/bin/env python3
"""
Demo script to compare Z-score vs Isolation Forest for anomaly detection.
Demonstrates detection of pump-and-dump patterns.
"""

from src.anomaly_detector import create_detector, AnomalyDetector
from src.config.anomaly_config import AnomalyDetectionConfig
import numpy as np
from datetime import datetime, timedelta
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def generate_pump_and_dump_pattern():
    """Generate synthetic data simulating a pump-and-dump pattern."""
    timestamps = []
    volumes = []
    sentiments = []

    # Normal period (first 50 points)
    for i in range(50):
        timestamps.append(datetime.utcnow() + timedelta(hours=i))
        volumes.append(np.random.normal(100, 10))
        sentiments.append(np.random.normal(0, 0.1))

    # Pump phase (next 20 points - rapid increase)
    for i in range(20):
        timestamps.append(datetime.utcnow() + timedelta(hours=50 + i))
        # Volume spikes
        volume_multiplier = 1 + (i / 20) * 20  # Up to 20x volume
        volumes.append(100 * volume_multiplier + np.random.normal(0, 20))
        # Sentiment becomes very positive
        sentiments.append(0.5 + (i / 20) * 0.5 + np.random.normal(0, 0.05))

    # Peak (next 5 points)
    for i in range(5):
        timestamps.append(datetime.utcnow() + timedelta(hours=70 + i))
        volumes.append(2500 + np.random.normal(0, 100))
        sentiments.append(0.95 + np.random.normal(0, 0.02))

    # Dump phase (next 25 points - rapid decrease)
    for i in range(25):
        timestamps.append(datetime.utcnow() + timedelta(hours=75 + i))
        # Volume crashes
        volume_multiplier = max(1, 20 - (i / 25) * 19)
        volumes.append(100 * volume_multiplier + np.random.normal(0, 15))
        # Sentiment crashes
        sentiments.append(max(-0.5, 0.95 - (i / 25) * 1.5) + np.random.normal(0, 0.05))

    return timestamps, volumes, sentiments


def demo_basic_usage():
    """Demonstrate basic usage of the enhanced anomaly detector."""
    logger.info("=" * 60)
    logger.info("Demo 1: Basic Usage with ML Detection")
    logger.info("=" * 60)

    # Create detector with ML enabled
    detector = create_detector(
        window_size_hours=24,
        z_threshold=2.5,
        use_ml=True,
        ml_contamination=0.1,
        enable_comparison_mode=True
    )

    # Generate pump-and-dump pattern
    timestamps, volumes, sentiments = generate_pump_and_dump_pattern()

    # Process data points
    anomalies_found = []

    for i, (ts, vol, sent) in enumerate(zip(timestamps, volumes, sentiments)):
        results = detector.detect_anomalies(vol, sent, ts)

        if results['volume_anomaly'].is_anomaly or results['sentiment_anomaly'].is_anomaly:
            anomaly_info = {
                'index': i,
                'timestamp': ts,
                'volume': vol,
                'sentiment': sent,
                'volume_anomaly': results['volume_anomaly'].is_anomaly,
                'sentiment_anomaly': results['sentiment_anomaly'].is_anomaly,
                'ml_anomaly': results['ml_anomaly'].is_anomaly if results['ml_anomaly'] else False,
                'ml_score': results['ml_anomaly'].anomaly_score if results['ml_anomaly'] else None
            }
            anomalies_found.append(anomaly_info)

            if results.get('comparison'):
                logger.info(f"Point {i}: {results['comparison']['analysis']}")

    logger.info(f"\nTotal anomalies detected: {len(anomalies_found)}")

    # Print ML detection stats
    ml_detections = [a for a in anomalies_found if a['ml_anomaly']]
    logger.info(f"ML detected {len(ml_detections)} anomalies")

    # Show window statistics
    stats = detector.get_window_stats()
    logger.info(f"\nDetector Statistics: {stats}")


def demo_configuration():
    """Demonstrate different configuration options."""
    logger.info("\n" + "=" * 60)
    logger.info("Demo 2: Different Configurations")
    logger.info("=" * 60)

    # Configuration 1: Conservative Z-score only
    detector_conservative = create_detector(
        z_threshold=3.0,  # Higher threshold = fewer detections
        use_ml=False
    )
    logger.info("Created conservative detector (Z-score only, threshold=3.0)")

    # Configuration 2: Aggressive ML-based
    detector_aggressive = create_detector(
        z_threshold=2.0,  # Lower threshold = more detections
        use_ml=True,
        ml_contamination=0.15  # Expect more anomalies
    )
    logger.info("Created aggressive detector (ML + low Z-threshold)")

    # Configuration 3: From config file
    config = AnomalyDetectionConfig.from_env()
    detector_from_config = AnomalyDetector(
        window_size_hours=config.zscore.window_size_hours,
        z_threshold=config.zscore.z_threshold,
        use_ml=config.isolation_forest.enabled,
        ml_contamination=config.isolation_forest.contamination,
        enable_comparison_mode=config.enable_comparison_mode
    )
    logger.info(f"Created detector from config: {config}")


def demo_model_persistence():
    """Demonstrate saving and loading ML models."""
    logger.info("\n" + "=" * 60)
    logger.info("Demo 3: Model Persistence")
    logger.info("=" * 60)

    # Train a detector
    detector1 = create_detector(use_ml=True)

    # Add some training data
    for i in range(100):
        volume = np.random.normal(100, 10)
        sentiment = np.random.normal(0, 0.1)
        detector1.add_data_point(volume, sentiment)

    # Train the model
    if detector1.ml_detector:
        detector1.ml_detector.train(detector1.historical_points)
        logger.info("Model trained")

        # Save the model
        detector1.save_ml_model("models/test_anomaly_model.pkl")
        logger.info("Model saved to models/test_anomaly_model.pkl")

    # Create new detector and load the model
    detector2 = create_detector(use_ml=True)
    if detector2.load_ml_model("models/test_anomaly_model.pkl"):
        logger.info("Model loaded successfully into new detector")

        # Test loaded model
        test_volume, test_sentiment = 500, 0.8
        result = detector2.detect_multi_dimensional_anomaly(test_volume, test_sentiment)
        if result:
            logger.info(f"Loaded model prediction: Anomaly={result.is_anomaly}, Score={result.anomaly_score:.3f}")


def demo_pump_and_dump_detection():
    """Specifically demonstrate detection of pump-and-dump patterns."""
    logger.info("\n" + "=" * 60)
    logger.info("Demo 4: Pump-and-Dump Pattern Detection")
    logger.info("=" * 60)

    # Generate a classic pump-and-dump pattern
    timestamps, volumes, sentiments = generate_pump_and_dump_pattern()

    # Create detector in comparison mode
    detector = create_detector(
        window_size_hours=12,  # Shorter window for faster adaptation
        z_threshold=2.5,
        use_ml=True,
        ml_contamination=0.1,
        enable_comparison_mode=True
    )

    # Track detection performance
    pump_phase_start = 50
    dump_phase_start = 75

    pump_phase_detections = []
    dump_phase_detections = []

    for i, (ts, vol, sent) in enumerate(zip(timestamps, volumes, sentiments)):
        results = detector.detect_anomalies(vol, sent, ts)

        if i >= pump_phase_start and i < dump_phase_start:
            # Pump phase
            if results['ml_anomaly'] and results['ml_anomaly'].is_anomaly:
                pump_phase_detections.append({
                    'index': i,
                    'volume': vol,
                    'sentiment': sent,
                    'ml_score': results['ml_anomaly'].anomaly_score
                })

        elif i >= dump_phase_start:
            # Dump phase
            if results['ml_anomaly'] and results['ml_anomaly'].is_anomaly:
                dump_phase_detections.append({
                    'index': i,
                    'volume': vol,
                    'sentiment': sent,
                    'ml_score': results['ml_anomaly'].anomaly_score
                })

    logger.info(f"Pump phase detections: {len(pump_phase_detections)}")
    logger.info(f"Dump phase detections: {len(dump_phase_detections)}")

    if pump_phase_detections:
        first_pump = pump_phase_detections[0]
        logger.info(f"First pump detection at index {first_pump['index']}: "
                   f"Volume={first_pump['volume']:.1f}, Sentiment={first_pump['sentiment']:.2f}")

    # Show multi-dimensional detection example
    logger.info("\nExample of multi-dimensional anomaly detection:")
    example_idx = 65  # During pump phase
    example_vol = volumes[example_idx]
    example_sent = sentiments[example_idx]

    results = detector.detect_anomalies(example_vol, example_sent, timestamps[example_idx])
    if results['ml_anomaly']:
        ml = results['ml_anomaly']
        logger.info(f"Point {example_idx}: Volume={example_vol:.1f}, Sentiment={example_sent:.2f}")
        logger.info(f"  ML Detection: {ml.is_anomaly}")
        logger.info(f"  Anomaly Score: {ml.anomaly_score:.3f}")
        logger.info(f"  Severity: {ml.severity_score:.3f}")
        logger.info(f"  Features used: {ml.features_used}")


def demo_performance_comparison():
    """Compare performance metrics between Z-score and ML methods."""
    logger.info("\n" + "=" * 60)
    logger.info("Demo 5: Performance Comparison")
    logger.info("=" * 60)

    # Generate test data with known anomalies
    np.random.seed(42)

    # Normal data (80% of points)
    normal_data = [(np.random.normal(100, 10), np.random.normal(0, 0.1))
                   for _ in range(200)]

    # Anomalous data (20% of points) - pump and dump patterns
    anomalous_data = []
    for _ in range(50):
        # High volume + high sentiment (pump)
        anomalous_data.append((np.random.normal(500, 50), np.random.normal(0.8, 0.1)))

    # Mixed data
    test_data = normal_data + anomalous_data
    np.random.shuffle(test_data)

    # Test with Z-score only
    detector_zscore = create_detector(use_ml=False, z_threshold=2.5)
    zscore_detections = []

    for vol, sent in test_data[:150]:  # First 150 points for baseline
        detector_zscore.add_data_point(vol, sent)

    for vol, sent in test_data[150:]:
        results = detector_zscore.detect_anomalies(vol, sent)
        if results['volume_anomaly'].is_anomaly or results['sentiment_anomaly'].is_anomaly:
            zscore_detections.append((vol, sent))

    # Test with ML (both methods)
    detector_ml = create_detector(use_ml=True, ml_contamination=0.15, enable_comparison_mode=True)
    ml_detections = []
    ml_specific_detections = []

    for vol, sent in test_data[:150]:
        detector_ml.add_data_point(vol, sent)

    # Train ML model
    if detector_ml.ml_detector:
        detector_ml.ml_detector.train(detector_ml.historical_points)

    for vol, sent in test_data[150:]:
        results = detector_ml.detect_anomalies(vol, sent)

        # Z-score detection
        zscore_anomaly = results['volume_anomaly'].is_anomaly or results['sentiment_anomaly'].is_anomaly

        # ML detection
        ml_anomaly = results['ml_anomaly'].is_anomaly if results['ml_anomaly'] else False

        if ml_anomaly:
            ml_detections.append((vol, sent))
            if not zscore_anomaly:
                ml_specific_detections.append((vol, sent))

    logger.info(f"Z-score only: Detected {len(zscore_detections)} anomalies")
    logger.info(f"ML-enhanced: Detected {len(ml_detections)} anomalies")
    logger.info(f"ML-specific detections (missed by Z-score): {len(ml_specific_detections)}")

    # Show example of ML-specific detection
    if ml_specific_detections:
        vol, sent = ml_specific_detections[0]
        logger.info(f"\nExample of anomaly only ML could detect:")
        logger.info(f"  Volume: {vol:.1f}, Sentiment: {sent:.2f}")
        logger.info(f"  This pattern (moderate volume spike with positive sentiment) "
                   f"is a classic pump indicator that ML identifies as multi-dimensional anomaly")


if __name__ == "__main__":
    # Create models directory if it doesn't exist
    import os
    os.makedirs("models", exist_ok=True)

    # Run demos
    demo_basic_usage()
    demo_configuration()
    demo_model_persistence()
    demo_pump_and_dump_detection()
    demo_performance_comparison()

    logger.info("\n" + "=" * 60)
    logger.info("All demos completed successfully!")
    logger.info("=" * 60)
