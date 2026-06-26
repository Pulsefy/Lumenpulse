"""Tests for persisted article on-chain entity links."""

from datetime import datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.analytics.ner_service import NERService
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
    service.ner_service = NERService()
    return service


def test_save_article_materializes_onchain_links() -> None:
    service = build_sqlite_service()
    service.save_project_view(
        project_id=101,
        contract_id="CBQPROJECT101",
        status="active",
        extra_data={
            "name": "Lumen Launch",
            "aliases": ["LumenLaunch"],
            "asset_code": "XLM",
        },
    )

    article = service.save_article(
        {
            "id": "article-link-1",
            "title": "Lumen Launch expands on Stellar",
            "content": "The project accepts XLM contributions on testnet.",
            "source": "test-source",
            "published_at": datetime.utcnow(),
        }
    )

    assert article is not None
    link_ids = {link["stable_id"] for link in article.onchain_entity_links}
    assert "project:101" in link_ids
    assert "asset:XLM" in link_ids

    normalized = service.get_article_onchain_links(article_id="article-link-1")
    normalized_ids = {link.stable_entity_id for link in normalized}
    assert {"project:101", "asset:XLM"}.issubset(normalized_ids)


def test_compute_project_funding_momentum_score_and_persisted_view() -> None:
    service = build_sqlite_service()
    project_id = 202

    service.save_contract_event(
        contract_id="contract-202",
        event_id="evt-1",
        ledger=100,
        event_type="DepositEvent",
        project_id=project_id,
        contributor="contrib-A",
        amount=150.0,
        timestamp=datetime.utcnow(),
    )
    service.save_contract_event(
        contract_id="contract-202",
        event_id="evt-2",
        ledger=101,
        event_type="ContributionRecordedEvent",
        project_id=project_id,
        contributor="contrib-B",
        amount=120.0,
        timestamp=datetime.utcnow(),
    )

    momentum = service.compute_project_funding_momentum_score(project_id=project_id)
    assert momentum > 0.0

    view = service.update_project_view_funding_momentum_score(project_id=project_id)
    assert view is not None
    assert view.project_id == project_id
    assert view.funding_momentum_score == momentum
