"""
Unit tests for AttributionScorer (#1061).

Coverage targets
----------------
- All five signals independently (entity_link, mention, keyword,
  sentiment_coherence, category)
- Weighted score arithmetic
- Confidence tiers (high / medium / low / very_low)
- low_confidence flag propagation
- score_batch ordering
- to_dict serialisation on all three dataclasses
- Edge cases: empty article, missing fields, no aliases
- __init__.py lazy-import path
"""

from __future__ import annotations

import math
import unittest
from typing import Any, Dict, List

from src.analytics.attribution_scorer import (
    HIGH_CONFIDENCE_THRESHOLD,
    LOW_CONFIDENCE_THRESHOLD,
    MEDIUM_CONFIDENCE_THRESHOLD,
    AttributionResult,
    AttributionScorer,
    AttributionTarget,
    SignalBreakdown,
    _confidence_tier,
    _build_text_corpus,
    _SIGNAL_WEIGHTS,
)


# ---------------------------------------------------------------------------
# Shared helpers / fixtures
# ---------------------------------------------------------------------------

_UNSET = object()  # sentinel for "not provided"


def _make_target(
    *,
    target_id: str = "10001",
    target_type: str = "project",
    display_name: str = "PulseProject 1",
    aliases=_UNSET,
    asset_codes=_UNSET,
    stable_entity_ids=_UNSET,
    known_categories=_UNSET,
) -> AttributionTarget:
    return AttributionTarget(
        target_id=target_id,
        target_type=target_type,
        display_name=display_name,
        aliases=["PulseProject 1", "pulse-project-1", "XLM"]
        if aliases is _UNSET
        else aliases,
        asset_codes=["XLM"] if asset_codes is _UNSET else asset_codes,
        stable_entity_ids=["project:10001"]
        if stable_entity_ids is _UNSET
        else stable_entity_ids,
        known_categories=["crypto", "stellar", "defi"]
        if known_categories is _UNSET
        else known_categories,
    )


def _make_article(
    *,
    article_id: str = "art-001",
    title: str = "PulseProject 1 ships major upgrade",
    summary: str = "The XLM-based project released v2.",
    content: str = "Details about PulseProject 1 and its contributors.",
    detected_entities: List[str] | None = None,
    onchain_entity_links: List[Dict[str, Any]] | None = None,
    categories: List[str] | None = None,
    keywords: List[str] | None = None,
    sentiment_score: float | None = 0.6,
) -> Dict[str, Any]:
    return {
        "article_id": article_id,
        "title": title,
        "summary": summary,
        "content": content,
        "detected_entities": detected_entities
        if detected_entities is not None
        else ["PulseProject 1", "XLM"],
        "onchain_entity_links": onchain_entity_links
        if onchain_entity_links is not None
        else [
            {
                "stable_entity_id": "project:10001",
                "entity_type": "project",
                "display_name": "PulseProject 1",
                "matched_text": "PulseProject 1",
                "confidence": 0.95,
                "source": "SyntheticDataGenerator",
            }
        ],
        "categories": categories if categories is not None else ["crypto", "stellar"],
        "keywords": keywords if keywords is not None else ["XLM", "synthetic"],
        "sentiment_score": sentiment_score,
    }


# ---------------------------------------------------------------------------
# 1. Weights sanity check
# ---------------------------------------------------------------------------

class TestSignalWeights(unittest.TestCase):

    def test_weights_sum_to_one(self):
        total = sum(_SIGNAL_WEIGHTS.values())
        self.assertAlmostEqual(total, 1.0, places=9)

    def test_all_weights_positive(self):
        for name, w in _SIGNAL_WEIGHTS.items():
            self.assertGreater(w, 0, msg=f"Weight for {name!r} is not positive")

    def test_expected_signal_names_present(self):
        expected = {"entity_link", "mention", "keyword", "sentiment_coherence", "category"}
        self.assertEqual(set(_SIGNAL_WEIGHTS.keys()), expected)


# ---------------------------------------------------------------------------
# 2. _confidence_tier helper
# ---------------------------------------------------------------------------

class TestConfidenceTier(unittest.TestCase):

    def test_high(self):
        self.assertEqual(_confidence_tier(0.75), "high")
        self.assertEqual(_confidence_tier(1.0), "high")
        self.assertEqual(_confidence_tier(HIGH_CONFIDENCE_THRESHOLD), "high")

    def test_medium(self):
        self.assertEqual(_confidence_tier(0.50), "medium")
        self.assertEqual(_confidence_tier(0.74), "medium")
        self.assertEqual(_confidence_tier(MEDIUM_CONFIDENCE_THRESHOLD), "medium")

    def test_low(self):
        self.assertEqual(_confidence_tier(0.25), "low")
        self.assertEqual(_confidence_tier(0.49), "low")
        self.assertEqual(_confidence_tier(LOW_CONFIDENCE_THRESHOLD), "low")

    def test_very_low(self):
        self.assertEqual(_confidence_tier(0.0), "very_low")
        self.assertEqual(_confidence_tier(0.24), "very_low")
        self.assertEqual(_confidence_tier(0.001), "very_low")


# ---------------------------------------------------------------------------
# 3. _build_text_corpus helper
# ---------------------------------------------------------------------------

class TestBuildTextCorpus(unittest.TestCase):

    def test_combines_all_fields(self):
        article = {
            "title": "Alpha",
            "summary": "Beta",
            "content": "Gamma",
            "keywords": ["delta"],
            "detected_entities": ["Epsilon"],
        }
        corpus = _build_text_corpus(article)
        for word in ("Alpha", "Beta", "Gamma", "delta", "Epsilon"):
            self.assertIn(word, corpus)

    def test_handles_missing_fields(self):
        corpus = _build_text_corpus({})
        self.assertEqual(corpus.strip(), "")

    def test_none_values_skipped(self):
        article = {"title": None, "summary": "Hello"}
        corpus = _build_text_corpus(article)
        self.assertIn("Hello", corpus)



# ---------------------------------------------------------------------------
# 4. SignalBreakdown dataclass
# ---------------------------------------------------------------------------

class TestSignalBreakdown(unittest.TestCase):

    def _make(self, weight: float = 0.35, value: float = 0.9) -> SignalBreakdown:
        return SignalBreakdown(
            name="entity_link",
            weight=weight,
            fired=True,
            value=value,
            detail="Test detail.",
        )

    def test_contribution_is_weight_times_value(self):
        sb = self._make(weight=0.35, value=0.9)
        self.assertAlmostEqual(sb.contribution(), 0.35 * 0.9)

    def test_contribution_zero_when_not_fired(self):
        sb = SignalBreakdown(
            name="mention", weight=0.25, fired=False, value=0.0, detail="nope"
        )
        self.assertAlmostEqual(sb.contribution(), 0.0)

    def test_to_dict_keys(self):
        sb = self._make()
        d = sb.to_dict()
        for key in ("name", "weight", "fired", "value", "detail", "contribution"):
            self.assertIn(key, d)

    def test_to_dict_values_rounded(self):
        sb = self._make(weight=0.35, value=0.9)
        d = sb.to_dict()
        self.assertEqual(d["contribution"], round(0.35 * 0.9, 4))


# ---------------------------------------------------------------------------
# 5. AttributionResult dataclass
# ---------------------------------------------------------------------------

class TestAttributionResult(unittest.TestCase):

    def _make(self) -> AttributionResult:
        return AttributionResult(
            article_id="art-1",
            target_id="10001",
            target_type="project",
            display_name="PulseProject 1",
            score=0.8,
            confidence_tier="high",
            low_confidence=False,
            signals=[],
            scorer_version="attribution_scorer_v1",
        )

    def test_to_dict_contains_required_keys(self):
        d = self._make().to_dict()
        for key in (
            "article_id", "target_id", "target_type", "display_name",
            "score", "confidence_tier", "low_confidence", "signals",
            "scorer_version",
        ):
            self.assertIn(key, d)

    def test_to_dict_score_rounded(self):
        result = AttributionResult(
            article_id="a",
            target_id="t",
            target_type="project",
            display_name="X",
            score=0.123456789,
            confidence_tier="low",
            low_confidence=False,
        )
        d = result.to_dict()
        self.assertEqual(d["score"], round(0.123456789, 4))

    def test_signals_serialised_in_to_dict(self):
        sb = SignalBreakdown(
            name="entity_link", weight=0.35, fired=True, value=0.9, detail="ok"
        )
        result = self._make()
        result.signals.append(sb)
        d = result.to_dict()
        self.assertEqual(len(d["signals"]), 1)
        self.assertEqual(d["signals"][0]["name"], "entity_link")



# ---------------------------------------------------------------------------
# 6. Individual signal tests (via AttributionScorer private methods)
# ---------------------------------------------------------------------------

class TestEntityLinkSignal(unittest.TestCase):

    def setUp(self):
        self.scorer = AttributionScorer()
        self.target = _make_target()

    def _signal(self, article):
        return self.scorer._entity_link_signal(article, self.target)

    def test_fires_with_matching_stable_id(self):
        article = _make_article()
        s = self._signal(article)
        self.assertTrue(s.fired)
        self.assertAlmostEqual(s.value, 0.95)

    def test_value_reflects_link_confidence(self):
        article = _make_article(
            onchain_entity_links=[
                {"stable_entity_id": "project:10001", "confidence": 0.80}
            ]
        )
        s = self._signal(article)
        self.assertAlmostEqual(s.value, 0.80)

    def test_picks_highest_confidence_among_multiple_links(self):
        article = _make_article(
            onchain_entity_links=[
                {"stable_entity_id": "project:10001", "confidence": 0.70},
                {"stable_entity_id": "project:10001", "confidence": 0.92},
            ]
        )
        s = self._signal(article)
        self.assertAlmostEqual(s.value, 0.92)

    def test_does_not_fire_for_different_stable_id(self):
        article = _make_article(
            onchain_entity_links=[
                {"stable_entity_id": "project:99999", "confidence": 0.95}
            ]
        )
        s = self._signal(article)
        self.assertFalse(s.fired)
        self.assertEqual(s.value, 0.0)

    def test_does_not_fire_with_empty_links(self):
        article = _make_article(onchain_entity_links=[])
        s = self._signal(article)
        self.assertFalse(s.fired)

    def test_does_not_fire_when_no_stable_entity_ids_on_target(self):
        target = _make_target(stable_entity_ids=[])
        # article has links, but target has no stable IDs to match against
        article = _make_article()
        s = self.scorer._entity_link_signal(article, target)
        # The guard "if not target_stable_ids" returns early → should not fire
        self.assertFalse(s.fired)

    def test_supports_stable_id_key_alias(self):
        # Some callers may use 'stable_id' instead of 'stable_entity_id'
        article = _make_article(
            onchain_entity_links=[{"stable_id": "project:10001", "confidence": 0.88}]
        )
        s = self._signal(article)
        self.assertTrue(s.fired)
        self.assertAlmostEqual(s.value, 0.88)

    def test_weight_is_correct(self):
        s = self._signal(_make_article())
        self.assertAlmostEqual(s.weight, _SIGNAL_WEIGHTS["entity_link"])


class TestMentionSignal(unittest.TestCase):

    def setUp(self):
        self.scorer = AttributionScorer()
        self.target = _make_target()

    def _signal(self, article):
        return self.scorer._mention_signal(article, self.target)

    def test_fires_on_detected_entity_match(self):
        article = _make_article(detected_entities=["PulseProject 1", "XLM"])
        s = self._signal(article)
        self.assertTrue(s.fired)

    def test_fires_on_text_match_when_not_in_entities(self):
        article = _make_article(
            detected_entities=[],
            title="pulse-project-1 is growing",
            summary="",
            content="",
        )
        s = self._signal(article)
        self.assertTrue(s.fired)

    def test_value_higher_with_more_alias_hits(self):
        # Match only one alias
        article_one = _make_article(
            detected_entities=["XLM"],
            title="XLM news",
            summary="",
            content="",
        )
        # Match multiple aliases
        article_many = _make_article(
            detected_entities=["PulseProject 1", "XLM"],
            title="PulseProject 1 and pulse-project-1 hit XLM milestone",
            summary="",
            content="",
        )
        s_one = self._signal(article_one)
        s_many = self._signal(article_many)
        self.assertGreater(s_many.value, s_one.value)

    def test_does_not_fire_on_empty_article(self):
        article = _make_article(
            detected_entities=[],
            title="",
            summary="",
            content="",
            keywords=[],
        )
        s = self._signal(article)
        self.assertFalse(s.fired)

    def test_does_not_fire_when_no_aliases(self):
        target = _make_target(aliases=[])
        s = self.scorer._mention_signal(_make_article(), target)
        self.assertFalse(s.fired)

    def test_case_insensitive(self):
        article = _make_article(
            detected_entities=["pulseproject 1"],
            title="",
            summary="",
            content="",
        )
        s = self._signal(article)
        self.assertTrue(s.fired)

    def test_weight_is_correct(self):
        s = self._signal(_make_article())
        self.assertAlmostEqual(s.weight, _SIGNAL_WEIGHTS["mention"])


class TestKeywordSignal(unittest.TestCase):

    def setUp(self):
        self.scorer = AttributionScorer()
        self.target = _make_target()

    def _signal(self, article):
        return self.scorer._keyword_signal(article, self.target)

    def test_fires_when_alias_in_keywords(self):
        article = _make_article(keywords=["XLM", "defi"])
        s = self._signal(article)
        self.assertTrue(s.fired)

    def test_fires_when_alias_in_title(self):
        article = _make_article(
            title="XLM rally drives PulseProject 1 adoption",
            keywords=[],
        )
        s = self._signal(article)
        self.assertTrue(s.fired)

    def test_fires_when_alias_in_summary(self):
        article = _make_article(
            title="Market update",
            summary="pulse-project-1 sees record growth",
            keywords=[],
        )
        s = self._signal(article)
        self.assertTrue(s.fired)

    def test_does_not_fire_when_no_match(self):
        article = _make_article(
            title="Bitcoin surges",
            summary="BTC hits ATH",
            keywords=["BTC"],
        )
        target = _make_target(aliases=["OnlyMe"], asset_codes=["ONLY"])
        s = self.scorer._keyword_signal(article, target)
        self.assertFalse(s.fired)

    def test_does_not_fire_when_no_searchable_terms(self):
        target = _make_target(aliases=[], asset_codes=[])
        s = self.scorer._keyword_signal(_make_article(), target)
        self.assertFalse(s.fired)

    def test_both_hits_give_max_value(self):
        article = _make_article(
            title="XLM update",
            keywords=["XLM"],
        )
        s = self._signal(article)
        self.assertAlmostEqual(s.value, 1.0)

    def test_weight_is_correct(self):
        s = self._signal(_make_article())
        self.assertAlmostEqual(s.weight, _SIGNAL_WEIGHTS["keyword"])


class TestSentimentCoherenceSignal(unittest.TestCase):

    def setUp(self):
        self.scorer = AttributionScorer()
        self.target = _make_target()

    def _signal(self, article):
        return self.scorer._sentiment_coherence_signal(article, self.target)

    def test_fires_on_positive_sentiment(self):
        s = self._signal(_make_article(sentiment_score=0.7))
        self.assertTrue(s.fired)
        self.assertAlmostEqual(s.value, 0.7)

    def test_fires_on_negative_sentiment(self):
        s = self._signal(_make_article(sentiment_score=-0.6))
        self.assertTrue(s.fired)
        self.assertAlmostEqual(s.value, 0.6)

    def test_does_not_fire_on_neutral_sentiment(self):
        s = self._signal(_make_article(sentiment_score=0.03))
        self.assertFalse(s.fired)
        self.assertEqual(s.value, 0.0)

    def test_does_not_fire_when_sentiment_absent(self):
        s = self._signal(_make_article(sentiment_score=None))
        self.assertFalse(s.fired)

    def test_does_not_fire_at_exact_threshold(self):
        s = self._signal(_make_article(sentiment_score=0.05))
        self.assertFalse(s.fired)

    def test_fires_just_above_threshold(self):
        s = self._signal(_make_article(sentiment_score=0.051))
        self.assertTrue(s.fired)

    def test_weight_is_correct(self):
        s = self._signal(_make_article())
        self.assertAlmostEqual(s.weight, _SIGNAL_WEIGHTS["sentiment_coherence"])


class TestCategorySignal(unittest.TestCase):

    def setUp(self):
        self.scorer = AttributionScorer()
        self.target = _make_target(known_categories=["crypto", "stellar", "defi"])

    def _signal(self, article):
        return self.scorer._category_signal(article, self.target)

    def test_fires_with_overlapping_categories(self):
        article = _make_article(categories=["crypto", "news"])
        s = self._signal(article)
        self.assertTrue(s.fired)

    def test_value_is_jaccard_similarity(self):
        # target: {crypto, stellar, defi}  article: {crypto, stellar}
        # intersection=2, union=3  → jaccard=2/3
        article = _make_article(categories=["crypto", "stellar"])
        s = self._signal(article)
        self.assertAlmostEqual(s.value, 2 / 3, places=3)

    def test_perfect_overlap_gives_1(self):
        article = _make_article(categories=["crypto", "stellar", "defi"])
        s = self._signal(article)
        self.assertAlmostEqual(s.value, 1.0)

    def test_does_not_fire_with_no_overlap(self):
        article = _make_article(categories=["finance", "stocks"])
        s = self._signal(article)
        self.assertFalse(s.fired)

    def test_does_not_fire_when_target_has_no_categories(self):
        target = _make_target(known_categories=[])
        s = self.scorer._category_signal(_make_article(), target)
        self.assertFalse(s.fired)

    def test_does_not_fire_when_article_has_no_categories(self):
        article = _make_article(categories=[])
        s = self._signal(article)
        self.assertFalse(s.fired)

    def test_case_insensitive_matching(self):
        article = _make_article(categories=["Crypto", "STELLAR"])
        s = self._signal(article)
        self.assertTrue(s.fired)

    def test_weight_is_correct(self):
        s = self._signal(_make_article())
        self.assertAlmostEqual(s.weight, _SIGNAL_WEIGHTS["category"])



# ---------------------------------------------------------------------------
# 7. AttributionScorer.score() — integration tests
# ---------------------------------------------------------------------------

class TestAttributionScorerScore(unittest.TestCase):

    def setUp(self):
        self.scorer = AttributionScorer()
        self.target = _make_target()

    def test_returns_attribution_result(self):
        result = self.scorer.score(_make_article(), self.target)
        self.assertIsInstance(result, AttributionResult)

    def test_score_is_between_zero_and_one(self):
        result = self.scorer.score(_make_article(), self.target)
        self.assertGreaterEqual(result.score, 0.0)
        self.assertLessEqual(result.score, 1.0)

    def test_high_confidence_for_strong_article(self):
        # Full entity link, alias mentions, keyword hits, non-neutral sentiment,
        # and matching categories — should produce a high-confidence score.
        result = self.scorer.score(_make_article(), self.target)
        self.assertEqual(result.confidence_tier, "high")
        self.assertFalse(result.low_confidence)

    def test_very_low_confidence_on_blank_article(self):
        blank = {
            "article_id": "blank-001",
            "title": "",
            "summary": "",
            "content": "",
            "detected_entities": [],
            "onchain_entity_links": [],
            "categories": [],
            "keywords": [],
            "sentiment_score": 0.0,
        }
        result = self.scorer.score(blank, self.target)
        self.assertEqual(result.confidence_tier, "very_low")
        self.assertTrue(result.low_confidence)

    def test_result_article_id_propagated(self):
        article = _make_article(article_id="test-999")
        result = self.scorer.score(article, self.target)
        self.assertEqual(result.article_id, "test-999")

    def test_result_target_fields_propagated(self):
        result = self.scorer.score(_make_article(), self.target)
        self.assertEqual(result.target_id, self.target.target_id)
        self.assertEqual(result.target_type, self.target.target_type)
        self.assertEqual(result.display_name, self.target.display_name)

    def test_result_has_five_signals(self):
        result = self.scorer.score(_make_article(), self.target)
        self.assertEqual(len(result.signals), 5)

    def test_signal_names_all_present(self):
        result = self.scorer.score(_make_article(), self.target)
        names = {s.name for s in result.signals}
        self.assertEqual(
            names,
            {"entity_link", "mention", "keyword", "sentiment_coherence", "category"},
        )

    def test_scorer_version_set(self):
        result = self.scorer.score(_make_article(), self.target)
        self.assertEqual(result.scorer_version, "attribution_scorer_v1")

    def test_score_weighted_sum_matches_manual_calc(self):
        """Score must equal sum(weight * value) for each signal."""
        result = self.scorer.score(_make_article(), self.target)
        expected = sum(s.contribution() for s in result.signals)
        self.assertAlmostEqual(result.score, expected, places=6)

    def test_score_clipped_to_zero_on_all_no_fire(self):
        blank = {
            "article_id": "z",
            "title": "Random market news",
            "detected_entities": [],
            "onchain_entity_links": [],
            "categories": [],
            "keywords": [],
            "sentiment_score": 0.0,
        }
        target = _make_target(
            aliases=["UniqueTokenXYZ"],
            asset_codes=["UNQ"],
            stable_entity_ids=["project:99999"],
            known_categories=["special-niche"],
        )
        result = self.scorer.score(blank, target)
        self.assertGreaterEqual(result.score, 0.0)

    def test_contributor_target_type(self):
        target = _make_target(
            target_id="GCONTRIB123",
            target_type="contributor",
            display_name="Alice",
            aliases=["Alice", "contributor_alice"],
            stable_entity_ids=[],
            known_categories=["community"],
        )
        article = _make_article(
            title="Alice contributes to Stellar project",
            detected_entities=["Alice"],
            categories=["community", "stellar"],
            onchain_entity_links=[],
        )
        result = self.scorer.score(article, target)
        self.assertEqual(result.target_type, "contributor")
        self.assertGreater(result.score, 0.0)

    def test_missing_article_id_becomes_empty_string(self):
        article = _make_article()
        del article["article_id"]
        result = self.scorer.score(article, self.target)
        self.assertEqual(result.article_id, "")

    def test_to_dict_is_json_serialisable(self):
        import json
        result = self.scorer.score(_make_article(), self.target)
        # Should not raise
        serialised = json.dumps(result.to_dict())
        self.assertIn("score", serialised)


# ---------------------------------------------------------------------------
# 8. score_batch()
# ---------------------------------------------------------------------------

class TestAttributionScorerBatch(unittest.TestCase):

    def setUp(self):
        self.scorer = AttributionScorer()

    def test_returns_correct_count(self):
        articles = [_make_article(article_id=f"a-{i}") for i in range(3)]
        targets = [
            _make_target(target_id="10001"),
            _make_target(target_id="10002", display_name="PulseProject 2"),
        ]
        results = self.scorer.score_batch(articles, targets)
        self.assertEqual(len(results), 6)  # 3 articles × 2 targets

    def test_results_sorted_descending_by_score(self):
        articles = [_make_article()]
        target_strong = _make_target(target_id="10001")
        target_weak = _make_target(
            target_id="99999",
            display_name="Unknown",
            aliases=["UnknownZZZ"],
            stable_entity_ids=["project:99999"],
            known_categories=["niche"],
        )
        results = self.scorer.score_batch(articles, [target_strong, target_weak])
        scores = [r.score for r in results]
        self.assertEqual(scores, sorted(scores, reverse=True))

    def test_low_confidence_results_appear_last(self):
        blank = {
            "article_id": "blank",
            "title": "",
            "detected_entities": [],
            "onchain_entity_links": [],
            "categories": [],
            "keywords": [],
            "sentiment_score": 0.0,
        }
        good = _make_article()
        target = _make_target()
        results = self.scorer.score_batch([blank, good], [target])

        low_conf_indices = [i for i, r in enumerate(results) if r.low_confidence]
        high_conf_indices = [i for i, r in enumerate(results) if not r.low_confidence]

        if low_conf_indices and high_conf_indices:
            self.assertGreater(min(low_conf_indices), max(high_conf_indices))

    def test_empty_inputs_returns_empty_list(self):
        self.assertEqual(self.scorer.score_batch([], []), [])
        self.assertEqual(self.scorer.score_batch([_make_article()], []), [])


# ---------------------------------------------------------------------------
# 9. Confidence tier boundary behaviour in full score
# ---------------------------------------------------------------------------

class TestConfidenceBoundaries(unittest.TestCase):

    def setUp(self):
        self.scorer = AttributionScorer()

    def test_low_confidence_flag_matches_tier(self):
        for article in [_make_article(), {"article_id": "x"}]:
            target = _make_target()
            result = self.scorer.score(article, target)
            self.assertEqual(result.low_confidence, result.confidence_tier == "very_low")

    def test_high_tier_implies_not_low_confidence(self):
        result = self.scorer.score(_make_article(), _make_target())
        if result.confidence_tier == "high":
            self.assertFalse(result.low_confidence)


# ---------------------------------------------------------------------------
# 10. Lazy import via analytics __init__
# ---------------------------------------------------------------------------

class TestAnalyticsInitImport(unittest.TestCase):

    def test_import_attribution_scorer(self):
        from src.analytics import AttributionScorer as AS
        self.assertIs(AS, AttributionScorer)

    def test_import_attribution_target(self):
        from src.analytics import AttributionTarget as AT
        self.assertIs(AT, AttributionTarget)

    def test_import_attribution_result(self):
        from src.analytics import AttributionResult as AR
        self.assertIs(AR, AttributionResult)

    def test_import_signal_breakdown(self):
        from src.analytics import SignalBreakdown as SB
        self.assertIs(SB, SignalBreakdown)

    def test_unknown_attribute_raises(self):
        import src.analytics as analytics
        with self.assertRaises(AttributeError):
            _ = analytics.ThisDoesNotExist


# ---------------------------------------------------------------------------
# 11. Miscellaneous edge cases
# ---------------------------------------------------------------------------

class TestEdgeCases(unittest.TestCase):

    def setUp(self):
        self.scorer = AttributionScorer()

    def test_score_with_all_none_fields(self):
        article = {
            "article_id": None,
            "title": None,
            "summary": None,
            "content": None,
            "detected_entities": None,
            "onchain_entity_links": None,
            "categories": None,
            "keywords": None,
            "sentiment_score": None,
        }
        result = self.scorer.score(article, _make_target())
        self.assertGreaterEqual(result.score, 0.0)
        self.assertLessEqual(result.score, 1.0)

    def test_score_with_extra_unknown_fields(self):
        article = _make_article()
        article["unknown_field"] = "should be ignored"
        # Must not raise
        result = self.scorer.score(article, _make_target())
        self.assertIsInstance(result, AttributionResult)

    def test_target_id_appears_as_alias(self):
        # If the target_id is a Stellar address that appears in article text,
        # the mention signal should still fire.
        addr = "GCONTRIB_ADDR_XYZ"
        target = _make_target(
            target_id=addr,
            aliases=[],  # no explicit aliases — target_id appended internally
            stable_entity_ids=[],
            known_categories=[],
        )
        article = _make_article(
            title=f"Contributor {addr} just joined",
            detected_entities=[addr],
        )
        result = self.scorer.score(article, target)
        mention_signal = next(s for s in result.signals if s.name == "mention")
        self.assertTrue(mention_signal.fired)

    def test_score_does_not_exceed_one(self):
        # Craft an article that maxes every signal
        article = _make_article(sentiment_score=1.0)
        result = self.scorer.score(article, _make_target())
        self.assertLessEqual(result.score, 1.0)

    def test_score_not_nan(self):
        result = self.scorer.score(_make_article(), _make_target())
        self.assertFalse(math.isnan(result.score))


if __name__ == "__main__":
    unittest.main()
