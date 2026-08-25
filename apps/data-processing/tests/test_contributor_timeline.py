from datetime import datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.db.models import Base
from src.db.postgres_service import PostgresService


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


def test_get_contributor_activity_timeline_by_contributor() -> None:
    service = build_sqlite_service()
    contributor = "GCONTRIB123"

    service.save_contract_event(
        contract_id="contract-1",
        event_id="evt-1",
        ledger=100,
        event_type="DepositEvent",
        project_id=1,
        contributor=contributor,
        amount=50.0,
        timestamp=datetime(2026, 6, 1, 12, 0, 0),
    )
    service.save_contract_event(
        contract_id="contract-1",
        event_id="evt-2",
        ledger=101,
        event_type="ContributionRecordedEvent",
        project_id=1,
        contributor=contributor,
        amount=150.0,
        timestamp=datetime(2026, 6, 1, 13, 0, 0),
    )
    service.save_contract_event(
        contract_id="contract-2",
        event_id="evt-3",
        ledger=102,
        event_type="Reward_Granted",
        project_id=2,
        contributor=contributor,
        amount=25.0,
        timestamp=datetime(2026, 6, 2, 10, 0, 0),
    )

    timeline = service.get_contributor_activity_timeline(
        contributor=contributor,
        ascending=True,
        limit=10,
    )

    assert len(timeline) == 3
    assert timeline[0]["event_id"] == "evt-1"
    assert timeline[1]["event_id"] == "evt-2"
    assert timeline[2]["event_id"] == "evt-3"
    assert timeline[0]["category"] == "contribution"
    assert timeline[2]["category"] == "reward"


def test_get_contributor_activity_timeline_filtered_by_project() -> None:
    service = build_sqlite_service()
    contributor = "GCONTRIB124"

    service.save_contract_event(
        contract_id="contract-1",
        event_id="evt-1",
        ledger=100,
        event_type="DepositEvent",
        project_id=1,
        contributor=contributor,
        amount=50.0,
        timestamp=datetime(2026, 6, 1, 12, 0, 0),
    )
    service.save_contract_event(
        contract_id="contract-2",
        event_id="evt-2",
        ledger=110,
        event_type="Reward_Granted",
        project_id=2,
        contributor=contributor,
        amount=100.0,
        timestamp=datetime(2026, 6, 2, 12, 0, 0),
    )

    timeline = service.get_contributor_activity_timeline(
        contributor=contributor,
        project_id=1,
        ascending=True,
        limit=10,
    )

    assert len(timeline) == 1
    assert timeline[0]["project_id"] == 1
    assert timeline[0]["event_id"] == "evt-1"
