"""
Tests for the personal-data scrubbing stage (#1452).

Covers the three enforcement points: the ingestion boundary (fetchers), the
persistence boundary (PostgresService) and prediction request logging.
"""

import hashlib
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from src.privacy import scrub_record, scrub_text
from src.privacy.scrubbing import (
    DEFAULT_WALLET_ADDRESS_POLICY,
    PERSONAL_DATA_INVENTORY,
    STRUCTURAL_FIELDS,
    TREATMENT_IDENTIFIER,
    TREATMENT_TEXT,
    TREATMENTS,
    WALLET_ADDRESS_POLICY_ENV,
    get_wallet_address_policy,
)

STELLAR_ADDRESS = "G" + ("ABCDEF234567" * 5)[:55]
EVM_ADDRESS = "0x" + "a1b2c3d4e5" * 4


# ---------------------------------------------------------------------------
# Policy
# ---------------------------------------------------------------------------


def test_default_wallet_policy_is_explicit(monkeypatch):
    monkeypatch.delenv(WALLET_ADDRESS_POLICY_ENV, raising=False)
    assert get_wallet_address_policy() == DEFAULT_WALLET_ADDRESS_POLICY == "mask"


def test_wallet_policy_can_be_set_to_retain(monkeypatch):
    monkeypatch.setenv(WALLET_ADDRESS_POLICY_ENV, "retain")
    assert get_wallet_address_policy() == "retain"


def test_wallet_policy_rejects_unknown_values(monkeypatch):
    monkeypatch.setenv(WALLET_ADDRESS_POLICY_ENV, "redact-everything")
    with pytest.raises(ValueError, match=WALLET_ADDRESS_POLICY_ENV):
        get_wallet_address_policy()


# ---------------------------------------------------------------------------
# Text scrubbing
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text,expected",
    [
        ("mail alice@example.com for details", "mail [EMAIL] for details"),
        ("call +1 (555) 123-4567 today", "call [PHONE] today"),
        ("reach 555 123 4567 now", "reach [PHONE] now"),
        ("dial (555) 123-4567 today", "dial [PHONE] today"),
        ("ssn 123-45-6789 on file", "ssn [SSN] on file"),
        ("card 4111 1111 1111 1111 charged", "card [CREDIT_CARD] charged"),
        ("host 192.168.10.5 is down", "host [IP_ADDRESS] is down"),
        ("ping @alice for a review", "ping [HANDLE] for a review"),
        (f"send to {STELLAR_ADDRESS} please", "send to [WALLET_ADDRESS] please"),
        (f"send to {EVM_ADDRESS} please", "send to [WALLET_ADDRESS] please"),
    ],
)
def test_scrub_text_redacts_personal_data(text, expected, monkeypatch):
    monkeypatch.delenv(WALLET_ADDRESS_POLICY_ENV, raising=False)
    assert scrub_text(text) == expected


def test_scrub_text_preserves_ordinary_prose():
    text = "Stellar rose 4.2% after the Soroban upgrade landed."
    assert scrub_text(text) == text


def test_scrub_text_is_idempotent():
    raw = "alice@example.com / @alice / 555-123-4567 / " + STELLAR_ADDRESS
    once = scrub_text(raw)
    assert scrub_text(once) == once


def test_scrub_text_wallet_policy_retain(monkeypatch):
    monkeypatch.setenv(WALLET_ADDRESS_POLICY_ENV, "retain")
    assert scrub_text(f"wallet {STELLAR_ADDRESS}") == f"wallet {STELLAR_ADDRESS}"
    # Contact details are still scrubbed under the retain policy.
    assert scrub_text("alice@example.com") == "[EMAIL]"


def test_scrub_text_wallet_policy_override():
    retained = scrub_text(f"wallet {STELLAR_ADDRESS}", wallet_policy="retain")
    assert retained.endswith(STELLAR_ADDRESS)
    masked = scrub_text(f"wallet {STELLAR_ADDRESS}", wallet_policy="mask")
    assert "[WALLET_ADDRESS]" in masked


def test_scrub_text_handles_empty_input():
    assert scrub_text("") == ""


# ---------------------------------------------------------------------------
# Record scrubbing and the field inventory
# ---------------------------------------------------------------------------


def test_inventory_lists_the_personal_data_fields():
    fields = {row.field for row in PERSONAL_DATA_INVENTORY}
    assert {"title", "content", "summary", "author", "url", "input_text"} <= fields
    for row in PERSONAL_DATA_INVENTORY:
        assert row.treatment in TREATMENTS
        if row.treatment == TREATMENT_IDENTIFIER:
            assert row.placeholder


def test_scrub_record_masks_identifier_fields():
    scrubbed = scrub_record({"author": "alice", "platform": "reddit"})
    assert scrubbed["author"] == "[AUTHOR]"
    assert scrubbed["platform"] == "reddit"


def test_scrub_record_scrubs_text_fields():
    record = {
        "title": "Update from alice@example.com",
        "content": "ping @alice about 192.168.0.10",
        "hashtags": ["#Stellar", "@alice"],
    }
    scrubbed = scrub_record(record)
    assert scrubbed["title"] == "Update from [EMAIL]"
    assert scrubbed["content"] == "ping [HANDLE] about [IP_ADDRESS]"
    assert scrubbed["hashtags"] == ["#Stellar", "[HANDLE]"]


def test_scrub_record_leaves_structural_fields_untouched():
    record = {
        "id": "na_1234567",
        "source": "alice@example.com",
        "platform": "twitter",
        "published_at": "2024-05-01T10:00:00+00:00",
        "primary_asset": "XLM",
        "asset_codes": ["XLM"],
        "likes": 10,
        "sentiment_score": None,
    }
    assert scrub_record(record) == record
    assert "published_at" in STRUCTURAL_FIELDS


def test_scrub_record_scrubs_unknown_fields_by_default():
    scrubbed = scrub_record({"note": "reach me on 555-123-4567"})
    assert scrubbed["note"] == "reach me on [PHONE]"


def test_scrub_record_recurses_and_does_not_mutate_input():
    record = {"engagement": {"contact": "alice@example.com"}, "shares": 3}
    scrubbed = scrub_record(record)
    assert scrubbed["engagement"]["contact"] == "[EMAIL]"
    assert record["engagement"]["contact"] == "alice@example.com"


def test_scrub_record_rejects_non_mappings():
    with pytest.raises(TypeError):
        scrub_record(["not", "a", "record"])


def test_scrub_record_wallet_policy(monkeypatch):
    monkeypatch.setenv(WALLET_ADDRESS_POLICY_ENV, "retain")
    record = {"content": f"holder {STELLAR_ADDRESS}"}
    assert scrub_record(record)["content"] == f"holder {STELLAR_ADDRESS}"


# ---------------------------------------------------------------------------
# Ingestion boundary
# ---------------------------------------------------------------------------


def test_social_fetcher_scrubs_before_returning():
    from src.ingestion.social_fetcher import SocialFetcher, SocialPost

    post = SocialPost(
        id="t1",
        platform="twitter",
        content="Please mail alice@example.com or ping @alice about it",
        author="alice",
        posted_at=datetime(2024, 5, 1, tzinfo=timezone.utc),
        url="https://twitter.com/user/status/t1",
    )

    with (
        patch(
            "src.ingestion.social_fetcher.TwitterFetcher.fetch_hashtag",
            return_value=[post],
        ),
        patch(
            "src.ingestion.social_fetcher.RedditFetcher.fetch_multiple_subreddits",
            return_value=[],
        ),
    ):
        fetched = SocialFetcher(use_twitter=True, use_reddit=True).fetch_all(
            hashtags=["#Stellar"], limit_per_source=1
        )

    assert len(fetched) == 1
    assert fetched[0]["content"] == "Please mail [EMAIL] or ping [HANDLE] about it"
    assert fetched[0]["author"] == "[AUTHOR]"


def test_news_fetcher_scrubs_before_deduplication(monkeypatch):
    from src.ingestion.news_fetcher import NewsFetcher

    monkeypatch.setenv("NEWSAPI_API_KEY", "test_newsapi_key")

    payload = {
        "articles": [
            {
                "title": "Refund process explained",
                "description": "Please write to alice@example.com for refunds",
                "content": "Send refunds back to the wallet address 0x" + "ab" * 20,
                "publishedAt": "2024-05-01T10:00:00Z",
                "source": {"name": "CryptoInsider"},
                "url": "https://example.com/news/1",
            }
        ]
    }
    response = SimpleNamespace(
        status_code=200,
        json=lambda: payload,
        raise_for_status=lambda: None,
    )

    # Record what the deduplicator receives: the scrub must already have
    # happened, and the on-disk dedup store must not be touched by the test.
    deduped = []

    class RecordingDeduplicator:
        def __init__(self, **kwargs):
            pass

        def filter_duplicates(self, articles):
            deduped.extend(articles)
            return articles

    with (
        patch(
            "src.ingestion.news_fetcher.requests.Session.get",
            return_value=response,
        ),
        patch("src.ingestion.news_fetcher.NewsDeduplicator", RecordingDeduplicator),
    ):
        fetcher = NewsFetcher(use_cryptocompare=False, use_newsapi=True)
        articles = fetcher.fetch_latest(limit=5)
        fetcher.close()

    assert len(articles) == 1
    article = articles[0]
    assert article["summary"] == "Please write to [EMAIL] for refunds"
    assert (
        article["content"] == "Send refunds back to the wallet address [WALLET_ADDRESS]"
    )
    assert article["url"] == "https://example.com/news/1"
    # Deduplication runs after scrubbing: it only ever sees scrubbed records.
    assert deduped == articles


def test_legacy_news_fetcher_scrubs_before_features():
    from src import fetchers

    def fake_get(url, **kwargs):
        if "coingecko" in url:
            data = {
                "data": [
                    {
                        "title": "Refund desk opens",
                        "description": "Customers should write to alice@example.com",
                        "url": "https://example.com/a",
                        "published_at": "2024-05-01T10:00:00Z",
                    }
                ]
            }
        else:
            data = []
        return SimpleNamespace(json=lambda: data, raise_for_status=lambda: None)

    with patch.object(fetchers.requests, "get", side_effect=fake_get):
        items = fetchers.NewsFetcher().fetch_all_news()

    assert items
    assert items[0].content == "Customers should write to [EMAIL]"


# ---------------------------------------------------------------------------
# Persistence boundary
# ---------------------------------------------------------------------------


def _build_sqlite_service():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from src.analytics.ner_service import NERService
    from src.db.models import Base
    from src.db.postgres_service import PostgresService

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


def test_save_article_scrubs_before_ner_and_persistence():
    service = _build_sqlite_service()

    seen = {}
    original = service.ner_service.extract_entities_from_article

    def spy(**kwargs):
        seen.update(kwargs)
        return original(**kwargs)

    service.ner_service.extract_entities_from_article = spy

    article = service.save_article(
        {
            "id": "pii-1",
            "title": "Questions about the upgrade? Mail alice@example.com today",
            "content": "Please ping @alice about the node on 192.168.0.10 or "
            f"send the payout to {STELLAR_ADDRESS}",
            "summary": "Contact alice@example.com for more detail",
            "source": "test-source",
            "url": "https://example.com/news/1",
        }
    )

    assert article is not None
    # Feature computation (NER) sees the scrubbed text …
    assert seen["title"] == "Questions about the upgrade? Mail [EMAIL] today"
    assert "[WALLET_ADDRESS]" in seen["content"]
    assert "alice@example.com" not in seen["content"]
    # … and so does the persisted row.
    assert article.title == "Questions about the upgrade? Mail [EMAIL] today"
    assert article.summary == "Contact [EMAIL] for more detail"
    assert "alice@example.com" not in (article.content or "")


def test_save_social_post_scrubs_before_persistence():
    service = _build_sqlite_service()

    post = service.save_social_post(
        {
            "id": "p1",
            "platform": "reddit",
            "content": "Please DM alice@example.com for alpha",
            "author": "alice",
            "posted_at": datetime(2024, 5, 1, tzinfo=timezone.utc),
        }
    )

    assert post is not None
    assert post.content == "Please DM [EMAIL] for alpha"
    assert post.author == "[AUTHOR]"


def test_save_news_insight_scrubs_article_metadata():
    service = _build_sqlite_service()

    insight = service.save_news_insight(
        {
            "compound_score": 0.1,
            "positive": 1,
            "negative": 0,
            "neutral": 0,
            "sentiment_label": "positive",
        },
        {
            "id": "a1",
            "title": "Please reach alice@example.com",
            "url": "https://example.com/1",
        },
    )

    assert insight is not None
    assert insight.article_title == "Please reach [EMAIL]"


# ---------------------------------------------------------------------------
# Prediction request logging
# ---------------------------------------------------------------------------


def test_prediction_logging_scrubs_input_and_output():
    server = pytest.importorskip("src.api.server")

    recorded = {}
    fake_service = SimpleNamespace(
        log_prediction=lambda **kwargs: recorded.update(kwargs)
    )

    with (
        patch.object(server, "postgres_service", fake_service),
        patch.dict("os.environ", {"LOG_PREDICTION_RAW_INPUT": "true"}),
    ):
        server._log_prediction(
            request_id="req-1",
            model_type="sentiment",
            model_version="v1",
            input_text="please ping alice@example.com about 192.168.0.10",
            output={"sentiment": 0.2, "echo": "alice@example.com"},
            latency_ms=12.0,
        )

    assert recorded["raw_input"] == "please ping [EMAIL] about [IP_ADDRESS]"
    assert recorded["output"]["echo"] == "[EMAIL]"
    expected_hash = hashlib.sha256(recorded["raw_input"].encode("utf-8")).hexdigest()
    assert recorded["input_hash"] == expected_hash


def test_prediction_logging_omits_raw_input_by_default():
    server = pytest.importorskip("src.api.server")

    recorded = {}
    fake_service = SimpleNamespace(
        log_prediction=lambda **kwargs: recorded.update(kwargs)
    )

    with (
        patch.object(server, "postgres_service", fake_service),
        patch.dict("os.environ", {}, clear=True),
    ):
        server._log_prediction(
            request_id="req-2",
            model_type="sentiment",
            model_version="v1",
            input_text="text with alice@example.com inside",
            output={"sentiment": -0.4},
            latency_ms=3.0,
        )

    assert recorded["raw_input"] is None
    assert (
        recorded["input_hash"]
        == hashlib.sha256(b"text with [EMAIL] inside").hexdigest()
    )


def test_treatments_cover_every_inventory_row():
    assert {TREATMENT_TEXT, TREATMENT_IDENTIFIER} == set(TREATMENTS)
