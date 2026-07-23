"""
Cohort Analyzer - Builds datasets for contributor cohorts, repeat participation, and retention patterns
"""

from src.utils.logger import setup_logger
from src.db.postgres_service import PostgresService
from typing import Dict, Any, List, Optional, Set
from datetime import datetime, timedelta
from collections import defaultdict
from dataclasses import dataclass, field
from enum import Enum
import json

logger = setup_logger(__name__)


class CohortType(Enum):
    """Types of cohort definitions"""
    FIRST_ROUND = "first_round"  # Contributors who first participated in a specific round
    TIME_WINDOW = "time_window"  # Contributors who participated within a time window
    REPEAT = "repeat"  # Contributors who participated in multiple rounds
    SUPER_CONTRIBUTOR = "super_contributor"  # High-value repeat contributors


class ContributorType(Enum):
    """Classification of contributors based on participation patterns"""
    ONE_TIME = "one_time"  # Participated in only one round
    REPEAT = "repeat"  # Participated in 2-5 rounds
    SUPER_CONTRIBUTOR = "super_contributor"  # Participated in 6+ rounds or high total contribution


@dataclass
class CohortDefinition:
    """Definition of a contributor cohort"""
    cohort_id: str
    cohort_type: CohortType
    window_start: datetime
    window_end: datetime
    description: str = ""
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "cohort_id": self.cohort_id,
            "cohort_type": self.cohort_type.value,
            "window_start": self.window_start.isoformat(),
            "window_end": self.window_end.isoformat(),
            "description": self.description,
        }


@dataclass
class CohortMetrics:
    """Aggregated metrics for a cohort"""
    cohort_id: str
    member_count: int
    members: List[str] = field(default_factory=list)
    total_contributed: float = 0.0
    avg_contributed_per_member: float = 0.0
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "cohort_id": self.cohort_id,
            "member_count": self.member_count,
            "members": self.members,
            "total_contributed": self.total_contributed,
            "avg_contributed_per_member": self.avg_contributed_per_member,
        }


@dataclass
class RetentionMetrics:
    """Retention metrics for a cohort in a specific round"""
    cohort_id: str
    round_id: int
    cohort_size: int
    retained_contributors: int
    retention_rate: float
    retained_total_contributed: float = 0.0
    avg_retained_contribution: float = 0.0
    new_contributors: int = 0
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "cohort_id": self.cohort_id,
            "round_id": self.round_id,
            "cohort_size": self.cohort_size,
            "retained_contributors": self.retained_contributors,
            "retention_rate": self.retention_rate,
            "retained_total_contributed": self.retained_total_contributed,
            "avg_retained_contribution": self.avg_retained_contribution,
            "new_contributors": self.new_contributors,
        }


@dataclass
class RepeatContributorMetrics:
    """Metrics for a repeat contributor"""
    contributor: str
    rounds_participated: int
    first_round_id: Optional[int]
    last_round_id: Optional[int]
    total_contributed_all_rounds: float
    avg_contributed_per_round: float
    total_projects_supported: int
    unique_projects_supported: int
    contributor_type: ContributorType
    round_ids: List[int] = field(default_factory=list)
    first_contribution_at: Optional[datetime] = None
    last_contribution_at: Optional[datetime] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "contributor": self.contributor,
            "rounds_participated": self.rounds_participated,
            "first_round_id": self.first_round_id,
            "last_round_id": self.last_round_id,
            "total_contributed_all_rounds": self.total_contributed_all_rounds,
            "avg_contributed_per_round": self.avg_contributed_per_round,
            "total_projects_supported": self.total_projects_supported,
            "unique_projects_supported": self.unique_projects_supported,
            "contributor_type": self.contributor_type.value,
            "round_ids": self.round_ids,
            "first_contribution_at": self.first_contribution_at.isoformat() if self.first_contribution_at else None,
            "last_contribution_at": self.last_contribution_at.isoformat() if self.last_contribution_at else None,
        }


class CohortAnalyzer:
    """
    Analyzes contributor cohorts, repeat participation, and retention patterns.
    
    Capabilities:
    - Track contributor participation across grant rounds
    - Define cohorts based on first participation or time windows
    - Calculate round-to-round retention rates
    - Identify and classify repeat contributors
    - Generate time-windowed cohort summaries
    """
    
    def __init__(self, db_service: Optional[PostgresService] = None):
        """
        Initialize the cohort analyzer.
        
        Args:
            db_service: Optional database service instance
        """
        self.db_service = db_service or PostgresService()
        logger.info("CohortAnalyzer initialized")
    
    def _classify_contributor(
        self, 
        rounds_participated: int, 
        total_contributed: float
    ) -> ContributorType:
        """
        Classify a contributor based on participation patterns.
        
        Args:
            rounds_participated: Number of rounds participated
            total_contributed: Total amount contributed across all rounds
            
        Returns:
            ContributorType classification
        """
        if rounds_participated == 1:
            return ContributorType.ONE_TIME
        elif rounds_participated >= 6 or total_contributed > 10000:  # Threshold configurable
            return ContributorType.SUPER_CONTRIBUTOR
        else:
            return ContributorType.REPEAT
    
    def track_round_participation(
        self, 
        round_id: int, 
        contributions: List[Dict[str, Any]]
    ) -> int:
        """
        Track contributor participation for a specific round.
        
        Args:
            round_id: Grant round ID
            contributions: List of contribution records with:
                - contributor: contributor address
                - amount: contribution amount
                - project_id: project ID
                - timestamp: contribution timestamp
                
        Returns:
            Number of participation records created/updated
        """
        logger.info(f"Tracking participation for round {round_id} with {len(contributions)} contributions")
        
        try:
            from src.db.cohort_models import ContributorRoundParticipation
            
            # Aggregate contributions by contributor
            contributor_data = defaultdict(lambda: {
                "total_contributed": 0.0,
                "projects_supported": set(),
                "contribution_count": 0,
                "timestamps": []
            })
            
            for contrib in contributions:
                contributor = contrib.get("contributor")
                amount = contrib.get("amount", 0.0)
                project_id = contrib.get("project_id")
                timestamp = contrib.get("timestamp")
                
                if contributor:
                    contributor_data[contributor]["total_contributed"] += amount
                    contributor_data[contributor]["contribution_count"] += 1
                    if project_id:
                        contributor_data[contributor]["projects_supported"].add(project_id)
                    if timestamp:
                        contributor_data[contributor]["timestamps"].append(timestamp)
            
            # Save to database
            saved_count = 0
            with self.db_service.get_session() as session:
                for contributor, data in contributor_data.items():
                    timestamps = sorted(data["timestamps"]) if data["timestamps"] else None
                    
                    # Check if record exists
                    existing = session.execute(
                        session.query(ContributorRoundParticipation).filter(
                            ContributorRoundParticipation.round_id == round_id,
                            ContributorRoundParticipation.contributor == contributor
                        )
                    ).scalar_one_or_none()
                    
                    if existing:
                        # Update existing record
                        existing.total_contributed = data["total_contributed"]
                        existing.projects_supported = len(data["projects_supported"])
                        existing.contribution_count = data["contribution_count"]
                        existing.project_ids = list(data["projects_supported"])
                        if timestamps:
                            existing.first_contribution_at = timestamps[0]
                            existing.last_contribution_at = timestamps[-1]
                        saved_count += 1
                    else:
                        # Create new record
                        participation = ContributorRoundParticipation(
                            round_id=round_id,
                            contributor=contributor,
                            total_contributed=data["total_contributed"],
                            projects_supported=len(data["projects_supported"]),
                            contribution_count=data["contribution_count"],
                            project_ids=list(data["projects_supported"]),
                            first_contribution_at=timestamps[0] if timestamps else None,
                            last_contribution_at=timestamps[-1] if timestamps else None,
                        )
                        session.add(participation)
                        saved_count += 1
                
                session.flush()
            
            logger.info(f"Saved {saved_count} participation records for round {round_id}")
            return saved_count
            
        except Exception as e:
            logger.error(f"Failed to track round participation: {e}")
            return 0
    
    def create_first_round_cohort(
        self, 
        round_id: int, 
        cohort_id: Optional[str] = None
    ) -> CohortMetrics:
        """
        Create a cohort of contributors who first participated in a specific round.
        
        Args:
            round_id: Grant round ID
            cohort_id: Optional custom cohort ID (auto-generated if not provided)
            
        Returns:
            CohortMetrics with cohort information
        """
        if cohort_id is None:
            cohort_id = f"first_round_{round_id}"
        
        logger.info(f"Creating first-round cohort for round {round_id}")
        
        try:
            from src.db.cohort_models import ContributorRoundParticipation, ContributorCohort
            
            # Get all contributors who participated in this round
            with self.db_service.get_session() as session:
                participants = session.execute(
                    session.query(ContributorRoundParticipation).filter(
                        ContributorRoundParticipation.round_id == round_id
                    )
                ).scalars().all()
                
                # Filter for first-time contributors (not in previous rounds)
                all_previous_rounds = session.execute(
                    session.query(ContributorRoundParticipation.round_id).filter(
                        ContributorRoundParticipation.round_id < round_id
                    ).distinct()
                ).scalars().all()
                
                previous_contributors = set()
                for prev_round in all_previous_rounds:
                    prev_participants = session.execute(
                        session.query(ContributorRoundParticipation.contributor).filter(
                            ContributorRoundParticipation.round_id == prev_round
                        )
                    ).scalars().all()
                    previous_contributors.update(prev_participants)
                
                # Identify first-time contributors
                first_time_contributors = [
                    p.contributor for p in participants 
                    if p.contributor not in previous_contributors
                ]
                
                # Calculate metrics
                total_contributed = sum(p.total_contributed for p in participants if p.contributor in first_time_contributors)
                avg_contributed = total_contributed / len(first_time_contributors) if first_time_contributors else 0.0
                
                # Save cohort
                cohort = ContributorCohort(
                    cohort_id=cohort_id,
                    cohort_type=CohortType.FIRST_ROUND.value,
                    definition_window_start=datetime.utcnow() - timedelta(days=30),
                    definition_window_end=datetime.utcnow(),
                    member_count=len(first_time_contributors),
                    members=first_time_contributors,
                    total_contributed=total_contributed,
                    avg_contributed_per_member=avg_contributed,
                )
                session.add(cohort)
                session.flush()
                
                logger.info(f"Created cohort {cohort_id} with {len(first_time_contributors)} members")
                
                return CohortMetrics(
                    cohort_id=cohort_id,
                    member_count=len(first_time_contributors),
                    members=first_time_contributors,
                    total_contributed=total_contributed,
                    avg_contributed_per_member=avg_contributed,
                )
                
        except Exception as e:
            logger.error(f"Failed to create first-round cohort: {e}")
            raise
    
    def calculate_retention(
        self, 
        cohort_id: str, 
        round_id: int
    ) -> RetentionMetrics:
        """
        Calculate retention metrics for a cohort in a specific round.
        
        Args:
            cohort_id: Cohort identifier
            round_id: Round ID to calculate retention for
            
        Returns:
            RetentionMetrics with retention information
        """
        logger.info(f"Calculating retention for cohort {cohort_id} in round {round_id}")
        
        try:
            from src.db.cohort_models import ContributorCohort, ContributorRoundParticipation, CohortRetentionSummary
            
            with self.db_service.get_session() as session:
                # Get cohort members
                cohort = session.execute(
                    session.query(ContributorCohort).filter(
                        ContributorCohort.cohort_id == cohort_id
                    )
                ).scalar_one_or_none()
                
                if not cohort:
                    raise ValueError(f"Cohort {cohort_id} not found")
                
                cohort_members = set(cohort.members or [])
                cohort_size = len(cohort_members)
                
                # Get contributors in the target round
                round_participants = session.execute(
                    session.query(ContributorRoundParticipation).filter(
                        ContributorRoundParticipation.round_id == round_id
                    )
                ).scalars().all()
                
                round_contributors = {p.contributor: p for p in round_participants}
                
                # Calculate retention
                retained = cohort_members.intersection(set(round_contributors.keys()))
                retained_count = len(retained)
                retention_rate = retained_count / cohort_size if cohort_size > 0 else 0.0
                
                # Calculate contribution metrics for retained contributors
                retained_total = sum(round_contributors[c].total_contributed for c in retained)
                avg_retained = retained_total / retained_count if retained_count > 0 else 0.0
                
                # Count new contributors (not in cohort)
                new_contributors = len(set(round_contributors.keys()) - cohort_members)
                
                # Save retention summary
                summary = CohortRetentionSummary(
                    cohort_id=cohort_id,
                    round_id=round_id,
                    cohort_size=cohort_size,
                    retained_contributors=retained_count,
                    retention_rate=retention_rate,
                    retained_total_contributed=retained_total,
                    avg_retained_contribution=avg_retained,
                    new_contributors=new_contributors,
                    calculated_at=datetime.utcnow(),
                )
                session.add(summary)
                session.flush()
                
                logger.info(
                    f"Cohort {cohort_id} retention in round {round_id}: "
                    f"{retained_count}/{cohort_size} ({retention_rate:.1%})"
                )
                
                return RetentionMetrics(
                    cohort_id=cohort_id,
                    round_id=round_id,
                    cohort_size=cohort_size,
                    retained_contributors=retained_count,
                    retention_rate=retention_rate,
                    retained_total_contributed=retained_total,
                    avg_retained_contribution=avg_retained,
                    new_contributors=new_contributors,
                )
                
        except Exception as e:
            logger.error(f"Failed to calculate retention: {e}")
            raise
    
    def analyze_repeat_contributors(
        self, 
        min_rounds: int = 2,
        recalculate: bool = False
    ) -> List[RepeatContributorMetrics]:
        """
        Analyze and classify repeat contributors across all rounds.
        
        Args:
            min_rounds: Minimum number of rounds to be considered a repeat contributor
            recalculate: Force recalculation of existing summaries
            
        Returns:
            List of RepeatContributorMetrics for all repeat contributors
        """
        logger.info(f"Analyzing repeat contributors (min_rounds={min_rounds})")
        
        try:
            from src.db.cohort_models import ContributorRoundParticipation, RepeatContributorSummary
            
            with self.db_service.get_session() as session:
                # Get all participation records
                all_participation = session.execute(
                    session.query(ContributorRoundParticipation)
                ).scalars().all()
                
                # Aggregate by contributor
                contributor_data = defaultdict(lambda: {
                    "rounds": set(),
                    "total_contributed": 0.0,
                    "projects": set(),
                    "total_projects": 0,
                    "timestamps": []
                })
                
                for participation in all_participation:
                    contributor = participation.contributor
                    contributor_data[contributor]["rounds"].add(participation.round_id)
                    contributor_data[contributor]["total_contributed"] += participation.total_contributed
                    contributor_data[contributor]["total_projects"] += participation.projects_supported
                    if participation.project_ids:
                        contributor_data[contributor]["projects"].update(participation.project_ids)
                    if participation.first_contribution_at:
                        contributor_data[contributor]["timestamps"].append(participation.first_contribution_at)
                    if participation.last_contribution_at:
                        contributor_data[contributor]["timestamps"].append(participation.last_contribution_at)
                
                # Calculate metrics for each contributor
                results = []
                for contributor, data in contributor_data.items():
                    rounds_participated = len(data["rounds"])
                    
                    if rounds_participated < min_rounds:
                        continue
                    
                    round_ids = sorted(list(data["rounds"]))
                    total_contributed = data["total_contributed"]
                    avg_per_round = total_contributed / rounds_participated
                    unique_projects = len(data["projects"])
                    timestamps = sorted(data["timestamps"]) if data["timestamps"] else []
                    
                    contributor_type = self._classify_contributor(rounds_participated, total_contributed)
                    
                    # Check if summary exists
                    existing = session.execute(
                        session.query(RepeatContributorSummary).filter(
                            RepeatContributorSummary.contributor == contributor
                        )
                    ).scalar_one_or_none()
                    
                    if existing and not recalculate:
                        # Return existing data
                        results.append(RepeatContributorMetrics(
                            contributor=contributor,
                            rounds_participated=existing.rounds_participated,
                            first_round_id=existing.first_round_id,
                            last_round_id=existing.last_round_id,
                            total_contributed_all_rounds=existing.total_contributed_all_rounds,
                            avg_contributed_per_round=existing.avg_contributed_per_round,
                            total_projects_supported=existing.total_projects_supported,
                            unique_projects_supported=existing.unique_projects_supported,
                            contributor_type=ContributorType(existing.contributor_type),
                            round_ids=existing.round_ids or [],
                            first_contribution_at=existing.first_contribution_at,
                            last_contribution_at=existing.last_contribution_at,
                        ))
                    else:
                        # Create or update summary
                        metrics = RepeatContributorMetrics(
                            contributor=contributor,
                            rounds_participated=rounds_participated,
                            first_round_id=round_ids[0] if round_ids else None,
                            last_round_id=round_ids[-1] if round_ids else None,
                            total_contributed_all_rounds=total_contributed,
                            avg_contributed_per_round=avg_per_round,
                            total_projects_supported=data["total_projects"],
                            unique_projects_supported=unique_projects,
                            contributor_type=contributor_type,
                            round_ids=round_ids,
                            first_contribution_at=timestamps[0] if timestamps else None,
                            last_contribution_at=timestamps[-1] if timestamps else None,
                        )
                        
                        if existing:
                            existing.rounds_participated = rounds_participated
                            existing.first_round_id = metrics.first_round_id
                            existing.last_round_id = metrics.last_round_id
                            existing.total_contributed_all_rounds = total_contributed
                            existing.avg_contributed_per_round = avg_per_round
                            existing.total_projects_supported = data["total_projects"]
                            existing.unique_projects_supported = unique_projects
                            existing.contributor_type = contributor_type.value
                            existing.round_ids = round_ids
                            existing.first_contribution_at = metrics.first_contribution_at
                            existing.last_contribution_at = metrics.last_contribution_at
                            existing.calculated_at = datetime.utcnow()
                        else:
                            summary = RepeatContributorSummary(
                                contributor=contributor,
                                rounds_participated=rounds_participated,
                                first_round_id=metrics.first_round_id,
                                last_round_id=metrics.last_round_id,
                                total_contributed_all_rounds=total_contributed,
                                avg_contributed_per_round=avg_per_round,
                                total_projects_supported=data["total_projects"],
                                unique_projects_supported=unique_projects,
                                contributor_type=contributor_type.value,
                                round_ids=round_ids,
                                first_contribution_at=metrics.first_contribution_at,
                                last_contribution_at=metrics.last_contribution_at,
                                calculated_at=datetime.utcnow(),
                            )
                            session.add(summary)
                        
                        results.append(metrics)
                
                session.flush()
                logger.info(f"Analyzed {len(results)} repeat contributors")
                return results
                
        except Exception as e:
            logger.error(f"Failed to analyze repeat contributors: {e}")
            raise
    
    def create_time_window_cohort(
        self, 
        window_start: datetime, 
        window_end: datetime,
        cohort_id: Optional[str] = None
    ) -> CohortMetrics:
        """
        Create a cohort of contributors who participated within a time window.
        
        Args:
            window_start: Start of the time window
            window_end: End of the time window
            cohort_id: Optional custom cohort ID (auto-generated if not provided)
            
        Returns:
            CohortMetrics with cohort information
        """
        if cohort_id is None:
            cohort_id = f"time_window_{window_start.strftime('%Y%m%d')}_{window_end.strftime('%Y%m%d')}"
        
        logger.info(f"Creating time-window cohort: {window_start} to {window_end}")
        
        try:
            from src.db.cohort_models import ContributorRoundParticipation, ContributorCohort, GrantRound
            
            with self.db_service.get_session() as session:
                # Get rounds within the time window
                rounds_in_window = session.execute(
                    session.query(GrantRound.id).filter(
                        GrantRound.start_time >= window_start,
                        GrantRound.end_time <= window_end
                    )
                ).scalars().all()
                
                if not rounds_in_window:
                    logger.warning(f"No rounds found in time window {window_start} to {window_end}")
                    return CohortMetrics(cohort_id=cohort_id, member_count=0)
                
                # Get all contributors in these rounds
                contributors_in_window = set()
                contributor_totals = defaultdict(float)
                
                for round_id in rounds_in_window:
                    participants = session.execute(
                        session.query(ContributorRoundParticipation).filter(
                            ContributorRoundParticipation.round_id == round_id
                        )
                    ).scalars().all()
                    
                    for p in participants:
                        contributors_in_window.add(p.contributor)
                        contributor_totals[p.contributor] += p.total_contributed
                
                # Calculate metrics
                total_contributed = sum(contributor_totals.values())
                avg_contributed = total_contributed / len(contributors_in_window) if contributors_in_window else 0.0
                
                # Save cohort
                cohort = ContributorCohort(
                    cohort_id=cohort_id,
                    cohort_type=CohortType.TIME_WINDOW.value,
                    definition_window_start=window_start,
                    definition_window_end=window_end,
                    member_count=len(contributors_in_window),
                    members=list(contributors_in_window),
                    total_contributed=total_contributed,
                    avg_contributed_per_member=avg_contributed,
                )
                session.add(cohort)
                session.flush()
                
                logger.info(f"Created time-window cohort {cohort_id} with {len(contributors_in_window)} members")
                
                return CohortMetrics(
                    cohort_id=cohort_id,
                    member_count=len(contributors_in_window),
                    members=list(contributors_in_window),
                    total_contributed=total_contributed,
                    avg_contributed_per_member=avg_contributed,
                )
                
        except Exception as e:
            logger.error(f"Failed to create time-window cohort: {e}")
            raise
    
    def get_cohort_retention_timeline(
        self, 
        cohort_id: str
    ) -> List[Dict[str, Any]]:
        """
        Get retention timeline for a cohort across all rounds.
        
        Args:
            cohort_id: Cohort identifier
            
        Returns:
            List of retention metrics for each round
        """
        logger.info(f"Getting retention timeline for cohort {cohort_id}")
        
        try:
            from src.db.cohort_models import CohortRetentionSummary
            
            with self.db_service.get_session() as session:
                summaries = session.execute(
                    session.query(CohortRetentionSummary).filter(
                        CohortRetentionSummary.cohort_id == cohort_id
                    ).order_by(CohortRetentionSummary.round_id)
                ).scalars().all()
                
                timeline = [
                    {
                        "round_id": s.round_id,
                        "cohort_size": s.cohort_size,
                        "retained_contributors": s.retained_contributors,
                        "retention_rate": s.retention_rate,
                        "retained_total_contributed": s.retained_total_contributed,
                        "avg_retained_contribution": s.avg_retained_contribution,
                        "new_contributors": s.new_contributors,
                        "calculated_at": s.calculated_at.isoformat(),
                    }
                    for s in summaries
                ]
                
                logger.info(f"Retrieved {len(timeline)} retention data points for cohort {cohort_id}")
                return timeline
                
        except Exception as e:
            logger.error(f"Failed to get retention timeline: {e}")
            return []


def create_cohort_analyzer(db_service: Optional[PostgresService] = None) -> CohortAnalyzer:
    """
    Factory function to create a CohortAnalyzer instance.
    
    Args:
        db_service: Optional database service instance
        
    Returns:
        Configured CohortAnalyzer instance
    """
    return CohortAnalyzer(db_service=db_service)
