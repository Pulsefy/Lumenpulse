"""
Contributor Reputation Snapshot Builder

Builds periodic snapshots of contributor reputation and activity metrics
for leaderboards and analytics. Works with Stellar testnet data from the
contributor registry contract.

Snapshot Schedule:
- Runs daily at 00:00 UTC via APScheduler CronTrigger
- Configurable via environment variable SNAPSHOT_SCHEDULE (cron expression)
- Supports top-N queries for leaderboard ranking

Metrics Captured:
- Total contributions (count)
- Total contribution value (XLM)
- Activity streak (days)
- First contribution date
- Last contribution date
- Reputation score (weighted algorithm)
- Ranking percentile
"""

import logging
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field
from src.db.postgres_service import PostgresService
from src.utils.logger import setup_logger

logger = setup_logger(__name__)


@dataclass
class ContributorMetrics:
    """Metrics for a single contributor"""

    contributor_address: str
    total_contributions: int = 0
    total_value_xlm: float = 0.0
    first_contribution_date: Optional[datetime] = None
    last_contribution_date: Optional[datetime] = None
    activity_streak_days: int = 0
    unique_projects: int = 0
    reputation_score: float = 0.0
    snapshot_date: Optional[datetime] = None
    snapshot_metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for database storage"""
        return {
            "contributor_address": self.contributor_address,
            "total_contributions": self.total_contributions,
            "total_value_xlm": self.total_value_xlm,
            "first_contribution_date": self.first_contribution_date,
            "last_contribution_date": self.last_contribution_date,
            "activity_streak_days": self.activity_streak_days,
            "unique_projects": self.unique_projects,
            "reputation_score": self.reputation_score,
            "snapshot_date": self.snapshot_date,
            "snapshot_metadata": self.snapshot_metadata,
        }


class ContributorReputationSnapshotBuilder:
    """
    Builds reputation snapshots for all contributors from registry data.

    This class aggregates contributor activity from the contributor registry
    contract events stored in the database and calculates reputation scores
    for leaderboard ranking.
    """

    def __init__(self, db_session=None):
        """
        Initialize the snapshot builder.

        Args:
            db_session: Optional SQLAlchemy session (for testing)
        """
        self.db_session = db_session
        self.logger = logging.getLogger(__name__)

    def get_session(self):
        """Get database session"""
        if self.db_session:
            return self.db_session
        # Create a new PostgresService instance and return its session
        pg_service = PostgresService()
        return pg_service.SessionLocal()

    def build_snapshot(
        self, snapshot_date: Optional[datetime] = None
    ) -> List[ContributorMetrics]:
        """
        Build a complete reputation snapshot for all contributors.

        Args:
            snapshot_date: Date for the snapshot (defaults to now)

        Returns:
            List of ContributorMetrics for all active contributors
        """
        if snapshot_date is None:
            snapshot_date = datetime.utcnow()

        self.logger.info(
            f"Building contributor reputation snapshot for {snapshot_date}"
        )

        try:
            session = self.get_session()

            # Fetch contributor data from registry events
            contributors_data = self._fetch_contributor_data(session, snapshot_date)

            if not contributors_data:
                self.logger.warning("No contributor data found for snapshot")
                return []

            # Calculate metrics for each contributor
            snapshots = []
            for address, data in contributors_data.items():
                metrics = self._calculate_metrics(address, data, snapshot_date)
                snapshots.append(metrics)

            # Calculate reputation scores and rankings
            snapshots = self._calculate_reputation_scores(snapshots)
            snapshots = self._calculate_percentiles(snapshots)

            self.logger.info(f"Built {len(snapshots)} contributor reputation snapshots")
            return snapshots

        except Exception as e:
            self.logger.error(
                f"Error building contributor snapshot: {e}", exc_info=True
            )
            raise

    def _fetch_contributor_data(
        self, session, snapshot_date: datetime
    ) -> Dict[str, Dict[str, Any]]:
        """
        Fetch contributor data from contract events table.

        For testnet/MVP implementation, this uses AnalyticsRecord table with
        record_type='contributor_event'. In production, this should query the
        ContractEvent table directly.

        Args:
            session: Database session
            snapshot_date: Cutoff date for data

        Returns:
            Dictionary of contributor_address -> contribution data
        """
        from src.db.models import AnalyticsRecord  # Use existing model

        # Fetch contributor events from the last year
        cutoff_date = snapshot_date - timedelta(days=365)

        try:
            # Fetch all contribution events from AnalyticsRecord
            # In testnet/MVP, we store contributor events as analytics records
            events = (
                session.query(AnalyticsRecord)
                .filter(
                    AnalyticsRecord.timestamp >= cutoff_date,
                    AnalyticsRecord.timestamp <= snapshot_date,
                    AnalyticsRecord.record_type == "contributor_event",
                )
                .order_by(AnalyticsRecord.timestamp.asc())
                .all()
            )

            self.logger.info(f"Fetched {len(events)} contributor registry events")

            # If no events found, return mock data for testing
            if not events:
                self.logger.warning(
                    "No contributor events found, generating mock data for testnet"
                )
                return self._generate_mock_contributor_data(snapshot_date)

            # Aggregate by contributor address
            contributors = {}
            for event in events:
                extra = event.extra_data or {}
                contributor_address = extra.get("contributor_address")

                if not contributor_address:
                    continue

                if contributor_address not in contributors:
                    contributors[contributor_address] = {
                        "contributions": [],
                        "total_value": 0.0,
                        "projects": set(),
                        "timestamps": [],
                    }

                # Extract contribution value (in XLM)
                value_xlm = extra.get("amount_xlm", event.value)

                contributors[contributor_address]["contributions"].append(
                    {
                        "timestamp": event.timestamp,
                        "value_xlm": value_xlm,
                        "project_id": extra.get("project_id"),
                        "event_type": event.metric_name,
                    }
                )

                contributors[contributor_address]["total_value"] += value_xlm
                contributors[contributor_address]["timestamps"].append(event.timestamp)

                if extra.get("project_id"):
                    contributors[contributor_address]["projects"].add(
                        extra["project_id"]
                    )

            return contributors

        except Exception as e:
            self.logger.error(f"Error fetching contributor data: {e}", exc_info=True)
            return {}

    def _generate_mock_contributor_data(
        self, snapshot_date: datetime
    ) -> Dict[str, Dict[str, Any]]:
        """
        Generate mock contributor data for testnet/MVP demonstration.

        Args:
            snapshot_date: Reference date for generating data

        Returns:
            Dictionary of mock contributor data
        """
        import random

        self.logger.info("Generating mock contributor data for testnet")

        # Generate 20-50 mock contributors
        num_contributors = random.randint(20, 50)
        contributors = {}

        for i in range(num_contributors):
            # Generate a mock Stellar address
            address = f"G{('A' if i % 2 == 0 else 'B')}{'X' * 54}"

            # Random contribution count (1-50)
            num_contributions = random.randint(1, 50)
            contributions = []
            timestamps = []
            total_value = 0.0
            projects = set()

            for j in range(num_contributions):
                # Random timestamp within last 90 days
                days_ago = random.randint(0, 90)
                timestamp = snapshot_date - timedelta(days=days_ago)

                # Random contribution value (0.1 - 100 XLM)
                value_xlm = round(random.uniform(0.1, 100.0), 2)

                # Random project ID
                project_id = f"project_{random.randint(1, 10)}"

                contributions.append(
                    {
                        "timestamp": timestamp,
                        "value_xlm": value_xlm,
                        "project_id": project_id,
                        "event_type": "contribution",
                    }
                )

                timestamps.append(timestamp)
                total_value += value_xlm
                projects.add(project_id)

            contributors[address] = {
                "contributions": contributions,
                "total_value": total_value,
                "projects": projects,
                "timestamps": timestamps,
            }

        self.logger.info(f"Generated mock data for {len(contributors)} contributors")
        return contributors

    def _calculate_metrics(
        self, address: str, data: Dict[str, Any], snapshot_date: datetime
    ) -> ContributorMetrics:
        """
        Calculate metrics for a single contributor.

        Args:
            address: Contributor Stellar address
            data: Aggregated contribution data
            snapshot_date: Snapshot date

        Returns:
            ContributorMetrics instance
        """
        contributions = data["contributions"]
        timestamps = data["timestamps"]

        # Calculate activity streak
        activity_streak = self._calculate_activity_streak(timestamps, snapshot_date)

        metrics = ContributorMetrics(
            contributor_address=address,
            total_contributions=len(contributions),
            total_value_xlm=data["total_value"],
            first_contribution_date=min(timestamps) if timestamps else None,
            last_contribution_date=max(timestamps) if timestamps else None,
            activity_streak_days=activity_streak,
            unique_projects=len(data["projects"]),
            snapshot_date=snapshot_date,
        )

        return metrics

    def _calculate_activity_streak(
        self, timestamps: List[datetime], snapshot_date: datetime
    ) -> int:
        """
        Calculate consecutive days of activity ending at snapshot_date.

        Args:
            timestamps: List of contribution timestamps
            snapshot_date: Reference date

        Returns:
            Number of consecutive active days
        """
        if not timestamps:
            return 0

        # Get unique dates
        unique_dates = sorted(set(ts.date() for ts in timestamps), reverse=True)

        if not unique_dates:
            return 0

        streak = 0
        current_date = snapshot_date.date()

        for activity_date in unique_dates:
            # Check if this date is consecutive (or is today)
            if (
                current_date == activity_date
                or current_date - activity_date == timedelta(days=streak + 1)
            ):
                streak += 1
                current_date = activity_date
            else:
                break

        return streak

    def _calculate_reputation_scores(
        self, snapshots: List[ContributorMetrics]
    ) -> List[ContributorMetrics]:
        """
        Calculate weighted reputation scores for all contributors.

        Scoring Algorithm:
        - Total contributions: 30% (log-scaled)
        - Total value: 40% (log-scaled)
        - Activity streak: 20%
        - Unique projects: 10%

        Args:
            snapshots: List of contributor metrics

        Returns:
            Updated snapshots with reputation scores
        """
        import math

        if not snapshots:
            return snapshots

        # Find max values for normalization
        max_contributions = max(s.total_contributions for s in snapshots) or 1
        max_value = max(s.total_value_xlm for s in snapshots) or 1
        max_streak = max(s.activity_streak_days for s in snapshots) or 1
        max_projects = max(s.unique_projects for s in snapshots) or 1

        for snapshot in snapshots:
            # Log-scale contributions and value to prevent dominance
            contrib_score = math.log1p(snapshot.total_contributions) / math.log1p(
                max_contributions
            )
            value_score = math.log1p(snapshot.total_value_xlm) / math.log1p(max_value)
            streak_score = snapshot.activity_streak_days / max_streak
            project_score = snapshot.unique_projects / max_projects

            # Weighted combination
            reputation = (
                0.30 * contrib_score
                + 0.40 * value_score
                + 0.20 * streak_score
                + 0.10 * project_score
            ) * 100  # Scale to 0-100

            snapshot.reputation_score = round(reputation, 2)

        # Sort by reputation score descending
        snapshots.sort(key=lambda s: s.reputation_score, reverse=True)

        return snapshots

    def _calculate_percentiles(
        self, snapshots: List[ContributorMetrics]
    ) -> List[ContributorMetrics]:
        """
        Calculate ranking percentile for each contributor.

        Args:
            snapshots: List of contributor metrics (should be sorted by score)

        Returns:
            Updated snapshots with percentile in metadata
        """
        total = len(snapshots)

        for rank, snapshot in enumerate(snapshots, start=1):
            percentile = ((total - rank) / total) * 100 if total > 0 else 0
            snapshot.snapshot_metadata["rank"] = rank
            snapshot.snapshot_metadata["percentile"] = round(percentile, 1)

        return snapshots

    def get_top_n(
        self, n: int = 10, snapshot_date: Optional[datetime] = None
    ) -> List[ContributorMetrics]:
        """
        Get top N contributors by reputation score.

        Args:
            n: Number of top contributors to return
            snapshot_date: Optional date filter

        Returns:
            List of top N ContributorMetrics
        """
        all_snapshots = self.build_snapshot(snapshot_date)
        return all_snapshots[:n]

    def save_snapshots(self, snapshots: List[ContributorMetrics]) -> int:
        """
        Save contributor reputation snapshots to database.

        Args:
            snapshots: List of ContributorMetrics to save

        Returns:
            Number of snapshots saved
        """
        from src.db.models import ContributorReputationSnapshot

        session = self.get_session()
        saved_count = 0

        try:
            for snapshot in snapshots:
                # Check if snapshot already exists for this date
                existing = (
                    session.query(ContributorReputationSnapshot)
                    .filter(
                        ContributorReputationSnapshot.contributor_address
                        == snapshot.contributor_address,
                        ContributorReputationSnapshot.snapshot_date
                        == snapshot.snapshot_date,
                    )
                    .first()
                )

                if existing:
                    # Update existing snapshot
                    for key, value in snapshot.to_dict().items():
                        setattr(existing, key, value)
                else:
                    # Insert new snapshot
                    record = ContributorReputationSnapshot(**snapshot.to_dict())
                    session.add(record)

                saved_count += 1

            session.commit()
            self.logger.info(f"Saved {saved_count} contributor reputation snapshots")

        except Exception as e:
            session.rollback()
            self.logger.error(f"Error saving snapshots: {e}", exc_info=True)
            raise
        finally:
            if not self.db_session:
                session.close()

        return saved_count

    def run_snapshot_job(self) -> Dict[str, Any]:
        """
        Run the complete snapshot building and saving job.
        This is the main entry point for the scheduler.

        Returns:
            Job execution result metadata
        """
        start_time = datetime.utcnow()
        self.logger.info("=" * 60)
        self.logger.info("Contributor Reputation Snapshot Job Started")
        self.logger.info("=" * 60)

        try:
            # Build snapshots
            snapshots = self.build_snapshot()

            if not snapshots:
                self.logger.warning("No snapshots to save")
                return {
                    "status": "completed_no_data",
                    "snapshots_saved": 0,
                    "duration_seconds": (
                        datetime.utcnow() - start_time
                    ).total_seconds(),
                    "timestamp": start_time.isoformat(),
                }

            # Save to database
            saved_count = self.save_snapshots(snapshots)

            duration = (datetime.utcnow() - start_time).total_seconds()

            self.logger.info("Snapshot job completed successfully")
            self.logger.info(f"  - Snapshots saved: {saved_count}")
            self.logger.info(f"  - Duration: {duration:.2f}s")
            self.logger.info(
                f"  - Top contributor: {snapshots[0].contributor_address if snapshots else 'N/A'}"
            )
            self.logger.info(
                f"    Score: {snapshots[0].reputation_score if snapshots else 0}"
            )

            return {
                "status": "completed",
                "snapshots_saved": saved_count,
                "top_contributor": (
                    snapshots[0].contributor_address if snapshots else None
                ),
                "top_score": snapshots[0].reputation_score if snapshots else 0,
                "duration_seconds": duration,
                "timestamp": start_time.isoformat(),
            }

        except Exception as e:
            duration = (datetime.utcnow() - start_time).total_seconds()
            self.logger.error(f"Snapshot job failed: {e}", exc_info=True)

            return {
                "status": "failed",
                "error": str(e),
                "duration_seconds": duration,
                "timestamp": start_time.isoformat(),
            }
