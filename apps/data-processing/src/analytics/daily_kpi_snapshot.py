"""
Daily On-Chain KPI Snapshot Scheduler Generator (#877)

Persists daily snapshots of core on-chain KPIs (TVL, volume, active rounds,
contribution counts, and unique contributors) so trend analysis is cheap and consistent.

Key Capabilities:
- Calculates TVL, 24h volume, active rounds count, and daily contribution counts.
- Enforces idempotency by skipping creation if a snapshot for the date/period already exists.
- Supports historical snapshot backfilling and automated daily execution via APScheduler.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from sqlalchemy import select, func, and_

from src.utils.logger import setup_logger
from src.db.postgres_service import PostgresService
from src.db.models import (
    ContractEvent,
    ProjectView,
    ProjectContributor,
    DailyOnchainKPISnapshot,
)
from src.db.cohort_models import GrantRound

logger = setup_logger(__name__)

# Event types considered positive contributions
_POSITIVE_CONTRIBUTION_EVENT_TYPES = (
    "depositevent",
    "contributionrecordedevent",
)

# Event types considered negative contributions (refunds/clawbacks)
_NEGATIVE_CONTRIBUTION_EVENT_TYPES = (
    "contributionrefundableevent",
    "contributionclawbackedevent",
)

_ALL_CONTRIBUTION_EVENT_TYPES = (
    _POSITIVE_CONTRIBUTION_EVENT_TYPES + _NEGATIVE_CONTRIBUTION_EVENT_TYPES
)


@dataclass
class KPISnapshotMetrics:
    """Aggregated core on-chain KPI metrics for a snapshot period."""

    snapshot_date: str
    period: str = "daily"
    tvl: float = 0.0
    volume: float = 0.0
    active_rounds: int = 0
    contribution_count: int = 0
    unique_contributors: int = 0
    extra_data: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "snapshot_date": self.snapshot_date,
            "period": self.period,
            "tvl": round(self.tvl, 6),
            "volume": round(self.volume, 6),
            "active_rounds": self.active_rounds,
            "contribution_count": self.contribution_count,
            "unique_contributors": self.unique_contributors,
            "extra_data": self.extra_data,
        }


def _parse_date_range(target_date: str) -> tuple[datetime, datetime]:
    """Return (start_of_day_utc, end_of_day_utc) for the given YYYY-MM-DD string."""
    naive = datetime.strptime(target_date, "%Y-%m-%d")
    start = naive.replace(tzinfo=timezone.utc)
    end = start.replace(hour=23, minute=59, second=59, microsecond=999999)
    return start, end


class DailyKPISnapshotGenerator:
    """
    Computes and persists daily snapshots of core on-chain KPIs.
    """

    def __init__(self, db_service: Optional[PostgresService] = None):
        self.db_service = db_service or PostgresService()

    def compute_metrics(
        self, target_date: Optional[str] = None, period: str = "daily"
    ) -> KPISnapshotMetrics:
        """
        Compute on-chain KPI metrics for the given date (default: today UTC YYYY-MM-DD).

        Args:
            target_date: Date string in format "YYYY-MM-DD".
            period: Period name (default: "daily").

        Returns:
            KPISnapshotMetrics object.
        """
        if not target_date:
            target_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        day_start, day_end = _parse_date_range(target_date)

        with self.db_service.get_session() as session:
            # 1. TVL — sum of all project total_contributions (current state, not date-filtered)
            tvl = session.execute(
                select(func.coalesce(func.sum(ProjectView.total_contributions), 0.0))
            ).scalar() or 0.0
            tvl = float(tvl)

            projects_count = session.execute(
                select(func.count()).select_from(ProjectView)
            ).scalar() or 0

            # 2. Active rounds
            active_rounds = session.execute(
                select(func.count()).select_from(GrantRound).where(
                    GrantRound.status == "active"
                )
            ).scalar() or 0

            # Fallback: count active projects if no GrantRound rows populated yet
            if active_rounds == 0 and projects_count > 0:
                active_rounds = session.execute(
                    select(func.count()).select_from(ProjectView).where(
                        func.lower(ProjectView.status).in_(("active", "open"))
                    )
                ).scalar() or 0

            # 3. Daily volume — net amount from contribution events on target_date only.
            #    Positive events add; negative events subtract.
            positive_volume = session.execute(
                select(func.coalesce(func.sum(ContractEvent.amount), 0.0)).where(
                    and_(
                        ContractEvent.timestamp >= day_start,
                        ContractEvent.timestamp <= day_end,
                        func.lower(ContractEvent.event_type).in_(
                            _POSITIVE_CONTRIBUTION_EVENT_TYPES
                        ),
                    )
                )
            ).scalar() or 0.0

            negative_volume = session.execute(
                select(func.coalesce(func.sum(ContractEvent.amount), 0.0)).where(
                    and_(
                        ContractEvent.timestamp >= day_start,
                        ContractEvent.timestamp <= day_end,
                        func.lower(ContractEvent.event_type).in_(
                            _NEGATIVE_CONTRIBUTION_EVENT_TYPES
                        ),
                    )
                )
            ).scalar() or 0.0

            volume = float(positive_volume) - float(negative_volume)
            if volume < 0:
                volume = 0.0

            # 4. Daily contribution count — net count on target_date
            positive_count = session.execute(
                select(func.count()).select_from(ContractEvent).where(
                    and_(
                        ContractEvent.timestamp >= day_start,
                        ContractEvent.timestamp <= day_end,
                        func.lower(ContractEvent.event_type).in_(
                            _POSITIVE_CONTRIBUTION_EVENT_TYPES
                        ),
                    )
                )
            ).scalar() or 0

            negative_count = session.execute(
                select(func.count()).select_from(ContractEvent).where(
                    and_(
                        ContractEvent.timestamp >= day_start,
                        ContractEvent.timestamp <= day_end,
                        func.lower(ContractEvent.event_type).in_(
                            _NEGATIVE_CONTRIBUTION_EVENT_TYPES
                        ),
                    )
                )
            ).scalar() or 0

            contribution_count = max(positive_count - negative_count, 0)

            # 5. Unique daily contributors — distinct contributors on target_date
            unique_contributors = session.execute(
                select(func.count(func.distinct(ContractEvent.contributor))).where(
                    and_(
                        ContractEvent.timestamp >= day_start,
                        ContractEvent.timestamp <= day_end,
                        ContractEvent.contributor.isnot(None),
                        ContractEvent.contributor != "",
                        func.lower(ContractEvent.event_type).in_(
                            _POSITIVE_CONTRIBUTION_EVENT_TYPES
                        ),
                    )
                )
            ).scalar() or 0

            # Fallback: all-time unique contributors from ProjectContributor if zero
            if unique_contributors == 0:
                unique_contributors = session.execute(
                    select(
                        func.count(func.distinct(ProjectContributor.contributor))
                    ).where(
                        and_(
                            ProjectContributor.contributor.isnot(None),
                            ProjectContributor.contributor != "",
                        )
                    )
                ).scalar() or 0

        extra_data = {
            "projects_count": projects_count,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

        return KPISnapshotMetrics(
            snapshot_date=target_date,
            period=period,
            tvl=tvl,
            volume=volume,
            active_rounds=active_rounds,
            contribution_count=contribution_count,
            unique_contributors=unique_contributors,
            extra_data=extra_data,
        )

    def run_snapshot(
        self, target_date: Optional[str] = None, period: str = "daily"
    ) -> Dict[str, Any]:
        """
        Compute and save the KPI snapshot.
        If a snapshot for the target date/period already exists, skips writing.

        Returns:
            Dict containing status ("created" or "skipped"), date, and snapshot details.
        """
        if not target_date:
            target_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        metrics = self.compute_metrics(target_date=target_date, period=period)
        snapshot_dict = metrics.to_dict()

        saved_snapshot, created = self.db_service.save_daily_onchain_kpi_snapshot(snapshot_dict)

        if not created:
            logger.info(
                f"Skipped duplicate KPI snapshot for date={target_date} period={period}"
            )
            return {
                "status": "skipped",
                "message": f"Snapshot for date {target_date} and period '{period}' already exists.",
                "date": target_date,
                "period": period,
                "tvl": saved_snapshot.tvl if saved_snapshot else metrics.tvl,
                "volume": saved_snapshot.volume if saved_snapshot else metrics.volume,
                "active_rounds": saved_snapshot.active_rounds if saved_snapshot else metrics.active_rounds,
                "contribution_count": saved_snapshot.contribution_count if saved_snapshot else metrics.contribution_count,
                "unique_contributors": saved_snapshot.unique_contributors if saved_snapshot else metrics.unique_contributors,
            }

        logger.info(
            f"Successfully created daily KPI snapshot for date={target_date} period={period}"
        )
        return {
            "status": "created",
            "message": f"Snapshot created successfully for date {target_date}.",
            "date": target_date,
            "period": period,
            "tvl": saved_snapshot.tvl,
            "volume": saved_snapshot.volume,
            "active_rounds": saved_snapshot.active_rounds,
            "contribution_count": saved_snapshot.contribution_count,
            "unique_contributors": saved_snapshot.unique_contributors,
        }
