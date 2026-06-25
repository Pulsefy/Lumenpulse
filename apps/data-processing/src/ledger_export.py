"""
Ledger-Range Export Generator — Issue #883

Exports raw contract events and normalized project state (views, contributors,
milestones) for a specified Stellar ledger range to aid incident debugging.

Output format (single JSON file):
  {
    "metadata": {
      "startLedger": <int>,
      "endLedger": <int>,
      "exportTimestamp": "<ISO-8601>",
      "exportVersion": "1"
    },
    "raw": [...],        # ContractEvent rows in [startLedger, endLedger]
    "normalized": {
      "project_views": [...],
      "project_contributors": [...],
      "project_milestones": [...]
    }
  }
"""

import json
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from sqlalchemy import create_engine, select, and_
from sqlalchemy.orm import sessionmaker

from src.db.models import (
    ContractEvent,
    ProjectContributor,
    ProjectMilestone,
    ProjectView,
)

logger = logging.getLogger(__name__)

EXPORT_VERSION = "1"


def _validate_ledger_range(start_ledger: int, end_ledger: int) -> None:
    """Raise ValueError if the ledger range is invalid."""
    if not isinstance(start_ledger, int) or not isinstance(end_ledger, int):
        raise TypeError("start_ledger and end_ledger must be integers")
    if start_ledger < 0 or end_ledger < 0:
        raise ValueError("Ledger numbers must be non-negative")
    if start_ledger > end_ledger:
        raise ValueError(
            f"start_ledger ({start_ledger}) must be <= end_ledger ({end_ledger})"
        )


@dataclass
class LedgerExportResult:
    """Result of a ledger-range export operation."""

    path: str
    start_ledger: int
    end_ledger: int
    raw_count: int
    normalized_counts: Dict[str, int]
    status: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "path": self.path,
            "start_ledger": self.start_ledger,
            "end_ledger": self.end_ledger,
            "raw_count": self.raw_count,
            "normalized_counts": self.normalized_counts,
            "status": self.status,
        }


class LedgerRangeExporter:
    """
    Exports raw ContractEvent rows and normalized project-state tables
    for a given Stellar ledger range.

    Repeated execution is idempotent: output files are overwritten on each
    run without modifying source data.
    """

    def __init__(
        self,
        start_ledger: int,
        end_ledger: int,
        output_dir: str,
        database_url: Optional[str] = None,
    ) -> None:
        _validate_ledger_range(start_ledger, end_ledger)

        self.start_ledger = start_ledger
        self.end_ledger = end_ledger
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

        db_url = database_url or os.getenv(
            "DATABASE_URL",
            "postgresql://postgres:postgres@localhost:5432/lumenpulse",
        )
        engine = create_engine(db_url, pool_pre_ping=True, echo=False)
        self.Session = sessionmaker(bind=engine, expire_on_commit=False)

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _ledger_range_filter(self, column: Any) -> Any:
        return and_(column >= self.start_ledger, column <= self.end_ledger)

    def _output_path(self) -> Path:
        return (
            self.output_dir
            / f"ledger_export_{self.start_ledger}_{self.end_ledger}.json"
        )

    # ------------------------------------------------------------------
    # Data collection
    # ------------------------------------------------------------------

    def _fetch_raw(self, session: Any) -> List[Dict[str, Any]]:
        """Return ContractEvent rows within the ledger range."""
        rows = session.execute(
            select(ContractEvent).where(
                self._ledger_range_filter(ContractEvent.ledger)
            )
        ).scalars().all()

        return [
            {
                "id": r.id,
                "contract_id": r.contract_id,
                "event_id": r.event_id,
                "ledger": r.ledger,
                "event_type": r.event_type,
                "project_id": r.project_id,
                "contributor": r.contributor,
                "amount": r.amount,
                "milestone_id": r.milestone_id,
                "status": r.status,
                "topics": r.topics,
                "raw_data": r.raw_data,
                "timestamp": r.timestamp.isoformat() if r.timestamp else None,
            }
            for r in rows
        ]

    def _fetch_normalized(self, session: Any) -> Dict[str, List[Dict[str, Any]]]:
        """
        Return normalized project-state rows whose last_event_ledger falls
        within the ledger range, plus all project milestones and contributors
        whose last contributing ledger overlaps the range.
        """
        # ProjectView: last_event_ledger in range
        views = session.execute(
            select(ProjectView).where(
                self._ledger_range_filter(ProjectView.last_event_ledger)
            )
        ).scalars().all()

        # ProjectContributor: last_contribution_ledger in range
        contributors = session.execute(
            select(ProjectContributor).where(
                self._ledger_range_filter(ProjectContributor.last_contribution_ledger)
            )
        ).scalars().all()

        # ProjectMilestone: last_event_ledger in range
        milestones = session.execute(
            select(ProjectMilestone).where(
                self._ledger_range_filter(ProjectMilestone.last_event_ledger)
            )
        ).scalars().all()

        return {
            "project_views": [
                {
                    "id": v.id,
                    "project_id": v.project_id,
                    "contract_id": v.contract_id,
                    "owner": v.owner,
                    "total_contributions": v.total_contributions,
                    "unique_contributors": v.unique_contributors,
                    "status": v.status,
                    "last_event_ledger": v.last_event_ledger,
                    "extra_data": v.extra_data,
                }
                for v in views
            ],
            "project_contributors": [
                {
                    "id": c.id,
                    "project_id": c.project_id,
                    "contributor": c.contributor,
                    "total_contributed": c.total_contributed,
                    "first_contribution_ledger": c.first_contribution_ledger,
                    "last_contribution_ledger": c.last_contribution_ledger,
                    "extra_data": c.extra_data,
                }
                for c in contributors
            ],
            "project_milestones": [
                {
                    "id": m.id,
                    "project_id": m.project_id,
                    "milestone_id": m.milestone_id,
                    "status": m.status,
                    "approved_at": m.approved_at.isoformat() if m.approved_at else None,
                    "last_event_ledger": m.last_event_ledger,
                    "extra_data": m.extra_data,
                }
                for m in milestones
            ],
        }

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def export(self) -> LedgerExportResult:
        """
        Run the full export: raw events + normalized state.

        Writes a single JSON file and returns a LedgerExportResult.
        Safe to call multiple times; the output file is overwritten.
        """
        with self.Session() as session:
            raw = self._fetch_raw(session)
            normalized = self._fetch_normalized(session)

        normalized_counts = {k: len(v) for k, v in normalized.items()}

        payload: Dict[str, Any] = {
            "metadata": {
                "startLedger": self.start_ledger,
                "endLedger": self.end_ledger,
                "exportTimestamp": datetime.now(timezone.utc).isoformat(),
                "exportVersion": EXPORT_VERSION,
            },
            "raw": raw,
            "normalized": normalized,
        }

        out_path = self._output_path()
        with open(out_path, "w") as f:
            json.dump(payload, f, indent=2, default=str)

        result = LedgerExportResult(
            path=str(out_path),
            start_ledger=self.start_ledger,
            end_ledger=self.end_ledger,
            raw_count=len(raw),
            normalized_counts=normalized_counts,
            status="completed",
        )
        logger.info(
            "Ledger export complete: ledgers %d–%d, %d raw events, "
            "%d views / %d contributors / %d milestones → %s",
            self.start_ledger,
            self.end_ledger,
            len(raw),
            normalized_counts.get("project_views", 0),
            normalized_counts.get("project_contributors", 0),
            normalized_counts.get("project_milestones", 0),
            out_path,
        )
        return result
