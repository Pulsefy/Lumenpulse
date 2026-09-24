"""
tests/test_sentiment_explanation.py

Per-token sentiment explanations (issue #1456).

Acceptance criteria covered here
---------------------------------
* ``analyze_text(..., explain=True)`` returns per-token contributions.
* Contributions reference the lexicon entry or model feature responsible
  (``lexicon:vader:<word>``, ``lexicon:crypto:...``, ``model:finbert:...``).
* Explanations are off by default and add only documented, bounded work.
* A worked example traces a disputed score to its cause.
"""

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient as _TestClient

from src.analytics.explanation import (
    MAX_EXPLAIN_TOKENS,
    SentimentExplanation,
    explanation_latency_overhead,
)
from src.analytics.sentiment import SentimentAnalyzer, SentimentScore


def _analyzer() -> SentimentAnalyzer:
    return SentimentAnalyzer(enable_transformer=False)


def _required_explanation(score: SentimentScore) -> SentimentExplanation:
    assert score.explanation is not None
    return score.explanation


def _by_feature(explanation, feature):
    return [c for c in explanation.contributions if c.feature == feature]


# ---------------------------------------------------------------------------
# Off by default
# ---------------------------------------------------------------------------


def test_explanation_is_off_by_default():
    score = _analyzer().analyze_text("This token is really great, I love it")
    assert score.explanation is None
    assert "explanation" not in score.to_dict()


def test_requesting_explanation_is_an_opt_in_flag():
    score = _analyzer().analyze_text(
        "This token is really great, I love it", explain=True
    )
    assert score.explanation is not None
    assert "explanation" in score.to_dict()


# ---------------------------------------------------------------------------
# English VADER path
# ---------------------------------------------------------------------------


def test_vader_contributions_reference_lexicon_entries():
    score = _analyzer().analyze_text(
        "This is really great, I love it", lang_hint="en", explain=True
    )
    explanation = _required_explanation(score)
    assert explanation.method == "vader"
    features = {c.feature for c in explanation.contributions}
    assert "lexicon:vader:great" in features
    assert "lexicon:vader:love" in features
    assert "lexicon:vader:booster:really" in features
    assert all(c.feature.startswith("lexicon:") for c in explanation.contributions)
    assert any(c.contribution > 0 for c in explanation.contributions)


def test_vader_decomposition_reconstructs_the_score():
    score = _analyzer().analyze_text(
        "This is really great, I love it", lang_hint="en", explain=True
    )
    explanation = _required_explanation(score)
    total = sum(c.contribution for c in explanation.contributions)
    assert total + explanation.unattributed == pytest.approx(float(score))


def test_vader_contribution_on_negative_input():
    score = _analyzer().analyze_text(
        "This is a terrible disaster", lang_hint="en", explain=True
    )
    explanation = _required_explanation(score)
    assert explanation.score < 0
    negative = [c for c in explanation.contributions if c.contribution < 0]
    assert negative
    assert all(c.feature.startswith("lexicon:") for c in negative)


# ---------------------------------------------------------------------------
# Crypto-slang fallback path
# ---------------------------------------------------------------------------


def test_crypto_fallback_attributed_to_lexicon_entry():
    score = _analyzer().analyze_text("moon moon", lang_hint="en", explain=True)
    assert score == 0.4
    explanation = _required_explanation(score)
    assert explanation.method == "vader+crypto_fallback"
    entries = _by_feature(explanation, "lexicon:crypto:positive:moon")
    assert entries
    assert entries[0].contribution == pytest.approx(0.4)


def test_negative_fallback_precedence_marks_positive_inactive():
    # Both "bear" and "moon" are crypto slang; negative entries take precedence
    # in the zero-compound fallback, so "moon" is surfaced as inactive.
    score = _analyzer().analyze_text("bearish moon", lang_hint="en", explain=True)
    assert score == -0.4
    explanation = _required_explanation(score)
    negative = _by_feature(explanation, "lexicon:crypto:negative:bear")
    positive = _by_feature(explanation, "lexicon:crypto:positive:moon")
    assert negative and negative[0].contribution == pytest.approx(-0.4)
    assert positive and positive[0].contribution == 0.0
    assert "inactive" in positive[0].note


def test_worked_example_disputed_score_traced_to_cause():
    """
    "XLM mooning after a strong breakout" scores 0.51 despite the bullish
    slang "mooning".  The explanation shows the score was actually driven by
    the VADER entry for "strong" (lexicon:vader:strong), while "moon"
    matched the project's crypto-slang lexicon but stayed inactive because the
    VADER compound was non-zero.  This is the evidence that lets an analyst
    decide whether the crypto-slang lexicon needs a stronger entry.
    """
    score = _analyzer().analyze_text(
        "XLM mooning after a strong breakout", lang_hint="en", explain=True
    )
    assert score > 0.2
    explanation = _required_explanation(score)
    assert explanation.method == "vader"

    # Contributions are ordered by magnitude: "strong" is the driver.
    top = explanation.contributions[0]
    assert top.token == "strong"
    assert top.feature == "lexicon:vader:strong"
    assert top.contribution > 0

    moon = _by_feature(explanation, "lexicon:crypto:positive:moon")
    assert moon
    assert moon[0].contribution == 0.0
    assert "inactive" in moon[0].note

    total = sum(c.contribution for c in explanation.contributions)
    assert total + explanation.unattributed == pytest.approx(float(score))


# ---------------------------------------------------------------------------
# FinBERT model-feature path
# ---------------------------------------------------------------------------


def _fake_finbert(text: str) -> float:
    """Deterministic stand-in for a FinBERT model for attribution tests."""
    lowered = text.lower()
    if "moon" in lowered:
        return 0.6
    if "crash" in lowered:
        return -0.6
    return 0.0


def test_finbert_explanation_references_model_features(monkeypatch):
    analyzer = _analyzer()
    monkeypatch.setattr(analyzer, "_finbert_compound", _fake_finbert)
    score = analyzer.analyze_text("moon rocket", lang_hint="en", explain=True)
    explanation = _required_explanation(score)
    assert explanation.method == "finbert"
    assert explanation.model == analyzer._transformer_model_name
    assert all(c.kind == "model" for c in explanation.contributions)
    assert all(
        c.feature.startswith("model:finbert:") for c in explanation.contributions
    )

    moon = [c for c in explanation.contributions if c.token == "moon"]
    assert moon and moon[0].contribution == pytest.approx(0.6)


# ---------------------------------------------------------------------------
# Spanish / Portuguese keyword paths
# ---------------------------------------------------------------------------


def test_spanish_keyword_explanation_is_exact():
    score = _analyzer().analyze_text(
        "Bitcoin sube con fuerte rally en el mercado", explain=True
    )
    explanation = _required_explanation(score)
    assert explanation.method == "keyword:es"
    assert explanation.unattributed == 0.0
    features = {c.feature for c in explanation.contributions}
    assert "lexicon:es:positive:sube" in features
    assert "lexicon:es:positive:rally" in features
    total = sum(c.contribution for c in explanation.contributions)
    assert total == pytest.approx(float(score))


def test_portuguese_keyword_explanation_references_lexicon():
    score = _analyzer().analyze_text(
        "Bitcoin sobe em alta no mercado com rali", explain=True
    )
    explanation = _required_explanation(score)
    assert explanation.method == "keyword:pt"
    features = {c.feature for c in explanation.contributions}
    assert "lexicon:pt:positive:sobe" in features
    assert "lexicon:pt:positive:alta" in features


def test_keyword_path_with_no_hits_is_empty():
    score = _analyzer().analyze_text(
        "El mercado abre en calma", lang_hint="es", explain=True
    )
    assert score == 0.0
    explanation = _required_explanation(score)
    assert explanation.method == "keyword:es"
    assert explanation.contributions == ()


# ---------------------------------------------------------------------------
# Unsupported languages / empty input
# ---------------------------------------------------------------------------


def test_unsupported_language_explanation_is_empty():
    score = _analyzer().analyze_text(
        "\u8fd9\u662f\u4e00\u4e2a\u6d4b\u8bd5", explain=True
    )
    assert _required_explanation(score).method == "none"
    assert _required_explanation(score).contributions == ()


def test_empty_text_explanation_is_empty():
    score = _analyzer().analyze_text("   ", explain=True)
    assert score == 0.0
    assert _required_explanation(score).method == "none"


# ---------------------------------------------------------------------------
# Latency overhead: documented bound, gated off by default
# ---------------------------------------------------------------------------


def test_explanation_work_is_gated_behind_explain_flag(monkeypatch):
    analyzer = _analyzer()
    base = analyzer._pure_vader_compound
    calls = {"n": 0}

    def counting(text):
        calls["n"] += 1
        return base(text)

    monkeypatch.setattr(analyzer, "_pure_vader_compound", counting)
    analyzer.analyze_text("This is really great", lang_hint="en", explain=False)
    assert calls["n"] == 0

    monkeypatch.setattr(analyzer, "_pure_vader_compound", counting)
    analyzer.analyze_text("This is really great", lang_hint="en", explain=True)
    assert calls["n"] > 0
    assert calls["n"] <= MAX_EXPLAIN_TOKENS


def test_latency_overhead_is_documented_per_method():
    assert "vader" in explanation_latency_overhead("vader").lower()
    assert "at most" in explanation_latency_overhead("vader").lower()
    assert "no extra scoring" in explanation_latency_overhead("vader+crypto_fallback")
    assert "no extra scoring" in explanation_latency_overhead("keyword:es")
    assert "transformer forward passes" in explanation_latency_overhead("finbert")
    assert "no extra work" in explanation_latency_overhead("none")


# ---------------------------------------------------------------------------
# POST /analyze integration (#1456)
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def api_client():
    """
    TestClient with heavy DB dependencies and API-key auth patched out.

    The security middleware closes over the ``src.security.security_config``
    global, so that object (not ``src.api.server.security_config``) is what we
    mock for a pass-through ``validate_api_key``.
    """
    import src.security as sec_module

    with (
        patch("src.api.server.PostgresService", side_effect=Exception("no db")),
        patch.object(sec_module, "security_config") as mock_cfg,
    ):
        mock_cfg.validate_api_key.return_value = True

        from src.api.server import app
        yield _TestClient(app)


def _analyze(client, text, explain=None):
    payload = {"text": text}
    if explain is not None:
        payload["explain"] = explain
    return client.post("/analyze", json=payload, headers={"X-API-Key": "test-key"})


def test_api_does_not_return_explanation_by_default(api_client):
    resp = _analyze(api_client, "This is really great, I love it")
    assert resp.status_code == 200
    data = resp.json()
    # Off by default: the explanation block is absent/empty (no token work).
    assert data.get("explanation") is None or data["explanation"] == {
        "method": "none",
        "score": 0.0,
        "contributions": [],
        "unattributed": 0.0,
        "model": None,
    }


def test_api_returns_explanation_when_requested(api_client):
    resp = _analyze(
        api_client, "This is really great, I love it", explain=True
    )
    assert resp.status_code == 200
    data = resp.json()
    explanation = data["explanation"]
    assert explanation["method"] == "vader"
    assert explanation["score"] == pytest.approx(data["sentiment"])
    features = {c["feature"] for c in explanation["contributions"]}
    assert "lexicon:vader:love" in features
    assert any(c["kind"] == "lexicon" for c in explanation["contributions"])


def test_api_explanation_attributes_score_to_vader_lexicon(api_client):
    resp = _analyze(
        api_client, "XLM mooning after a strong breakout", explain=True
    )
    assert resp.status_code == 200
    explanation = resp.json()["explanation"]
    assert explanation["method"] == "vader"
    strong = [c for c in explanation["contributions"]
              if c["feature"] == "lexicon:vader:strong"]
    assert strong and strong[0]["contribution"] > 0
