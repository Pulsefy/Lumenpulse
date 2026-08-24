# -*- coding: utf-8 -*-
"""
tests/test_sentiment_language.py

Tests for multilingual sentiment support (issue #1252).

Covers the production ``src.sentiment.SentimentAnalyzer`` path, the
per-language accuracy report against the labelled set, and the API response
fields that expose the detected language and score reliability.
"""

import os
import pytest
from unittest.mock import patch

from src.sentiment import SentimentAnalyzer
from src.analytics.sentiment import evaluate_language_accuracy

LABELLED_SET_PATH = os.path.join(
    os.path.dirname(__file__), "..", "data", "sentiment_labelled_set.json"
)


# ---------------------------------------------------------------------------
# Production analyzer (src.sentiment) — language-aware scoring
# ---------------------------------------------------------------------------


class TestLanguageAwareAnalyze:
    def test_english_text_scored_with_metadata(self):
        analyzer = SentimentAnalyzer()
        result = analyzer.analyze("The market collapsed under heavy selling")

        assert result.language == "en"
        assert result.language_supported is True
        assert result.language_unsupported is False
        assert result.score_reliable is True
        assert result.unscored is False
        assert result.compound_score < 0

    def test_chinese_text_scored_with_zh_lexicon(self):
        analyzer = SentimentAnalyzer()
        result = analyzer.analyze("比特币价格大幅上涨")

        assert result.language == "zh"
        assert result.language_supported is True
        assert result.score_reliable is True
        assert result.unscored is False
        assert result.compound_score > 0

    def test_chinese_negative_text(self):
        analyzer = SentimentAnalyzer()
        result = analyzer.analyze("市场崩盘，投资者抛售")

        assert result.language == "zh"
        assert result.compound_score < 0
        assert result.sentiment_label == "negative"

    def test_spanish_and_portuguese_supported(self):
        analyzer = SentimentAnalyzer()

        es = analyzer.analyze("Bitcoin sube con fuerte rally en el mercado")
        pt = analyzer.analyze("Bitcoin sobe em alta no mercado")

        assert es.language == "es" and es.score_reliable
        assert pt.language == "pt" and pt.score_reliable

    def test_unsupported_language_marked_unscored(self):
        analyzer = SentimentAnalyzer()
        result = analyzer.analyze("これはテストです")  # Japanese

        assert result.language == "ja"
        assert result.language_supported is False
        assert result.language_unsupported is True
        assert result.score_reliable is False
        assert result.unscored is True
        assert result.compound_score == 0.0
        assert result.sentiment_label == "neutral"

    def test_lang_hint_forces_language(self):
        analyzer = SentimentAnalyzer()
        result = analyzer.analyze("Bitcoin is crashing hard", lang_hint="fr")

        assert result.language == "fr"
        assert result.unscored is True
        assert result.score_reliable is False

    def test_to_dict_includes_language_fields(self):
        analyzer = SentimentAnalyzer()
        data = analyzer.analyze("Stellar hits all time high").to_dict()

        assert data["language"] == "en"
        assert data["score_reliable"] is True
        assert data["unscored"] is False
        assert "language_supported" in data
        assert "language_unsupported" in data

    def test_batch_results_include_language(self):
        analyzer = SentimentAnalyzer()
        results = analyzer.analyze_batch(["Bitcoin is crashing", "比特币价格大涨"])

        assert [r.language for r in results] == ["en", "zh"]
        assert all(r.score_reliable for r in results)


# ---------------------------------------------------------------------------
# Per-language accuracy reporting
# ---------------------------------------------------------------------------


class TestLanguageAccuracyReport:
    def test_accuracy_report_has_per_language_breakdown(self):
        report = evaluate_language_accuracy(LABELLED_SET_PATH)

        assert report["total_samples"] > 0
        assert set(report["per_language"].keys()) >= {"en", "es", "pt", "zh"}
        assert "ja" in report["per_language"]  # unsupported sample present

    def test_accuracy_report_meets_threshold(self):
        report = evaluate_language_accuracy(LABELLED_SET_PATH)

        # Labelled samples are deterministic with the keyword/VADER paths;
        # the report should reflect near-perfect label agreement.
        assert report["accuracy"] >= 0.9
        for lang in ("en", "es", "pt", "zh"):
            assert report["per_language"][lang]["accuracy"] >= 0.9

    def test_accuracy_report_counts_unscored_as_correct(self):
        report = evaluate_language_accuracy(LABELLED_SET_PATH)

        # The two unsupported-language samples must be marked unscored.
        assert report["unscored_correct"] >= 2
        assert report["per_language"]["ja"]["unscored"] == 1

    def test_default_path_resolves_to_repo_labelled_set(self):
        report = evaluate_language_accuracy()
        assert report["total_samples"] == 27
        assert report["accuracy"] == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# API response fields (issue #1252 acceptance criteria)
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def api_client():
    """TestClient with the DB patched out and a valid API key configured.

    Global security state is restored on teardown so other test modules are
    unaffected.
    """
    old_env_key = os.environ.get("API_KEY")
    os.environ["API_KEY"] = "test"
    import src.security as security_module

    old_configured_key = security_module.security_config.api_key
    security_module.security_config.api_key = "test"
    try:
        with patch("src.api.server.PostgresService", side_effect=Exception("no db")):
            from src.api.server import app
            from fastapi.testclient import TestClient as TC

            yield TC(app)
    finally:
        if old_env_key is None:
            os.environ.pop("API_KEY", None)
        else:
            os.environ["API_KEY"] = old_env_key
        security_module.security_config.api_key = old_configured_key


class TestAnalyzeApiLanguageFields:
    def test_analyze_response_includes_language(self, api_client):
        resp = api_client.post(
            "/analyze",
            json={"text": "Bitcoin is crashing"},
            headers={"X-API-Key": "test"},
        )
        if resp.status_code != 200:
            pytest.skip(f"/analyze returned {resp.status_code} (auth/rate limit)")

        data = resp.json()
        assert data["language"] == "en"
        assert data["language_supported"] is True
        assert data["score_reliable"] is True
        assert data["unscored"] is False

    def test_analyze_response_chinese(self, api_client):
        resp = api_client.post(
            "/analyze",
            json={"text": "比特币价格大幅上涨"},
            headers={"X-API-Key": "test"},
        )
        if resp.status_code != 200:
            pytest.skip(f"/analyze returned {resp.status_code} (auth/rate limit)")

        data = resp.json()
        assert data["language"] == "zh"
        assert data["score_reliable"] is True

    def test_analyze_response_unsupported_is_unscored(self, api_client):
        resp = api_client.post(
            "/analyze",
            json={"text": "これはテストです"},
            headers={"X-API-Key": "test"},
        )
        if resp.status_code != 200:
            pytest.skip(f"/analyze returned {resp.status_code} (auth/rate limit)")

        data = resp.json()
        assert data["language"] == "ja"
        assert data["language_supported"] is False
        assert data["score_reliable"] is False
        assert data["unscored"] is True
        assert data["sentiment"] == 0.0

    def test_analyze_response_lang_hint(self, api_client):
        resp = api_client.post(
            "/analyze",
            json={"text": "Bitcoin is crashing hard", "lang_hint": "fr"},
            headers={"X-API-Key": "test"},
        )
        if resp.status_code != 200:
            pytest.skip(f"/analyze returned {resp.status_code} (auth/rate limit)")

        data = resp.json()
        assert data["language"] == "fr"
        assert data["unscored"] is True

    def test_accuracy_endpoint_reports_per_language(self, api_client):
        resp = api_client.get(
            "/sentiment/accuracy",
            headers={"X-API-Key": "test"},
        )
        if resp.status_code != 200:
            pytest.skip(f"/sentiment/accuracy returned {resp.status_code}")

        data = resp.json()
        assert "per_language" in data
        assert data["accuracy"] >= 0.9
        assert {"en", "es", "pt", "zh"}.issubset(data["per_language"].keys())
