"""
Round Analyzer - Analyzes quadratic funding rounds for anomalies
Integrates with the data processing pipeline as a non-blocking component.
"""

from src.utils.logger import setup_logger
from src.utils.metrics import JOBS_RUN_TOTAL
from src.round_anomaly_detector import (
    RoundAnomalyDetector,
    RoundMetrics,
    create_detector,
    AnomalyType,
)
from sqlalchemy import select
from src.db.postgres_service import PostgresService
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
from collections import defaultdict
import os
import threading


logger = setup_logger(__name__)


class RoundAnalyzer:
    """
    Analyzes quadratic funding rounds for suspicious allocation patterns.
    Runs as a non-blocking pipeline component.
    """

    def __init__(self, db_service: Optional[PostgresService] = None):
        """
        Initialize the round analyzer.
        
        Args:
            db_service: Optional database service instance
        """
        self.db_service = db_service or PostgresService()
        
        # Load configuration from environment
        self.is_testnet = os.getenv("NETWORK", "mainnet").lower() == "testnet"
        
        # Create detector with appropriate thresholds
        self.detector = create_detector(
            is_testnet=self.is_testnet,
            concentration_threshold=float(os.getenv("ROUND_CONCENTRATION_THRESHOLD")),
            gini_threshold=float(os.getenv("ROUND_GINI_THRESHOLD")),
            single_contribution_threshold=float(os.getenv("ROUND_SINGLE_CONTRIBUTION_THRESHOLD")),
            min_contributors_per_project=int(os.getenv("ROUND_MIN_CONTRIBUTORS", "3")),
            timing_cluster_window_hours=int(os.getenv("ROUND_TIMING_WINDOW_HOURS", "1")),
            timing_cluster_threshold=float(os.getenv("ROUND_TIMING_THRESHOLD", "0.8")),
        )
        
        logger.info(
            f"RoundAnalyzer initialized (network={'testnet' if self.is_testnet else 'mainnet'}), "
            f"thresholds: {self.detector.get_thresholds()}"
        )
    
    def _extract_round_metrics(
        self, round_id: int
    ) -> Optional[RoundMetrics]:
        """
        Extract metrics for a round from the database.
        
        Args:
            round_id: Round ID to analyze
            
        Returns:
            RoundMetrics object if data available, None otherwise
        """
        try:
            with self.db_service.get_session() as session:
                from src.db.models import ProjectContributor, ProjectView
                
                # Get all contributors for this round
                contributors = session.execute(
                    select(ProjectContributor).where(
                        ProjectContributor.project_id >= 0  # Placeholder - need actual round filtering
                    )
                ).scalars().all()
                
                # For now, create mock metrics since we don't have round-specific tables yet
                # In production, this would query actual round contribution data
                contributor_distribution = defaultdict(float)
                project_contributions = defaultdict(float)
                project_contributor_counts = defaultdict(int)
                contribution_timestamps = []
                
                for contrib in contributors:
                    contributor_distribution[contrib.contributor] += contrib.total_contributed
                    project_contributions[contrib.project_id] += contrib.total_contributed
                    project_contributor_counts[contrib.project_id] += 1
                    # Would need actual timestamps from contribution events
                
                if not contributor_distribution:
                    logger.warning(f"No contribution data found for round {round_id}")
                    return None
                
                return RoundMetrics(
                    round_id=round_id,
                    total_pool=sum(project_contributions.values()),
                    total_contributions=sum(contributor_distribution.values()),
                    unique_contributors=len(contributor_distribution),
                    unique_projects=len(project_contributions),
                    contributor_distribution=dict(contributor_distribution),
                    project_contributions=dict(project_contributions),
                    project_contributor_counts=dict(project_contributor_counts),
                    contribution_timestamps=contribution_timestamps,
                )
        except Exception as e:
            logger.error(f"Failed to extract metrics for round {round_id}: {e}")
            return None
    
    def analyze_round(self, round_id: int) -> List[Dict[str, Any]]:
        """
        Analyze a specific round for anomalies.
        
        Args:
            round_id: Round ID to analyze
            
        Returns:
            List of anomaly signal dictionaries
        """
        logger.info(f"Analyzing round {round_id}...")
        
        metrics = self._extract_round_metrics(round_id)
        if not metrics:
            logger.warning(f"Could not extract metrics for round {round_id}")
            return []
        
        # Run anomaly detection
        signals = self.detector.analyze_round(metrics)
        
        # Convert to dictionaries and save to database
        signal_dicts = [signal.to_dict() for signal in signals]
        
        if signal_dicts:
            saved_count = self.db_service.save_round_anomaly_signals(signal_dicts)
            logger.info(
                f"Round {round_id} analysis complete: {len(signal_dicts)} anomalies detected, "
                f"{saved_count} saved to database"
            )
        else:
            logger.info(f"Round {round_id} analysis complete: no anomalies detected")
        
        return signal_dicts
    
    def analyze_recent_rounds(self, hours: int = 24) -> Dict[str, Any]:
        """
        Analyze all rounds from the recent time window.
        
        Args:
            hours: Time window in hours
            
        Returns:
            Summary dictionary with analysis results
        """
        logger.info(f"Analyzing rounds from last {hours} hours...")
        
        # For now, analyze a sample round since we don't have round tables yet
        # In production, this would query rounds from the database
        sample_round_ids = [1, 2, 3]  # Placeholder
        
        total_signals = []
        for round_id in sample_round_ids:
            signals = self.analyze_round(round_id)
            total_signals.extend(signals)
        
        summary = {
            "rounds_analyzed": len(sample_round_ids),
            "total_anomalies_detected": len(total_signals),
            "by_type": defaultdict(int),
            "high_severity_count": sum(1 for s in total_signals if s.get("severity_score", 0) > 0.7),
        }
        
        for signal in total_signals:
            summary["by_type"][signal.get("anomaly_type")] += 1
        
        summary["by_type"] = dict(summary["by_type"])
        
        logger.info(
            f"Recent rounds analysis complete: {summary['rounds_analyzed']} rounds, "
            f"{summary['total_anomalies_detected']} anomalies"
        )
        
        return summary
    
    def run_analysis_async(self, round_id: Optional[int] = None) -> threading.Thread:
        """
        Run analysis in a background thread (non-blocking).
        
        Args:
            round_id: Optional specific round ID to analyze
            
        Returns:
            Thread object running the analysis
        """
        def _run():
            try:
                if round_id:
                    self.analyze_round(round_id)
                else:
                    self.analyze_recent_rounds()
                JOBS_RUN_TOTAL.labels(job_name="round_analyzer").inc()
            except Exception as e:
                logger.error(f"Async round analysis failed: {e}", exc_info=True)
        
        thread = threading.Thread(target=_run, daemon=True)
        thread.start()
        logger.info(f"Started async round analysis (round_id={round_id})")
        return thread


def _round_analyzer_job() -> None:
    """
    Scheduled job wrapper for round anomaly detection.
    Runs as a non-blocking background task.
    """
    try:
        analyzer = RoundAnalyzer()
        analyzer.run_analysis_async()
    except Exception as exc:
        logger.error(f"Round analyzer job failed: {exc}", exc_info=True)


def run_manual_analysis(round_id: Optional[int] = None) -> Dict[str, Any]:
    """
    Manually trigger round analysis (e.g., from API).
    
    Args:
        round_id: Optional specific round ID to analyze
        
    Returns:
        Analysis results summary
    """
    analyzer = RoundAnalyzer()
    
    if round_id:
        signals = analyzer.analyze_round(round_id)
        return {
            "round_id": round_id,
            "anomalies_detected": len(signals),
            "signals": signals,
        }
    else:
        return analyzer.analyze_recent_rounds()
