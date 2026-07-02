"""
Metadata Drift Detector (#882)

Detects when off-chain backend metadata (ProjectView / ProjectMilestone
materialized views) falls out of sync with on-chain identifiers or status.

How it works
------------
ContractEvent rows are the raw, immutable record of events ingested from the
Soroban RPC event stream — they are the closest thing this service has to
ground-truth on-chain state. ProjectView and ProjectMilestone are mutable
"materialized view" tables that get incrementally updated as events arrive.

This detector recomputes canonical project/milestone state directly from the
ContractEvent log (independent of however ProjectView/ProjectMilestone were
last updated) and diffs it against what's currently persisted. Any mismatch
indicates the materialized view has drifted from on-chain reality — e.g. due
to a missed event, a bug in incremental update logic, or a partial write.

This module is strictly read-only with respect to ProjectView and
ProjectMilestone: it never mutates source data automatically. Findings are
written to a separate `metadata_drift_findings` table for maintainer review.
"""

from __future__ import annotations

import math
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import select

from src.utils.logger import setup_logger
from src.db.postgres_service import PostgresService
from src.db.models import ContractEvent, ProjectView, ProjectMilestone

logger = setup_logger(__name__)

# Event types that increase a project's recorded contribution total.
_POSITIVE_CONTRIBUTION_EVENT_TYPES = {
    "depositevent",
    "contributionrecordedevent",
}

# Event types that decrease a project's recorded contribution total.
_NEGATIVE_CONTRIBUTION_EVENT_TYPES = {
    "contributionrefundableevent",
    "contributionclawbackedevent",
}

# Numeric drift below this tolerance is treated as floating point noise,
# not a real discrepancy.
_AMOUNT_TOLERANCE = 1e-6

# Default severity per field — status/missing-record mismatches are more
# actionable than a momentum score that's merely stale.
_FIELD_SEVERITY = {
    "status": "critical",
    "total_contributions": "warning",
    "unique_contributors": "warning",
    "last_event_ledger": "info",
    "missing_project_view": "critical",
    "missing_milestone": "critical",
}


@dataclass
class DriftFinding:
    """A single field-level mismatch between backend and chain-derived state."""

    project_id: int
    scope: str  # "project" or "milestone"
    field: str
    backend_value: Any
    chain_derived_value: Any
    milestone_id: Optional[int] = None
    severity: str = "warning"
    detected_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> Dict[str, Any]:
        return {
            "project_id": self.project_id,
            "scope": self.scope,
            "milestone_id": self.milestone_id,
            "field": self.field,
            "backend_value": self.backend_value,
            "chain_derived_value": self.chain_derived_value,
            "severity": self.severity,
            "detected_at": self.detected_at.isoformat(),
        }


@dataclass
class DriftReport:
    """Aggregate result of a drift detection run across one or more projects."""

    run_id: str
    started_at: datetime
    completed_at: Optional[datetime] = None
    projects_checked: int = 0
    findings: List[DriftFinding] = field(default_factory=list)

    @property
    def drift_detected(self) -> bool:
        return len(self.findings) > 0

    @property
    def projects_with_drift(self) -> int:
        return len({f.project_id for f in self.findings})

    def to_dict(self) -> Dict[str, Any]:
        return {
            "run_id": self.run_id,
            "started_at": self.started_at.isoformat(),
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "projects_checked": self.projects_checked,
            "projects_with_drift": self.projects_with_drift,
            "findings_count": len(self.findings),
            "findings": [f.to_dict() for f in self.findings],
        }


@dataclass
class _ChainDerivedProjectState:
    project_id: int
    status: Optional[str]
    total_contributions: float
    unique_contributors: int
    last_event_ledger: Optional[int]
    milestones: Dict[int, str]  # milestone_id -> latest status


class MetadataDriftDetector:
    """
    Compares backend-persisted project/milestone records against state
    recomputed independently from the raw ContractEvent log.
    """

    def __init__(self, db_service: Optional[PostgresService] = None):
        self.db_service = db_service or PostgresService()

    # -- Chain-derived state recomputation -------------------------------

    def _compute_chain_derived_state(
        self, project_id: int
    ) -> Optional[_ChainDerivedProjectState]:
        """
        Recompute canonical project state purely from the ContractEvent log,
        ordered by ledger so later events win on conflicting fields.
        """
        with self.db_service.get_session() as session:
            events = (
                session.execute(
                    select(ContractEvent)
                    .where(ContractEvent.project_id == project_id)
                    .order_by(ContractEvent.ledger.asc())
                )
                .scalars()
                .all()
            )

            if not events:
                return None

            total_contributions = 0.0
            contributors: set = set()
            status: Optional[str] = None
            last_event_ledger: Optional[int] = None
            milestones: Dict[int, str] = {}

            for event in events:
                event_type = (event.event_type or "").lower()

                if event.amount is not None:
                    amount = float(event.amount)
                    if event_type in _POSITIVE_CONTRIBUTION_EVENT_TYPES:
                        total_contributions += amount
                    elif event_type in _NEGATIVE_CONTRIBUTION_EVENT_TYPES:
                        total_contributions -= amount

                if event.contributor:
                    contributors.add(event.contributor)

                if event.status:
                    if event.milestone_id is not None:
                        milestones[event.milestone_id] = event.status
                    else:
                        status = event.status

                if event.ledger is not None:
                    last_event_ledger = event.ledger

            return _ChainDerivedProjectState(
                project_id=project_id,
                status=status,
                total_contributions=round(total_contributions, 6),
                unique_contributors=len(contributors),
                last_event_ledger=last_event_ledger,
                milestones=milestones,
            )

    def _get_known_project_ids(self, limit: int) -> List[int]:
        """Project IDs that have at least one ingested contract event."""
        with self.db_service.get_session() as session:
            rows = session.execute(
                select(ContractEvent.project_id)
                .where(ContractEvent.project_id.isnot(None))
                .distinct()
                .limit(limit)
            ).all()
            return [row[0] for row in rows]

    # -- Comparison --------------------------------------------------------

    def _compare_project(
        self, chain_state: _ChainDerivedProjectState
    ) -> List[DriftFinding]:
        findings: List[DriftFinding] = []
        project_id = chain_state.project_id

        with self.db_service.get_session() as session:
            backend_view = session.execute(
                select(ProjectView).where(ProjectView.project_id == project_id)
            ).scalar_one_or_none()

            milestone_rows = session.execute(
                select(ProjectMilestone).where(
                    ProjectMilestone.project_id == project_id
                )
            ).scalars().all()
            backend_milestones = {m.milestone_id: m.status for m in milestone_rows}

        if backend_view is None:
            findings.append(
                DriftFinding(
                    project_id=project_id,
                    scope="project",
                    field="missing_project_view",
                    backend_value=None,
                    chain_derived_value="exists",
                    severity=_FIELD_SEVERITY["missing_project_view"],
                )
            )
        else:
            if chain_state.status is not None and backend_view.status != chain_state.status:
                findings.append(
                    DriftFinding(
                        project_id=project_id,
                        scope="project",
                        field="status",
                        backend_value=backend_view.status,
                        chain_derived_value=chain_state.status,
                        severity=_FIELD_SEVERITY["status"],
                    )
                )

            backend_total = float(backend_view.total_contributions or 0.0)
            if not math.isclose(
                backend_total,
                chain_state.total_contributions,
                abs_tol=_AMOUNT_TOLERANCE,
            ):
                findings.append(
                    DriftFinding(
                        project_id=project_id,
                        scope="project",
                        field="total_contributions",
                        backend_value=backend_total,
                        chain_derived_value=chain_state.total_contributions,
                        severity=_FIELD_SEVERITY["total_contributions"],
                    )
                )

            backend_contributors = int(backend_view.unique_contributors or 0)
            if backend_contributors != chain_state.unique_contributors:
                findings.append(
                    DriftFinding(
                        project_id=project_id,
                        scope="project",
                        field="unique_contributors",
                        backend_value=backend_contributors,
                        chain_derived_value=chain_state.unique_contributors,
                        severity=_FIELD_SEVERITY["unique_contributors"],
                    )
                )

            backend_ledger = backend_view.last_event_ledger
            if (
                chain_state.last_event_ledger is not None
                and backend_ledger is not None
                and backend_ledger < chain_state.last_event_ledger
            ):
                findings.append(
                    DriftFinding(
                        project_id=project_id,
                        scope="project",
                        field="last_event_ledger",
                        backend_value=backend_ledger,
                        chain_derived_value=chain_state.last_event_ledger,
                        severity=_FIELD_SEVERITY["last_event_ledger"],
                    )
                )

        for milestone_id, chain_status in chain_state.milestones.items():
            backend_status = backend_milestones.get(milestone_id)
            if backend_status is None:
                findings.append(
                    DriftFinding(
                        project_id=project_id,
                        scope="milestone",
                        milestone_id=milestone_id,
                        field="missing_milestone",
                        backend_value=None,
                        chain_derived_value=chain_status,
                        severity=_FIELD_SEVERITY["missing_milestone"],
                    )
                )
            elif backend_status != chain_status:
                findings.append(
                    DriftFinding(
                        project_id=project_id,
                        scope="milestone",
                        milestone_id=milestone_id,
                        field="status",
                        backend_value=backend_status,
                        chain_derived_value=chain_status,
                        severity=_FIELD_SEVERITY["status"],
                    )
                )

        return findings

    # -- Public entrypoints ------------------------------------------------

    def run_for_project(self, project_id: int) -> DriftReport:
        """Run drift detection for a single project. Read-only; no mutation."""
        report = DriftReport(
            run_id=str(uuid.uuid4()),
            started_at=datetime.now(timezone.utc),
        )

        chain_state = self._compute_chain_derived_state(project_id)
        if chain_state is None:
            logger.info(
                "Metadata drift check: no contract events found for project %s",
                project_id,
            )
            report.completed_at = datetime.now(timezone.utc)
            return report

        report.projects_checked = 1
        report.findings = self._compare_project(chain_state)
        report.completed_at = datetime.now(timezone.utc)
        return report

    def run_all(self, limit: int = 500) -> DriftReport:
        """
        Run drift detection across all projects that have at least one
        ingested contract event. Supports both scheduled and manual
        invocation; never mutates ProjectView/ProjectMilestone.
        """
        report = DriftReport(
            run_id=str(uuid.uuid4()),
            started_at=datetime.now(timezone.utc),
        )

        project_ids = self._get_known_project_ids(limit=limit)
        for project_id in project_ids:
            chain_state = self._compute_chain_derived_state(project_id)
            if chain_state is None:
                continue
            report.projects_checked += 1
            report.findings.extend(self._compare_project(chain_state))

        report.completed_at = datetime.now(timezone.utc)
        return report

    def run_and_persist(self, project_id: Optional[int] = None, limit: int = 500) -> DriftReport:
        """Run detection and persist any findings for maintainer review."""
        report = self.run_for_project(project_id) if project_id is not None else self.run_all(limit=limit)

        if report.findings:
            finding_dicts = [
                {
                    "run_id": report.run_id,
                    "project_id": f.project_id,
                    "scope": f.scope,
                    "milestone_id": f.milestone_id,
                    "field": f.field,
                    "backend_value": _stringify(f.backend_value),
                    "chain_derived_value": _stringify(f.chain_derived_value),
                    "severity": f.severity,
                    "detected_at": f.detected_at,
                }
                for f in report.findings
            ]
            saved = self.db_service.save_metadata_drift_findings(finding_dicts)
            logger.warning(
                "Metadata drift detected: run_id=%s projects_checked=%d "
                "projects_with_drift=%d findings=%d (persisted=%d)",
                report.run_id,
                report.projects_checked,
                report.projects_with_drift,
                len(report.findings),
                saved,
            )
        else:
            logger.info(
                "Metadata drift check complete: run_id=%s projects_checked=%d, no drift detected",
                report.run_id,
                report.projects_checked,
            )

        return report


def _stringify(value: Any) -> Optional[str]:
    if value is None:
        return None
    return str(value)


def run_manual_drift_check(project_id: Optional[int] = None) -> Dict[str, Any]:
    """Manually trigger a drift check (e.g. from a CLI script or API route)."""
    detector = MetadataDriftDetector()
    report = detector.run_and_persist(project_id=project_id)
    return report.to_dict()
