"""
Unit tests for Round Anomaly Detector (#874)
Tests detection of suspicious allocation patterns in quadratic funding rounds.
"""

import pytest
from datetime import datetime, timedelta
from src.round_anomaly_detector import (
    RoundAnomalyDetector,
    RoundMetrics,
    RoundAnomalySignal,
    AnomalyType,
    create_detector,
)


class TestRoundAnomalyDetector:
    """Test suite for RoundAnomalyDetector"""

    def test_detector_initialization_defaults(self):
        """Test detector initialization with default thresholds"""
        detector = RoundAnomalyDetector()
        assert detector.concentration_threshold == 0.7
        assert detector.gini_threshold == 0.6
        assert detector.single_contribution_threshold == 0.5
        assert detector.min_contributors_per_project == 3
        assert detector.is_testnet is False

    def test_detector_initialization_testnet(self):
        """Test detector initialization with testnet thresholds"""
        detector = RoundAnomalyDetector(is_testnet=True)
        # Testnet thresholds should be more lenient (higher)
        assert detector.concentration_threshold == 0.84  # 0.7 * 1.2
        assert detector.gini_threshold == 0.72  # 0.6 * 1.2
        assert detector.single_contribution_threshold == 0.6  # 0.5 * 1.2
        assert detector.min_contributors_per_project == 2  # 3 - 1
        assert detector.is_testnet is True

    def test_detector_custom_thresholds(self):
        """Test detector initialization with custom thresholds"""
        detector = RoundAnomalyDetector(
            concentration_threshold=0.8,
            gini_threshold=0.7,
            single_contribution_threshold=0.6,
        )
        assert detector.concentration_threshold == 0.8
        assert detector.gini_threshold == 0.7
        assert detector.single_contribution_threshold == 0.6

    def test_concentration_risk_detection(self):
        """Test detection of concentration risk"""
        detector = RoundAnomalyDetector(concentration_threshold=0.7)
        
        # Create metrics with high concentration (top 10% control 80%)
        metrics = RoundMetrics(
            round_id=1,
            total_pool=10000.0,
            total_contributions=5000.0,
            unique_contributors=10,
            unique_projects=5,
            contributor_distribution={
                "addr1": 4000.0,  # 80% from one address
                "addr2": 500.0,
                "addr3": 200.0,
                "addr4": 150.0,
                "addr5": 100.0,
                "addr6": 50.0,
            },
            project_contributions={1: 3000.0, 2: 2000.0},
            project_contributor_counts={1: 5, 2: 5},
        )
        
        signal = detector.detect_concentration_risk(metrics)
        
        assert signal is not None
        assert signal.anomaly_type == AnomalyType.CONCENTRATION_RISK
        assert signal.severity_score > 0
        assert signal.round_id == 1
        assert "concentration" in signal.detection_rationale.lower()

    def test_no_concentration_risk_normal_distribution(self):
        """Test that normal distribution doesn't trigger concentration risk"""
        detector = RoundAnomalyDetector(concentration_threshold=0.7)
        
        # Create metrics with normal distribution
        metrics = RoundMetrics(
            round_id=1,
            total_pool=10000.0,
            total_contributions=5000.0,
            unique_contributors=10,
            unique_projects=5,
            contributor_distribution={
                f"addr{i}": 500.0 for i in range(10)  # Even distribution
            },
            project_contributions={1: 2500.0, 2: 2500.0},
            project_contributor_counts={1: 5, 2: 5},
        )
        
        signal = detector.detect_concentration_risk(metrics)
        
        assert signal is None

    def test_high_single_contribution_detection(self):
        """Test detection of single contributor dominance"""
        detector = RoundAnomalyDetector(single_contribution_threshold=0.5)
        
        metrics = RoundMetrics(
            round_id=1,
            total_pool=10000.0,
            total_contributions=5000.0,
            unique_contributors=5,
            unique_projects=3,
            contributor_distribution={
                "whale": 3000.0,  # 60% from single contributor
                "addr1": 1000.0,
                "addr2": 500.0,
                "addr3": 300.0,
                "addr4": 200.0,
            },
            project_contributions={1: 3000.0, 2: 2000.0},
            project_contributor_counts={1: 3, 2: 2},
        )
        
        signal = detector.detect_high_single_contribution(metrics)
        
        assert signal is not None
        assert signal.anomaly_type == AnomalyType.HIGH_SINGLE_CONTRIBUTION
        assert signal.severity_score > 0

    def test_low_participation_detection(self):
        """Test detection of low participation projects"""
        detector = RoundAnomalyDetector(min_contributors_per_project=3)
        
        metrics = RoundMetrics(
            round_id=1,
            total_pool=10000.0,
            total_contributions=5000.0,
            unique_contributors=10,
            unique_projects=3,
            contributor_distribution={"addr1": 1000.0, "addr2": 1000.0},
            project_contributions={1: 3000.0, 2: 2000.0, 3: 0.0},
            project_contributor_counts={
                1: 5,  # OK
                2: 1,  # Too low
                3: 0,  # Too low
            },
        )
        
        signals = detector.detect_low_participation(metrics)
        
        assert len(signals) == 2
        assert all(s.anomaly_type == AnomalyType.LOW_PARTICIPATION for s in signals)
        assert signals[0].project_id == 2
        assert signals[1].project_id == 3

    def test_unusual_timing_detection(self):
        """Test detection of unusual timing patterns"""
        detector = RoundAnomalyDetector(timing_cluster_window_hours=1, timing_cluster_threshold=0.8)
        
        # Create timestamps clustered in 1 hour
        base_time = datetime.utcnow()
        timestamps = [
            base_time + timedelta(minutes=i) for i in range(10)
        ]  # All within 10 minutes
        
        metrics = RoundMetrics(
            round_id=1,
            total_pool=10000.0,
            total_contributions=5000.0,
            unique_contributors=10,
            unique_projects=5,
            contributor_distribution={f"addr{i}": 500.0 for i in range(10)},
            project_contributions={1: 2500.0, 2: 2500.0},
            project_contributor_counts={1: 5, 2: 5},
            contribution_timestamps=timestamps,
        )
        
        signal = detector.detect_unusual_timing(metrics)
        
        assert signal is not None
        assert signal.anomaly_type == AnomalyType.UNUSUAL_TIMING
        assert signal.severity_score > 0

    def test_normal_timing_no_anomaly(self):
        """Test that normal timing doesn't trigger anomaly"""
        detector = RoundAnomalyDetector(timing_cluster_window_hours=1, timing_cluster_threshold=0.8)
        
        # Create timestamps spread over 24 hours
        base_time = datetime.utcnow()
        timestamps = [
            base_time + timedelta(hours=i * 2) for i in range(10)
        ]  # Spread over 20 hours
        
        metrics = RoundMetrics(
            round_id=1,
            total_pool=10000.0,
            total_contributions=5000.0,
            unique_contributors=10,
            unique_projects=5,
            contributor_distribution={f"addr{i}": 500.0 for i in range(10)},
            project_contributions={1: 2500.0, 2: 2500.0},
            project_contributor_counts={1: 5, 2: 5},
            contribution_timestamps=timestamps,
        )
        
        signal = detector.detect_unusual_timing(metrics)
        
        assert signal is None

    def test_sybil_suspicion_detection(self):
        """Test detection of potential sybil patterns"""
        detector = RoundAnomalyDetector()
        
        # Many contributors with identical amounts
        metrics = RoundMetrics(
            round_id=1,
            total_pool=10000.0,
            total_contributions=5000.0,
            unique_contributors=10,
            unique_projects=5,
            contributor_distribution={
                f"addr{i}": 500.0 for i in range(8)  # 8 contributors with same amount
            },
            project_contributions={1: 2500.0, 2: 2500.0},
            project_contributor_counts={1: 5, 2: 5},
        )
        
        signals = detector.detect_sybil_suspicion(metrics)
        
        assert len(signals) > 0
        assert signals[0].anomaly_type == AnomalyType.SYBIL_SUSPICION

    def test_disproportionate_allocation_detection(self):
        """Test detection of disproportionate match allocations"""
        detector = RoundAnomalyDetector()
        
        metrics = RoundMetrics(
            round_id=1,
            total_pool=10000.0,
            total_contributions=5000.0,
            unique_contributors=10,
            unique_projects=3,
            contributor_distribution={f"addr{i}": 500.0 for i in range(10)},
            project_contributions={1: 1000.0, 2: 1000.0, 3: 3000.0},
            project_contributor_counts={1: 5, 2: 5, 3: 5},
        )
        
        # Project 3 gets disproportionate match (10x ratio vs median)
        match_allocations = {
            1: 500.0,  # 0.5x ratio
            2: 500.0,  # 0.5x ratio
            3: 30000.0,  # 10x ratio - anomaly
        }
        
        signals = detector.detect_disproportionate_allocation(metrics, match_allocations)
        
        assert len(signals) > 0
        assert signals[0].anomaly_type == AnomalyType.DISPROPORTIONATE_ALLOCATION
        assert signals[0].project_id == 3

    def test_full_round_analysis(self):
        """Test complete round analysis with multiple anomaly types"""
        detector = RoundAnomalyDetector()
        
        # Create metrics with multiple issues
        base_time = datetime.utcnow()
        metrics = RoundMetrics(
            round_id=1,
            total_pool=10000.0,
            total_contributions=5000.0,
            unique_contributors=10,
            unique_projects=3,
            contributor_distribution={
                "whale": 3000.0,
                **{f"addr{i}": 222.2 for i in range(9)},
            },
            project_contributions={1: 3000.0, 2: 1000.0, 3: 1000.0},
            project_contributor_counts={
                1: 5,
                2: 1,  # Low participation
                3: 1,  # Low participation
            },
            contribution_timestamps=[
                base_time + timedelta(minutes=i) for i in range(10)
            ],  # Clustered timing
        )
        
        signals = detector.analyze_round(metrics)
        
        # Should detect multiple anomalies
        assert len(signals) >= 2
        anomaly_types = {s.anomaly_type for s in signals}
        assert AnomalyType.HIGH_SINGLE_CONTRIBUTION in anomaly_types
        assert AnomalyType.SYBIL_SUSPICION in anomaly_types

    def test_round_metrics_gini_coefficient(self):
        """Test Gini coefficient calculation"""
        # Perfect equality
        metrics_equal = RoundMetrics(
            round_id=1,
            total_pool=10000.0,
            total_contributions=5000.0,
            unique_contributors=10,
            unique_projects=5,
            contributor_distribution={f"addr{i}": 500.0 for i in range(10)},
            project_contributions={1: 2500.0, 2: 2500.0},
            project_contributor_counts={1: 5, 2: 5},
        )
        assert metrics_equal.gini_coefficient == 0.0
        
        # High inequality
        metrics_unequal = RoundMetrics(
            round_id=1,
            total_pool=10000.0,
            total_contributions=5000.0,
            unique_contributors=10,
            unique_projects=5,
            contributor_distribution={
                "addr1": 4000.0,
                **{f"addr{i}": 111.1 for i in range(2,10)},
            },
            project_contributions={1: 2500.0, 2: 2500.0},
            project_contributor_counts={1: 5, 2: 5},
        )
        assert metrics_unequal.gini_coefficient > 0.5

    def test_round_metrics_concentration_ratio(self):
        """Test concentration ratio calculation"""
        metrics = RoundMetrics(
            round_id=1,
            total_pool=10000.0,
            total_contributions=5000.0,
            unique_contributors=10,
            unique_projects=5,
            contributor_distribution={
                "whale": 4000.0,  # Top 10%
                **{f"addr{i}": 111.1 for i in range(9)},
            },
            project_contributions={1: 2500.0, 2: 2500.0},
            project_contributor_counts={1: 5, 2: 5},
        )
        # Top 10% (1 contributor) should have ~80%
        assert metrics.concentration_ratio > 0.7

    def test_factory_function(self):
        """Test the create_detector factory function"""
        detector = create_detector(is_testnet=True)
        assert detector.is_testnet is True
        assert isinstance(detector, RoundAnomalyDetector)

    def test_get_thresholds(self):
        """Test threshold configuration retrieval"""
        detector = RoundAnomalyDetector(
            concentration_threshold=0.8,
            gini_threshold=0.7,
        )
        thresholds = detector.get_thresholds()
        
        assert thresholds["concentration_threshold"] == 0.8
        assert thresholds["gini_threshold"] == 0.7
        assert "is_testnet" in thresholds
        assert "timing_cluster_window_hours" in thresholds


class TestRoundAnomalySignal:
    """Test suite for RoundAnomalySignal dataclass"""

    def test_signal_to_dict(self):
        """Test signal serialization to dictionary"""
        signal = RoundAnomalySignal(
            round_id=1,
            project_id=2,
            anomaly_type=AnomalyType.CONCENTRATION_RISK,
            severity_score=0.8,
            detection_rationale="Test rationale",
            metric_values={"test": 123},
            threshold_used=0.7,
        )
        
        signal_dict = signal.to_dict()
        
        assert signal_dict["round_id"] == 1
        assert signal_dict["project_id"] == 2
        assert signal_dict["anomaly_type"] == "concentration_risk"
        assert signal_dict["severity_score"] == 0.8
        assert signal_dict["detection_rationale"] == "Test rationale"
        assert signal_dict["metric_values"]["test"] == 123
        assert signal_dict["threshold_used"] == 0.7
        assert "timestamp" in signal_dict

    def test_signal_defaults(self):
        """Test signal default values"""
        signal = RoundAnomalySignal(
            round_id=1,
            anomaly_type=AnomalyType.CONCENTRATION_RISK,
            severity_score=0.5,
            detection_rationale="Test",
        )
        
        assert signal.project_id is None
        assert signal.reviewed is False
        assert signal.review_notes is None
        assert signal.metric_values == {}
