"""DB-layer tests for versioned article embeddings and semantic search (#1455)."""

from datetime import datetime

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from src.db.models import Article, ArticleEmbedding, Base
from src.db.postgres_service import PostgresService

_EMBEDDING_MODEL = "en_core_web_md"
_EMBEDDING_VERSION = "3.7.1"


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
    service.ner_service = None
    return service


def _insert_article(
    service: PostgresService,
    article_id: str,
    title: str,
    summary: str = "",
    content: str = "",
) -> None:
    with service.get_session() as session:
        session.add(
            Article(
                article_id=article_id,
                title=title,
                summary=summary,
                content=content,
                source="test",
                published_at=datetime.utcnow(),
            )
        )


def _save_embedding(
    service: PostgresService,
    article_id: str,
    vector: list,
    version: str = _EMBEDDING_VERSION,
) -> bool:
    return service.save_article_embedding(
        article_id=article_id,
        embedding=vector,
        model_name=_EMBEDDING_MODEL,
        model_version=version,
        dimension=len(vector),
        text_hash=f"hash-{article_id}",
    )


def test_save_article_embedding_is_idempotent_and_versioned() -> None:
    service = build_sqlite_service()
    _insert_article(service, "a1", "Stellar Soroban contracts")

    assert _save_embedding(service, "a1", [1.0, 0.0]) is True

    # Re-saving under the same (article_id, model_version) upserts in place.
    assert (
        service.save_article_embedding(
            article_id="a1",
            embedding=[0.0, 1.0],
            model_name=_EMBEDDING_MODEL,
            model_version=_EMBEDDING_VERSION,
            dimension=2,
            text_hash="hash-replaced",
        )
        is True
    )

    with service.get_session() as session:
        rows = (
            session.execute(
                select(ArticleEmbedding).where(
                    ArticleEmbedding.article_id == "a1",
                    ArticleEmbedding.model_version == _EMBEDDING_VERSION,
                )
            )
            .scalars()
            .all()
        )
    assert len(rows) == 1
    assert rows[0].embedding == [0.0, 1.0]
    assert rows[0].text_hash == "hash-replaced"

    # A different model version coexists in its own row (auditable).
    assert (
        service.save_article_embedding(
            article_id="a1",
            embedding=[1.0, 1.0],
            model_name=_EMBEDDING_MODEL,
            model_version="9.9.9",
            dimension=2,
            text_hash="hash-v9",
        )
        is True
    )

    with service.get_session() as session:
        versions = (
            session.execute(
                select(ArticleEmbedding.model_version).where(
                    ArticleEmbedding.article_id == "a1"
                )
            )
            .scalars()
            .all()
        )
    assert sorted(versions) == ["3.7.1", "9.9.9"]


def test_search_articles_by_embedding_ranks_by_cosine() -> None:
    service = build_sqlite_service()
    vectors = {"a1": [1.0, 0.0, 0.0], "a2": [0.0, 1.0, 0.0], "a3": [0.9, 0.0, 0.0]}
    for article_id, vector in vectors.items():
        _insert_article(service, article_id, f"article {article_id}")
        _save_embedding(service, article_id, vector)

    results = service.search_articles_by_embedding(
        query_vector=[1.0, 0.0, 0.0], limit=10
    )
    assert [r["article_id"] for r in results] == ["a1", "a3", "a2"]
    assert results[0]["similarity_score"] == 1.0
    assert results[0]["title"] == "article a1"

    top_two = service.search_articles_by_embedding(
        query_vector=[1.0, 0.0, 0.0], limit=2
    )
    assert [r["article_id"] for r in top_two] == ["a1", "a3"]


def test_search_scoped_to_model_version() -> None:
    service = build_sqlite_service()
    _insert_article(service, "a1", "one")
    _insert_article(service, "a2", "two")
    _save_embedding(service, "a1", [1.0, 0.0], version="3.7.1")
    _save_embedding(service, "a2", [0.0, 1.0], version="4.0.0")

    # Defaults to the latest stored model version.
    latest = service.search_articles_by_embedding(query_vector=[1.0, 0.0], limit=10)
    assert [r["article_id"] for r in latest] == ["a2"]

    scoped = service.search_articles_by_embedding(
        query_vector=[1.0, 0.0], model_version="3.7.1", limit=10
    )
    assert [r["article_id"] for r in scoped] == ["a1"]


def test_iter_article_ids_missing_embeddings_is_resumable() -> None:
    service = build_sqlite_service()
    for article_id in ("a1", "a2", "a3"):
        _insert_article(service, article_id, f"article {article_id}")

    gen = service.iter_article_ids_missing_embeddings(
        model_version=_EMBEDDING_VERSION, batch_size=2
    )

    # First batch; persisting embeddings for it makes the next batch advance.
    batch = next(gen)
    assert batch == ["a1", "a2"]
    for article_id in batch:
        _save_embedding(service, article_id, [1.0, 0.0])

    second = next(gen)
    assert second == ["a3"]
    for article_id in second:
        _save_embedding(service, article_id, [1.0, 0.0])

    with pytest.raises(StopIteration):
        next(gen)

    # A fresh run starts where the previous run left off: nothing left.
    left = list(
        service.iter_article_ids_missing_embeddings(
            model_version=_EMBEDDING_VERSION, batch_size=2
        )
    )
    assert left == []


def test_get_embedded_articles_returns_vectors_with_text() -> None:
    service = build_sqlite_service()
    _insert_article(service, "a1", "Stellar upgrade", summary="Soroban ships")
    _save_embedding(service, "a1", [1.0, 0.0, 0.0])

    corpus = service.get_embedded_articles(model_version=_EMBEDDING_VERSION, limit=10)
    assert len(corpus) == 1
    assert corpus[0]["article_id"] == "a1"
    assert corpus[0]["title"] == "Stellar upgrade"
    assert corpus[0]["summary"] == "Soroban ships"
    assert corpus[0]["embedding"] == [1.0, 0.0, 0.0]
