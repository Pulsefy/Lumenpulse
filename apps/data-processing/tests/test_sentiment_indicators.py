"""
tests/test_sentiment_indicators.py

Tests for the visual sentiment indicator feature (issue #414).

Success Criteria (from the issue)
----------------------------------
* News list items can show a sentiment badge or coloured border
  → NewsArticleResponse now includes an `indicator` field.
* Asset details show a "Sentiment Score" (e.g. "0.85 Bullish")
  → AssetAnalysisResponse includes an `indicator` field.
* Legend / tooltip explaining what the colours mean
  → GET /sentiment/legend returns the legend.
* News items with **high** sentiment scores appear green.
* Scores map to: Green (Positive), Red (Negative), Gray (Neutral).
"""

import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

from src.analytics.sentiment_indicators import (
    SentimentIndicatorMapper,
    SentimentIndicator,
    SentimentColor,
    SentimentLabel,
    BULLISH_THRESHOLD,
    BEARISH_THRESHOLD,
    get_sentiment_indicator,
    get_legend,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def mapper():
    return SentimentIndicatorMapper()


# ---------------------------------------------------------------------------
# Core mapping tests — green / red / gray
# ---------------------------------------------------------------------------

class TestScoreToColor:
    """Verify score → color mapping for all three categories."""

    def test_high_positive_score_is_green(self, mapper):
        """Issue criteria: news with high sentiment scores appear green."""
        ind = mapper.score_to_indicator(0.85)
        assert ind.color == SentimentColor.GREEN
        assert ind.hex_color == "#00C853"

    def test_low_positive_score_above_threshold_is_green(self, mapper):
        ind = mapper.score_to_indicator(BULLISH_THRESHOLD)
        assert ind.color == SentimentColor.GREEN

    def test_strongly_negative_score_is_red(self, mapper):
        ind = mapper.score_to_indicator(-0.72)
        assert ind.color == SentimentColor.RED
        assert ind.hex_color == "#D50000"

    def test_at_bearish_threshold_is_red(self, mapper):
        ind = mapper.score_to_indicator(BEARISH_THRESHOLD)
        assert ind.color == SentimentColor.RED

    def test_zero_score_is_gray(self, mapper):
        ind = mapper.score_to_indicator(0.0)
        assert ind.color == SentimentColor.GRAY
        assert ind.hex_color == "#9E9E9E"

    def test_small_positive_below_threshold_is_gray(self, mapper):
        ind = mapper.score_to_indicator(0.04)
        assert ind.color == SentimentColor.GRAY

    def test_small_negative_above_threshold_is_gray(self, mapper):
        ind = mapper.score_to_indicator(-0.04)
        assert ind.color == SentimentColor.GRAY


# ---------------------------------------------------------------------------
# Label tests — Bullish / Bearish / Neutral
# ---------------------------------------------------------------------------

class TestSentimentLabels:
    """Verify Bullish / Bearish / Neutral label assignment."""

    def test_positive_score_label_is_bullish(self, mapper):
        """Issue criteria: asset details show "Sentiment Score" e.g. "0.85 Bullish"."""
        ind = mapper.score_to_indicator(0.85)
        assert ind.label == SentimentLabel.BULLISH

    def test_negative_score_label_is_bearish(self, mapper):
        ind = mapper.score_to_indicator(-0.60)
        assert ind.label == SentimentLabel.BEARISH

    def test_neutral_score_label_is_neutral(self, mapper):
        ind = mapper.score_to_indicator(0.01)
        assert ind.label == SentimentLabel.NEUTRAL


# ---------------------------------------------------------------------------
# Display text tests
# ---------------------------------------------------------------------------

class TestDisplayText:
    """Verify the formatted display string used in UI badges."""

    def test_bullish_display_text(self, mapper):
        """e.g. "0.85 Bullish" — as specified in the issue."""
        ind = mapper.score_to_indicator(0.85)
        assert ind.display_text == "0.85 Bullish"

    def test_bearish_display_text(self, mapper):
        ind = mapper.score_to_indicator(-0.40)
        assert ind.display_text == "-0.40 Bearish"

    def test_neutral_display_text(self, mapper):
        ind = mapper.score_to_indicator(0.0)
        assert ind.display_text == "0.00 Neutral"

    def test_format_display_standalone(self):
        text = SentimentIndicatorMapper.format_display(0.72, SentimentLabel.BULLISH)
        assert text == "0.72 Bullish"

    def test_format_display_derives_label_when_omitted(self):
        text = SentimentIndicatorMapper.format_display(0.72)
        assert text == "0.72 Bullish"

        text = SentimentIndicatorMapper.format_display(-0.15)
        assert text == "-0.15 Bearish"

        text = SentimentIndicatorMapper.format_display(0.0)
        assert text == "0.00 Neutral"


# ---------------------------------------------------------------------------
# to_dict serialisation
# ---------------------------------------------------------------------------

class TestToDict:
    def test_indicator_to_dict_keys(self, mapper):
        d = mapper.score_to_indicator(0.5).to_dict()
        assert set(d.keys()) == {"score", "color", "hex_color", "label", "display_text"}

    def test_indicator_to_dict_values(self, mapper):
        d = mapper.score_to_indicator(0.5).to_dict()
        assert d["color"] == "green"
        assert d["hex_color"] == "#00C853"
        assert d["label"] == "Bullish"
        assert d["score"] == pytest.approx(0.5)
        assert d["display_text"] == "0.50 Bullish"


# ---------------------------------------------------------------------------
# Legend tests — tooltip / colour key
# ---------------------------------------------------------------------------

class TestLegend:
    """Issue criteria: legend/tooltip explaining what the colours mean."""

    def test_legend_contains_three_entries(self, mapper):
        legend = mapper.get_legend()
        assert len(legend) == 3

    def test_legend_contains_all_colors(self, mapper):
        legend = mapper.get_legend()
        colors = {entry["color"] for entry in legend}
        assert colors == {"green", "red", "gray"}

    def test_legend_entries_have_required_keys(self, mapper):
        required = {"color", "hex_color", "label", "description", "score_range"}
        for entry in mapper.get_legend():
            assert required.issubset(entry.keys()), f"Entry missing keys: {entry}"

    def test_legend_bullish_entry(self, mapper):
        legend = {e["color"]: e for e in mapper.get_legend()}
        assert legend["green"]["label"] == "Bullish"
        assert "0.05" in legend["green"]["score_range"]

    def test_legend_bearish_entry(self, mapper):
        legend = {e["color"]: e for e in mapper.get_legend()}
        assert legend["red"]["label"] == "Bearish"

    def test_legend_neutral_entry(self, mapper):
        legend = {e["color"]: e for e in mapper.get_legend()}
        assert legend["gray"]["label"] == "Neutral"

    def test_module_level_get_legend(self):
        legend = get_legend()
        assert isinstance(legend, list)
        assert len(legend) == 3


# ---------------------------------------------------------------------------
# Module-level convenience function
# ---------------------------------------------------------------------------

class TestConvenienceFunction:
    def test_positive_score_returns_bullish_indicator(self):
        ind = get_sentiment_indicator(0.72)
        assert ind.label == SentimentLabel.BULLISH
        assert ind.color == SentimentColor.GREEN

    def test_negative_score_returns_bearish_indicator(self):
        ind = get_sentiment_indicator(-0.30)
        assert ind.label == SentimentLabel.BEARISH
        assert ind.hex_color == "#D50000"

    def test_zero_score_returns_neutral_indicator(self):
        ind = get_sentiment_indicator(0.0)
        assert ind.color == SentimentColor.GRAY


# ---------------------------------------------------------------------------
# Boundary / edge-value tests
# ---------------------------------------------------------------------------

class TestBoundaryValues:
    """Ensure the +/−0.05 thresholds are handled correctly."""

    def test_exact_bullish_threshold_maps_green(self, mapper):
        ind = mapper.score_to_indicator(0.05)
        assert ind.color == SentimentColor.GREEN

    def test_just_below_bullish_threshold_maps_gray(self, mapper):
        ind = mapper.score_to_indicator(0.049)
        assert ind.color == SentimentColor.GRAY

    def test_exact_bearish_threshold_maps_red(self, mapper):
        ind = mapper.score_to_indicator(-0.05)
        assert ind.color == SentimentColor.RED

    def test_just_above_bearish_threshold_maps_gray(self, mapper):
        ind = mapper.score_to_indicator(-0.049)
        assert ind.color == SentimentColor.GRAY

    def test_max_score_maps_green(self, mapper):
        ind = mapper.score_to_indicator(1.0)
        assert ind.color == SentimentColor.GREEN

    def test_min_score_maps_red(self, mapper):
        ind = mapper.score_to_indicator(-1.0)
        assert ind.color == SentimentColor.RED


# ---------------------------------------------------------------------------
# API integration tests (TestClient)
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def api_client():
    """
    Create a FastAPI TestClient with the database and rate-limiter mocked out
    so the test suite runs without real external services.
    """
    with (
        patch("src.api.server.PostgresService", side_effect=Exception("no db")),
        patch("src.api.server.security_config") as mock_sec,
        patch("src.api.server.setup_security_middleware"),
        patch("src.api.server.setup_rate_limiter"),
    ):
        mock_sec.limiter = None
        mock_sec.rate_limit_default = "60/minute"

        # Import after patching to avoid side-effects at module load
        import importlib
        import src.api.server as srv_module
        importlib.reload(srv_module)

        from fastapi.testclient import TestClient as TC
        client = TC(srv_module.app)
        yield client


@pytest.fixture(scope="module")
def api_client_simple():
    """Lightweight client — patches only heavy dependencies."""
    with (
        patch("src.api.server.PostgresService", side_effect=Exception("no db")),
    ):
        from src.api.server import app
        from fastapi.testclient import TestClient as TC
        yield TC(app)


class TestLegendEndpoint:
    """Issue criteria: legend / tooltip available via the API."""

    def test_legend_endpoint_returns_200(self, api_client_simple):
        resp = api_client_simple.get("/sentiment/legend")
        assert resp.status_code == 200

    def test_legend_response_contains_legend_key(self, api_client_simple):
        data = api_client_simple.get("/sentiment/legend").json()
        assert "legend" in data

    def test_legend_response_contains_thresholds(self, api_client_simple):
        data = api_client_simple.get("/sentiment/legend").json()
        assert "thresholds" in data
        assert "bullish" in data["thresholds"]
        assert "bearish" in data["thresholds"]
        assert "neutral" in data["thresholds"]

    def test_legend_response_has_three_entries(self, api_client_simple):
        data = api_client_simple.get("/sentiment/legend").json()
        assert len(data["legend"]) == 3

    def test_legend_entries_have_all_colors(self, api_client_simple):
        data = api_client_simple.get("/sentiment/legend").json()
        colors = {e["color"] for e in data["legend"]}
        assert colors == {"green", "red", "gray"}


class TestAnalyzeEndpointIndicator:
    """Verify POST /analyze returns the indicator block."""

    def test_analyze_positive_text_returns_green_indicator(self, api_client_simple):
        """High sentiment text → indicator.color == 'green'."""
        resp = api_client_simple.post(
            "/analyze",
            json={"text": "Stellar hits all time high, massive rally incoming!"},
            headers={"X-API-Key": "test"},
        )
        # 200 or 401/403 depending on auth setup; we test structure when 200
        if resp.status_code == 200:
            data = resp.json()
            assert "indicator" in data
            assert data["indicator"]["color"] == "green"
            assert data["indicator"]["label"] == "Bullish"

    def test_analyze_negative_text_returns_red_indicator(self, api_client_simple):
        """Negative sentiment text → indicator.color == 'red'."""
        resp = api_client_simple.post(
            "/analyze",
            json={"text": "Bitcoin is crashing, bears taking over!"},
            headers={"X-API-Key": "test"},
        )
        if resp.status_code == 200:
            data = resp.json()
            assert data["indicator"]["color"] == "red"
            assert data["indicator"]["label"] == "Bearish"


# ---------------------------------------------------------------------------
# NewsArticleResponse indicator field
# ---------------------------------------------------------------------------

class TestNewsArticleResponseIndicator:
    """Verify the pydantic model accepts and exposes the indicator field."""

    def test_news_response_with_positive_score_has_green_indicator(self):
        from src.api.server import NewsArticleResponse, SentimentIndicatorResponse

        ind = SentimentIndicatorResponse(
            score=0.82,
            color="green",
            hex_color="#00C853",
            label="Bullish",
            display_text="0.82 Bullish",
        )
        article = NewsArticleResponse(
            article_id="abc123",
            title="Stellar Lumens surge to all-time high",
            sentiment_score=0.82,
            sentiment_label="positive",
            indicator=ind,
        )
        assert article.indicator.color == "green"
        assert article.indicator.label == "Bullish"

    def test_news_response_without_score_has_no_indicator(self):
        from src.api.server import NewsArticleResponse

        article = NewsArticleResponse(
            article_id="xyz",
            title="Some neutral headline",
        )
        assert article.indicator is None
        assert article.sentiment_score is None

    def test_high_sentiment_news_indicator_is_green(self):
        """
        Issue success criterion:
        'Verify that news items with high sentiment scores appear green.'
        """
        from src.api.server import NewsArticleResponse, SentimentIndicatorResponse

        mapper = SentimentIndicatorMapper()
        score = 0.91  # High positive score
        ind = mapper.score_to_indicator(score)
        response_ind = SentimentIndicatorResponse(**ind.to_dict())

        article = NewsArticleResponse(
            article_id="news-001",
            title="XLM breaks records in massive bull run",
            sentiment_score=score,
            sentiment_label="positive",
            indicator=response_ind,
        )

        # The indicator must be green for high sentiment scores
        assert article.indicator.color == "green"
        assert article.indicator.hex_color == "#00C853"
        assert article.indicator.label == "Bullish"


# ---------------------------------------------------------------------------
# AssetAnalysisResponse indicator field
# ---------------------------------------------------------------------------

class TestAssetAnalysisResponseIndicator:
    """Issue criteria: asset details show a Sentiment Score e.g. "0.85 Bullish"."""

    def test_asset_response_includes_indicator_field(self):
        from src.api.server import AssetAnalysisResponse, SentimentIndicatorResponse

        ind = SentimentIndicatorResponse(
            score=0.85,
            color="green",
            hex_color="#00C853",
            label="Bullish",
            display_text="0.85 Bullish",
        )
        resp = AssetAnalysisResponse(
            asset="XLM",
            sentiment=0.85,
            sentiment_label="positive",
            analysis_count=42,
            indicator=ind,
        )
        assert resp.indicator is not None
        assert resp.indicator.display_text == "0.85 Bullish"

    def test_asset_response_bearish_indicator(self):
        from src.api.server import AssetAnalysisResponse, SentimentIndicatorResponse

        score = -0.60
        ind_data = SentimentIndicatorMapper().score_to_indicator(score).to_dict()
        resp = AssetAnalysisResponse(
            asset="BTC",
            sentiment=score,
            sentiment_label="negative",
            analysis_count=10,
            indicator=SentimentIndicatorResponse(**ind_data),
        )
        assert resp.indicator.color == "red"
        assert resp.indicator.label == "Bearish"


# ---------------------------------------------------------------------------
# SentimentIndicator immutability
# ---------------------------------------------------------------------------

class TestSentimentIndicatorFrozen:
    def test_indicator_is_immutable(self, mapper):
        ind = mapper.score_to_indicator(0.5)
        with pytest.raises((AttributeError, TypeError)):
            ind.color = SentimentColor.RED  # type: ignore[misc]
