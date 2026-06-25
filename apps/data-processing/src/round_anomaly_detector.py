"""
Round Anomaly Detector - Detects suspicious allocation patterns in quadratic funding rounds
Identifies unusual round participation, contribution patterns, and allocation anomalies.
"""

from src.utils.logger import setup_logger
from src.utils.metrics import ANOMALIES_DETECTED_TOTAL
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime, timedelta
from dataclasses import dataclass, field
from collections import defaultdict
import numpy as np
from enum import Enum

logger = setup_logger(__name__)


class AnomalyType(Enum):
    """Types of round anomalies"""
    CONCENTRATION_RISK = "concentration_risk"  # Too many contributions from few addresses
    SYBIL_SUSPICION = "sybil_suspicion"  # Similar contribution patterns
    UNUSUAL_TIMING = "unusual_timing"  # Contributions clustered in time
    DISPROPORTIONATE_ALLOCATION = "disproportionate_allocation"  # Unfair matching
    LOW_PARTICIPATION = "low_participation"  # Suspiciously low contributor count
    HIGH_SINGLE_CONTRIBUTION = "high_single_contribution"  # Single large contribution


@dataclass
class RoundAnomalySignal:
    """Anomaly signal for a round or project"""
    id: Optional[int] = None
    round_id: int = 0
    project_id: Optional[int] = None
    anomaly_type: AnomalyType = AnomalyType.CONCENTRATION_RISK
    severity_score: float = 0.0  # 0.0 - 1.0
    detection_rationale: str = ""
    metric_values: Dict[str, Any] = field(default_factory=dict)
    threshold_used: float = 0.0
    timestamp: datetime = field(default_factory=datetime.utcnow)
    reviewed: bool = False
    review_notes: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "round_id": self.round_id,
            "project_id": self.project_id,
            "anomaly_type": self.anomaly_type.value,
            "severity_score": self.severity_score,
            "detection_rationale": self.detection_rationale,
            "metric_values": self.metric_values,
            "threshold_used": self.threshold_used,
            "timestamp": self.timestamp.isoformat(),
            "reviewed": self.reviewed,
            "review_notes": self.review_notes,
        }


@dataclass
class RoundMetrics:
    """Aggregated metrics for a round"""
    round_id: int
    total_pool: float
    total_contributions: float
    unique_contributors: int
    unique_projects: int
    contributor_distribution: Dict[str, float]  # contributor -> total contributed
    project_contributions: Dict[int, float]  # project_id -> total contributed
    project_contributor_counts: Dict[int, int]  # project_id -> contributor count
    contribution_timestamps: List[datetime] = field(default_factory=list)
    
    @property
    def gini_coefficient(self) -> float:
        """Calculate Gini coefficient for contribution inequality"""
        if not self.contributor_distribution:
            return 0.0
        values = sorted(self.contributor_distribution.values())
        n = len(values)
        if n == 0:
            return 0.0
        cumulative = np.cumsum(values)
        return (n + 1 - 2 * np.sum(cumulative) / cumulative[-1]) / n if cumulative[-1] > 0 else 0.0
    
    @property
    def concentration_ratio(self) -> float:
        """Ratio of top 10% contributors to total"""
        if not self.contributor_distribution:
            return 0.0
        values = sorted(self.contributor_distribution.values(), reverse=True)
        top_n = max(1, len(values) // 10)
        top_sum = sum(values[:top_n])
        total = sum(values)
        return top_sum / total if total > 0 else 0.0


class RoundAnomalyDetector:
    """
    Detects suspicious patterns in quadratic funding rounds.
    
    Anomalies detected:
    - Concentration risk: Too many contributions from few addresses
    - Sybil suspicion: Similar contribution patterns across projects
    - Unusual timing: Contributions clustered in short time windows
    - Disproportionate allocation: Projects receiving unfair matching
    - Low participation: Suspiciously low contributor counts
    - High single contribution: Dominant single contributor
    """
    
    # Default thresholds (configurable for testnet)
    DEFAULT_CONCENTRATION_THRESHOLD = 0.7  # 70% from top 10%
    DEFAULT_GINI_THRESHOLD = 0.6  # High inequality
    DEFAULT_SINGLE_CONTRIBUTION_THRESHOLD = 0.5  # 50% from single contributor
    DEFAULT_MIN_CONTRIBUTORS_PER_PROJECT = 3  # Minimum unique contributors
    DEFAULT_TIMING_CLUSTER_WINDOW_HOURS = 1  # 1 hour window for timing analysis
    DEFAULT_TIMING_CLUSTER_THRESHOLD = 0.8  # 80% in short window
    
    def __init__(
        self,
        concentration_threshold: float = None,
        gini_threshold: float = None,
        single_contribution_threshold: float = None,
        min_contributors_per_project: int = None,
        timing_cluster_window_hours: int = None,
        timing_cluster_threshold: float = None,
        is_testnet: bool = False
    ):
        """
        Initialize the round anomaly detector.
        
        Args:
            concentration_threshold: Max allowed concentration ratio (0-1)
            gini_threshold: Max allowed Gini coefficient (0-1)
            single_contribution_threshold: Max allowed single contributor ratio (0-1)
            min_contributors_per_project: Minimum unique contributors per project
            timing_cluster_window_hours: Window for timing analysis (hours)
            timing_cluster_threshold: Max allowed ratio in time window (0-1)
            is_testnet: Use more lenient thresholds for testnet
        """
        self.is_testnet = is_testnet
        
        # Apply testnet adjustments if needed
        if is_testnet:
            self.concentration_threshold = concentration_threshold or self.DEFAULT_CONCENTRATION_THRESHOLD * 1.2
            self.gini_threshold = gini_threshold or self.DEFAULT_GINI_THRESHOLD * 1.2
            self.single_contribution_threshold = single_contribution_threshold or self.DEFAULT_SINGLE_CONTRIBUTION_THRESHOLD * 1.2
            self.min_contributors_per_project = max(1, (min_contributors_per_project or self.DEFAULT_MIN_CONTRIBUTORS_PER_PROJECT) - 1)
            self.timing_cluster_window_hours = timing_cluster_window_hours or self.DEFAULT_TIMING_CLUSTER_WINDOW_HOURS
            self.timing_cluster_threshold = timing_cluster_threshold or self.DEFAULT_TIMING_CLUSTER_THRESHOLD * 1.2
        else:
            self.concentration_threshold = concentration_threshold or self.DEFAULT_CONCENTRATION_THRESHOLD
            self.gini_threshold = gini_threshold or self.DEFAULT_GINI_THRESHOLD
            self.single_contribution_threshold = single_contribution_threshold or self.DEFAULT_SINGLE_CONTRIBUTION_THRESHOLD
            self.min_contributors_per_project = min_contributors_per_project or self.DEFAULT_MIN_CONTRIBUTORS_PER_PROJECT
            self.timing_cluster_window_hours = timing_cluster_window_hours or self.DEFAULT_TIMING_CLUSTER_WINDOW_HOURS
            self.timing_cluster_threshold = timing_cluster_threshold or self.DEFAULT_TIMING_CLUSTER_THRESHOLD
        
        logger.info(
            f"RoundAnomalyDetector initialized (testnet={is_testnet}): "
            f"concentration_threshold={self.concentration_threshold:.2f}, "
            f"gini_threshold={self.gini_threshold:.2f}, "
            f"single_contribution_threshold={self.single_contribution_threshold:.2f}"
        )
    
    def detect_concentration_risk(
        self, metrics: RoundMetrics
    ) -> Optional[RoundAnomalySignal]:
        """
        Detect if contributions are too concentrated among few addresses.
        """
        concentration = metrics.concentration_ratio
        gini = metrics.gini_coefficient
        
        # Check both concentration ratio and Gini coefficient
        if concentration > self.concentration_threshold or gini > self.gini_threshold:
            severity = max(
                (concentration - self.concentration_threshold) / (1 - self.concentration_threshold),
                (gini - self.gini_threshold) / (1 - self.gini_threshold)
            )
            severity = min(1.0, max(0.0, severity))
            
            rationale = (
                f"High contribution concentration detected. "
                f"Top 10% contributors control {concentration:.1%} of total contributions "
                f"(threshold: {self.concentration_threshold:.1%}). "
                f"Gini coefficient: {gini:.3f} (threshold: {self.gini_threshold:.3f}). "
                f"This may indicate sybil attacks or coordinated manipulation."
            )
            
            return RoundAnomalySignal(
                round_id=metrics.round_id,
                anomaly_type=AnomalyType.CONCENTRATION_RISK,
                severity_score=severity,
                detection_rationale=rationale,
                metric_values={
                    "concentration_ratio": concentration,
                    "gini_coefficient": gini,
                    "unique_contributors": metrics.unique_contributors,
                    "total_contributions": metrics.total_contributions,
                },
                threshold_used=self.concentration_threshold,
            )
        return None
    
    def detect_high_single_contribution(
        self, metrics: RoundMetrics
    ) -> Optional[RoundAnomalySignal]:
        """
        Detect if a single contributor dominates the round.
        """
        if not metrics.contributor_distribution:
            return None
        
        max_contribution = max(metrics.contributor_distribution.values())
        single_ratio = max_contribution / metrics.total_contributions if metrics.total_contributions > 0 else 0
        
        if single_ratio > self.single_contribution_threshold:
            severity = (single_ratio - self.single_contribution_threshold) / (1 - self.single_contribution_threshold)
            severity = min(1.0, max(0.0, severity))
            
            rationale = (
                f"Single contributor dominance detected. "
                f"Largest contribution is {single_ratio:.1%} of total "
                f"(threshold: {self.single_contribution_threshold:.1%}). "
                f"This may undermine the quadratic funding mechanism."
            )
            
            return RoundAnomalySignal(
                round_id=metrics.round_id,
                anomaly_type=AnomalyType.HIGH_SINGLE_CONTRIBUTION,
                severity_score=severity,
                detection_rationale=rationale,
                metric_values={
                    "single_contribution_ratio": single_ratio,
                    "max_contribution": max_contribution,
                    "total_contributions": metrics.total_contributions,
                },
                threshold_used=self.single_contribution_threshold,
            )
        return None
    
    def detect_low_participation(
        self, metrics: RoundMetrics
    ) -> List[RoundAnomalySignal]:
        """
        Detect projects with suspiciously low contributor counts.
        """
        signals = []
        
        for project_id, contributor_count in metrics.project_contributor_counts.items():
            if contributor_count < self.min_contributors_per_project:
                project_total = metrics.project_contributions.get(project_id, 0)
                severity = 1.0 - (contributor_count / self.min_contributors_per_project)
                
                rationale = (
                    f"Low participation detected for project {project_id}. "
                    f"Only {contributor_count} unique contributors "
                    f"(threshold: {self.min_contributors_per_project}). "
                    f"Total contributions: {project_total:.2f}. "
                    f"This may indicate fake projects or lack of genuine interest."
                )
                
                signals.append(RoundAnomalySignal(
                    round_id=metrics.round_id,
                    project_id=project_id,
                    anomaly_type=AnomalyType.LOW_PARTICIPATION,
                    severity_score=severity,
                    detection_rationale=rationale,
                    metric_values={
                        "contributor_count": contributor_count,
                        "project_total": project_total,
                        "threshold": self.min_contributors_per_project,
                    },
                    threshold_used=float(self.min_contributors_per_project),
                ))
        
        return signals
    
    def detect_unusual_timing(
        self, metrics: RoundMetrics
    ) -> Optional[RoundAnomalySignal]:
        """
        Detect if contributions are clustered in a short time window.
        """
        if len(metrics.contribution_timestamps) < 10:
            return None
        
        timestamps = sorted(metrics.contribution_timestamps)
        total = len(timestamps)
        
        # Check for clustering in the defined window
        window_delta = timedelta(hours=self.timing_cluster_window_hours)
        max_in_window = 0
        
        for i, ts in enumerate(timestamps):
            window_end = ts + window_delta
            in_window = sum(1 for t in timestamps[i:] if t <= window_end)
            max_in_window = max(max_in_window, in_window)
        
        cluster_ratio = max_in_window / total
        
        if cluster_ratio > self.timing_cluster_threshold:
            severity = (cluster_ratio - self.timing_cluster_threshold) / (1 - self.timing_cluster_threshold)
            severity = min(1.0, max(0.0, severity))
            
            rationale = (
                f"Unusual contribution timing detected. "
                f"{cluster_ratio:.1%} of contributions occurred within a "
                f"{self.timing_cluster_window_hours}-hour window "
                f"(threshold: {self.timing_cluster_threshold:.1%}). "
                f"This may indicate coordinated activity or bot operations."
            )
            
            return RoundAnomalySignal(
                round_id=metrics.round_id,
                anomaly_type=AnomalyType.UNUSUAL_TIMING,
                severity_score=severity,
                detection_rationale=rationale,
                metric_values={
                    "cluster_ratio": cluster_ratio,
                    "max_in_window": max_in_window,
                    "total_contributions": total,
                    "window_hours": self.timing_cluster_window_hours,
                },
                threshold_used=self.timing_cluster_threshold,
            )
        return None
    
    def detect_sybil_suspicion(
        self, metrics: RoundMetrics
    ) -> List[RoundAnomalySignal]:
        """
        Detect potential sybil attacks by analyzing contribution patterns.
        
        This is a heuristic detection looking for:
        - Many contributors with identical contribution amounts
        - Contributors who only contribute to one project
        """
        signals = []
        
        if not metrics.contributor_distribution:
            return signals
        
        # Analyze contribution amount distribution
        amounts = list(metrics.contributor_distribution.values())
        amount_counts = defaultdict(int)
        for amount in amounts:
            # Round to nearest integer for grouping
            rounded = int(amount)
            amount_counts[rounded] += 1
        
        # Check if many contributors have identical amounts
        max_same_amount = max(amount_counts.values()) if amount_counts else 0
        same_amount_ratio = max_same_amount / len(amounts) if amounts else 0
        
        if same_amount_ratio > 0.3:  # 30% with same amount
            severity = min(1.0, same_amount_ratio)
            
            rationale = (
                f"Potential sybil pattern detected. "
                f"{same_amount_ratio:.1%} of contributors have identical contribution amounts. "
                f"This may indicate automated or coordinated contributions."
            )
            
            signals.append(RoundAnomalySignal(
                round_id=metrics.round_id,
                anomaly_type=AnomalyType.SYBIL_SUSPICION,
                severity_score=severity,
                detection_rationale=rationale,
                metric_values={
                    "same_amount_ratio": same_amount_ratio,
                    "max_same_amount_count": max_same_amount,
                    "total_contributors": len(amounts),
                },
                threshold_used=0.3,
            ))
        
        return signals
    
    def detect_disproportionate_allocation(
        self, metrics: RoundMetrics, match_allocations: Dict[int, float]
    ) -> List[RoundAnomalySignal]:
        """
        Detect if matching allocations are disproportionate to contributions.
        
        Args:
            metrics: Round metrics
            match_allocations: project_id -> match amount received
        """
        signals = []
        
        if not match_allocations:
            return signals
        
        # Calculate match-to-contribution ratios
        ratios = {}
        for project_id, match_amount in match_allocations.items():
            contribution = metrics.project_contributions.get(project_id, 0)
            if contribution > 0:
                ratios[project_id] = match_amount / contribution
        
        if not ratios:
            return signals
        
        # Check for extreme ratios
        ratio_values = list(ratios.values())
        median_ratio = np.median(ratio_values)
        
        for project_id, ratio in ratios.items():
            # Flag if ratio is > 5x median
            if ratio > median_ratio * 5 and median_ratio > 0:
                severity = min(1.0, (ratio / (median_ratio * 10)))
                
                rationale = (
                    f"Disproportionate allocation detected for project {project_id}. "
                    f"Match-to-contribution ratio: {ratio:.2f}x "
                    f"(median: {median_ratio:.2f}x). "
                    f"This may indicate unfair matching or gaming of the QF mechanism."
                )
                
                signals.append(RoundAnomalySignal(
                    round_id=metrics.round_id,
                    project_id=project_id,
                    anomaly_type=AnomalyType.DISPROPORTIONATE_ALLOCATION,
                    severity_score=severity,
                    detection_rationale=rationale,
                    metric_values={
                        "match_to_contribution_ratio": ratio,
                        "median_ratio": median_ratio,
                        "match_amount": match_allocations[project_id],
                        "contribution_amount": metrics.project_contributions.get(project_id, 0),
                    },
                    threshold_used=median_ratio * 5,
                ))
        
        return signals
    
    def analyze_round(
        self,
        metrics: RoundMetrics,
        match_allocations: Optional[Dict[int, float]] = None
    ) -> List[RoundAnomalySignal]:
        """
        Run full anomaly detection on a round.
        
        Args:
            metrics: Aggregated round metrics
            match_allocations: Optional match allocations for allocation analysis
            
        Returns:
            List of detected anomaly signals
        """
        signals = []
        
        logger.info(f"Analyzing round {metrics.round_id} for anomalies...")
        
        # Run all detection methods
        concentration_signal = self.detect_concentration_risk(metrics)
        if concentration_signal:
            signals.append(concentration_signal)
            ANOMALIES_DETECTED_TOTAL.labels(metric_name="round_concentration").inc()
        
        single_contrib_signal = self.detect_high_single_contribution(metrics)
        if single_contrib_signal:
            signals.append(single_contrib_signal)
            ANOMALIES_DETECTED_TOTAL.labels(metric_name="round_single_contribution").inc()
        
        timing_signal = self.detect_unusual_timing(metrics)
        if timing_signal:
            signals.append(timing_signal)
            ANOMALIES_DETECTED_TOTAL.labels(metric_name="round_timing").inc()
        
        # Multi-signal detections
        low_participation_signals = self.detect_low_participation(metrics)
        signals.extend(low_participation_signals)
        if low_participation_signals:
            ANOMALIES_DETECTED_TOTAL.labels(metric_name="round_low_participation").inc()
        
        sybil_signals = self.detect_sybil_suspicion(metrics)
        signals.extend(sybil_signals)
        if sybil_signals:
            ANOMALIES_DETECTED_TOTAL.labels(metric_name="round_sybil").inc()
        
        # Allocation analysis (if match data provided)
        if match_allocations:
            allocation_signals = self.detect_disproportionate_allocation(metrics, match_allocations)
            signals.extend(allocation_signals)
            if allocation_signals:
                ANOMALIES_DETECTED_TOTAL.labels(metric_name="round_allocation").inc()
        
        logger.info(f"Round {metrics.round_id} analysis complete: {len(signals)} anomalies detected")
        
        return signals
    
    def get_thresholds(self) -> Dict[str, Any]:
        """Return current threshold configuration"""
        return {
            "is_testnet": self.is_testnet,
            "concentration_threshold": self.concentration_threshold,
            "gini_threshold": self.gini_threshold,
            "single_contribution_threshold": self.single_contribution_threshold,
            "min_contributors_per_project": self.min_contributors_per_project,
            "timing_cluster_window_hours": self.timing_cluster_window_hours,
            "timing_cluster_threshold": self.timing_cluster_threshold,
        }


def create_detector(is_testnet: bool = False, **kwargs) -> RoundAnomalyDetector:
    """
    Factory function to create a RoundAnomalyDetector instance.
    
    Args:
        is_testnet: Use testnet-appropriate thresholds
        **kwargs: Override specific thresholds
        
    Returns:
        Configured RoundAnomalyDetector instance
    """
    return RoundAnomalyDetector(is_testnet=is_testnet, **kwargs)
