"""Tests for the human-in-the-loop review queue for low-confidence entity linking."""

from datetime import datetime
from unittest.mock import patch
import pytest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.analytics.ner_service import NERService
from src.db.models import Base, EntityLinkingReview
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


def test_review_queue_routing_and_non_blocking() -> None:
    service = build_sqlite_service()

    # Save a project view so we have candidate display name and aliases
    service.save_project_view(
        project_id=400,
        contract_id="CBQPROJECT400",
        status="active",
        extra_data={
            "name": "Soroban Devs",
            "aliases": ["SorobanDevsAlias"],  # Alias match will yield 0.85 (low confidence)
            "asset_code": "SRB",
        },
    )

    # 1. Routing to review queue when alias is matched (low confidence < 0.90)
    article = service.save_article(
        {
            "id": "art-100",
            "title": "Article mentioning SorobanDevsAlias here",
            "content": "This is a detailed content explaining SorobanDevsAlias contributions.",
            "source": "test-source",
            "published_at": datetime.utcnow(),
        }
    )

    assert article is not None

    # Retrieve queue items
    queue_items = service.get_review_queue()
    assert len(queue_items) == 1
    item = queue_items[0]
    assert item.article_id == "art-100"
    assert item.stable_entity_id == "project:400"
    assert item.confidence == 0.85
    assert item.status == "pending"
    assert item.supporting_evidence is not None
    assert "SorobanDevsAlias" in item.supporting_evidence["matched_text"]
    assert "context_snippet" in item.supporting_evidence

    # 2. Pipeline remains non-blocking on database failure in review queue logging
    # We patch _sync_article_onchain_links to mock database execute failure inside it
    original_sync = service._sync_article_onchain_links
    def failing_sync(session, article, links):
        original_execute = session.execute
        def failing_execute(statement, *args, **kwargs):
            if "entity_linking_review_queue" in str(statement):
                raise Exception("Database Connection Loss")
            return original_execute(statement, *args, **kwargs)
        session.execute = failing_execute
        original_sync(session, article, links)

    with patch.object(service, "_sync_article_onchain_links", side_effect=failing_sync):
        article_non_blocking = service.save_article(
            {
                "id": "art-101",
                "title": "Another article mentioning SorobanDevsAlias",
                "content": "Content.",
                "source": "test-source",
                "published_at": datetime.utcnow(),
            }
        )
        # Ingestion should still succeed despite the review queue logging exception
        assert article_non_blocking is not None
        assert article_non_blocking.article_id == "art-101"


def test_reviewed_outcomes_overrides() -> None:
    service = build_sqlite_service()

    # Save multiple candidates to allow correction testing
    service.save_project_view(
        project_id=400,
        contract_id="CBQPROJECT400",
        status="active",
        extra_data={
            "name": "Soroban Devs",
            "aliases": ["SorobanDevsAlias"],
            "asset_code": "SRB",
        },
    )
    service.save_project_view(
        project_id=500,
        contract_id="CBQPROJECT500",
        status="active",
        extra_data={
            "name": "Other Project",
            "aliases": ["OtherProjectAlias"],
            "asset_code": "OTH",
        },
    )

    # Ingest an article to trigger the low confidence queue item
    service.save_article(
        {
            "id": "art-200",
            "title": "Article mentioning SorobanDevsAlias here",
            "content": "Content.",
            "source": "test-source",
            "published_at": datetime.utcnow(),
        }
    )

    queue = service.get_review_queue()
    assert len(queue) == 1
    item = queue[0]

    # A. Test Approve Outcome
    success = service.update_review_status(review_id=item.id, status="approved")
    assert success is True

    # Re-fetch article links to verify the override was applied
    links = service.get_article_onchain_links(article_id="art-200")
    assert len(links) == 1
    assert links[0].stable_entity_id == "project:400"
    assert links[0].confidence == 1.0  # Boosted to 1.0 because it's human approved

    # B. Test Correct Outcome
    success = service.update_review_status(review_id=item.id, status="corrected", corrected_entity_id="project:500")
    assert success is True

    links = service.get_article_onchain_links(article_id="art-200")
    assert len(links) == 1
    assert links[0].stable_entity_id == "project:500"  # Corrected to project 500
    assert links[0].confidence == 1.0  # Boosted to 1.0

    # C. Test Reject Outcome
    success = service.update_review_status(review_id=item.id, status="rejected")
    assert success is True

    links = service.get_article_onchain_links(article_id="art-200")
    assert len(links) == 0  # Link was rejected, so it is suppressed

    # Retrieve all reviewed outcomes for feedback loop/downstream tuning
    outcomes = service.get_reviewed_outcomes()
    assert len(outcomes) == 1
    assert outcomes[0]["status"] == "rejected"
    assert outcomes[0]["article_id"] == "art-200"
