"""Tests for the metadata drift detector (#882)."""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.db.models import Base
from src.db.postgres_service import PostgresService
from src.metadata_drift_detector import MetadataDriftDetector


def build_sqlite_service() -> PostgresService:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)

    service = PostgresService.__new__(PostgresService)
    service.database_url = "sqlite:///:memory:"
    service.engine = engine
    service.SessionLocal = sessionmaker(
        autocommit=False,
        autoflush=False,
        expire_on_commit=False,
        bind=engine,
    )
    return service


def _ts(offset_seconds: int = 0) -> datetime:
    return datetime.now(timezone.utc) + timedelta(seconds=offset_seconds)


def test_no_drift_when_view_matches_events():
    service = build_sqlite_service()

    service.save_contract_event(
        contract_id="CCONTRACT1",
        event_id="evt-1",
        ledger=100,
        event_type="DepositEvent",
        project_id=1,
        contributor="GALICE",
        amount=50.0,
        status="active",
        timestamp=_ts(0),
    )
    service.save_contract_event(
        contract_id="CCONTRACT1",
        event_id="evt-2",
        ledger=101,
        event_type="ContributionRecordedEvent",
        project_id=1,
        contributor="GBOB",
        amount=25.0,
        timestamp=_ts(1),
    )

    service.save_project_view(
        project_id=1,
        contract_id="CCONTRACT1",
        status="active",
        add_total_contributions=75.0,
        unique_contributors=2,
        last_event_ledger=101,
    )

    detector = MetadataDriftDetector(db_service=service)
    report = detector.run_for_project(1)

    assert report.projects_checked == 1
    assert report.drift_detected is False
    assert report.findings == []


def test_detects_status_and_amount_drift():
    service = build_sqlite_service()

    service.save_contract_event(
        contract_id="CCONTRACT2",
        event_id="evt-1",
        ledger=200,
        event_type="DepositEvent",
        project_id=2,
        contributor="GALICE",
        amount=100.0,
        status="completed",
        timestamp=_ts(0),
    )

    # Backend view is stale: status still "active", contributions undercounted.
    service.save_project_view(
        project_id=2,
        contract_id="CCONTRACT2",
        status="active",
        add_total_contributions=10.0,
        unique_contributors=1,
        last_event_ledger=200,
    )

    detector = MetadataDriftDetector(db_service=service)
    report = detector.run_for_project(2)

    assert report.drift_detected is True
    fields = {f.field for f in report.findings}
    assert "status" in fields
    assert "total_contributions" in fields

    status_finding = next(f for f in report.findings if f.field == "status")
    assert status_finding.backend_value == "active"
    assert status_finding.chain_derived_value == "completed"
    assert status_finding.severity == "critical"


def test_detects_missing_project_view():
    service = build_sqlite_service()

    service.save_contract_event(
        contract_id="CCONTRACT3",
        event_id="evt-1",
        ledger=300,
        event_type="DepositEvent",
        project_id=3,
        contributor="GALICE",
        amount=10.0,
        timestamp=_ts(0),
    )

    detector = MetadataDriftDetector(db_service=service)
    report = detector.run_for_project(3)

    assert report.drift_detected is True
    assert report.findings[0].field == "missing_project_view"
    assert report.findings[0].severity == "critical"


def test_detects_milestone_status_drift():
    service = build_sqlite_service()

    service.save_contract_event(
        contract_id="CCONTRACT4",
        event_id="evt-1",
        ledger=400,
        event_type="MilestoneApprovedEvent",
        project_id=4,
        milestone_id=1,
        status="approved",
        timestamp=_ts(0),
    )
    service.save_project_view(project_id=4, contract_id="CCONTRACT4", status="active")
    service.save_project_milestone(project_id=4, milestone_id=1, status="pending")

    detector = MetadataDriftDetector(db_service=service)
    report = detector.run_for_project(4)

    milestone_findings = [f for f in report.findings if f.scope == "milestone"]
    assert len(milestone_findings) == 1
    assert milestone_findings[0].field == "status"
    assert milestone_findings[0].backend_value == "pending"
    assert milestone_findings[0].chain_derived_value == "approved"


def test_does_not_mutate_source_records():
    """Acceptance criterion: detector must not mutate backend records."""
    service = build_sqlite_service()

    service.save_contract_event(
        contract_id="CCONTRACT5",
        event_id="evt-1",
        ledger=500,
        event_type="DepositEvent",
        project_id=5,
        contributor="GALICE",
        amount=100.0,
        status="completed",
        timestamp=_ts(0),
    )
    service.save_project_view(
        project_id=5,
        contract_id="CCONTRACT5",
        status="active",
        add_total_contributions=10.0,
    )

    detector = MetadataDriftDetector(db_service=service)
    detector.run_for_project(5)

    backend_view = service.get_project_view(5)
    # Still the stale, pre-drift-detection values — detector did not mutate them.
    assert backend_view.status == "active"
    assert backend_view.total_contributions == 10.0


def test_run_for_project_with_no_events_reports_nothing():
    service = build_sqlite_service()
    detector = MetadataDriftDetector(db_service=service)
    report = detector.run_for_project(999)

    assert report.projects_checked == 0
    assert report.drift_detected is False


def test_run_all_checks_every_project_with_events():
    service = build_sqlite_service()

    for project_id in (10, 11):
        service.save_contract_event(
            contract_id=f"CCONTRACT{project_id}",
            event_id="evt-1",
            ledger=100,
            event_type="DepositEvent",
            project_id=project_id,
            contributor="GALICE",
            amount=10.0,
            status="active",
            timestamp=_ts(0),
        )

    # Only one of the two gets a matching backend view.
    service.save_project_view(
        project_id=10,
        contract_id="CCONTRACT10",
        status="active",
        add_total_contributions=10.0,
        unique_contributors=1,
        last_event_ledger=100,
    )

    detector = MetadataDriftDetector(db_service=service)
    report = detector.run_all(limit=10)

    assert report.projects_checked == 2
    assert report.drift_detected is True
    assert any(f.project_id == 11 and f.field == "missing_project_view" for f in report.findings)


def test_run_and_persist_writes_findings_for_review():
    service = build_sqlite_service()

    service.save_contract_event(
        contract_id="CCONTRACT6",
        event_id="evt-1",
        ledger=600,
        event_type="DepositEvent",
        project_id=6,
        contributor="GALICE",
        amount=100.0,
        status="completed",
        timestamp=_ts(0),
    )
    service.save_project_view(project_id=6, contract_id="CCONTRACT6", status="active")

    detector = MetadataDriftDetector(db_service=service)
    report = detector.run_and_persist(project_id=6)

    assert report.drift_detected is True

    persisted = service.get_metadata_drift_findings(run_id=report.run_id)
    assert len(persisted) == len(report.findings)
    assert all(f.reviewed is False for f in persisted)
