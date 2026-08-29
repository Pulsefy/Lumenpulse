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


def test_build_and_retrieve_contributor_reputation_snapshots() -> None:
    service = build_sqlite_service()
    project_id = 303

    contributors = [
        ("contrib-A", 100.0),
        ("contrib-B", 200.0),
        ("contrib-C", 50.0),
    ]

    for idx, (contributor, amount) in enumerate(contributors, start=1):
        service.save_project_contributor(
            project_id=project_id,
            contributor=contributor,
            amount=amount,
            ledger=100 + idx,
        )

    snapshots = service.build_project_contributor_reputation_snapshot(
        project_id=project_id,
        top_n=2,
        is_testnet=True,
    )

    assert len(snapshots) == 2
    assert snapshots[0].contributor == "contrib-B"
    assert snapshots[0].rank == 1
    assert snapshots[1].contributor == "contrib-A"
    assert snapshots[1].rank == 2
    assert snapshots[0].reputation_score >= snapshots[1].reputation_score

    top_snapshots = service.get_top_contributor_reputation_snapshots(limit=2)
    assert len(top_snapshots) == 2
    assert top_snapshots[0].reputation_score >= top_snapshots[1].reputation_score
    assert {s.project_id for s in top_snapshots} == {project_id}


# ---------------------------------------------------------------------------
# Canonical aliases in the news article dataset (#1063)
#
# ``Article.detected_entities`` is the join column the sentiment, attribution
# and API consumers filter on, so it is the dataset that benefits directly
# from the alias registry: whatever spelling a fetcher supplies, one canonical
# value is stored, and a query using any registered spelling finds it.
# ---------------------------------------------------------------------------


def test_fetcher_supplied_entities_are_canonicalized_on_write() -> None:
    service = build_sqlite_service()

    article = service.save_article(
        {
            "id": "article-alias-1",
            "title": "Volume update",
            "content": "Daily flows recap.",
            "source": "test-source",
            "published_at": datetime.utcnow(),
            # Three spellings of one entity, as different feeds write it.
            "detected_entities": ["$XLM", "lumens", "Stellar Lumens"],
        }
    )

    assert article is not None
    assert article.detected_entities == ["XLM"]


def test_unregistered_entities_survive_canonicalization() -> None:
    service = build_sqlite_service()

    article = service.save_article(
        {
            "id": "article-alias-2",
            "title": "Private round",
            "content": "An unlisted company raised a round.",
            "source": "test-source",
            "published_at": datetime.utcnow(),
            "detected_entities": ["Acme Holdings"],
        }
    )

    assert article is not None
    assert article.detected_entities == ["Acme Holdings"]


def test_entity_lookup_matches_any_registered_alias() -> None:
    service = build_sqlite_service()
    service.save_article(
        {
            "id": "article-alias-3",
            "title": "Lumens volume climbs",
            "content": "Payment corridors saw more activity.",
            "source": "test-source",
            "published_at": datetime.utcnow(),
            "detected_entities": ["XLM"],
        }
    )

    # Every registered spelling retrieves the same article; before the alias
    # registry only the exact stored string "XLM" matched.
    for term in ["XLM", "$XLM", "xlm", "lumens", "Stellar", "Stellar Lumens"]:
        found = service.get_recent_articles(limit=10, entity=term)
        assert [a.id for a in found] == ["article-alias-3"], term

    assert service.get_recent_articles(limit=10, entity="Bitcoin") == []


def test_entity_lookup_still_matches_unregistered_terms_exactly() -> None:
    service = build_sqlite_service()
    service.save_article(
        {
            "id": "article-alias-4",
            "title": "Private round",
            "content": "An unlisted company raised a round.",
            "source": "test-source",
            "published_at": datetime.utcnow(),
            "detected_entities": ["Acme Holdings"],
        }
    )

    found = service.get_recent_articles(limit=10, entity="acme holdings")
    assert [a.id for a in found] == ["article-alias-4"]
    assert service.get_recent_articles(limit=10, entity="Acme") == []
