"""
Contributor-Project Narrative Attribution Scorer (#1061)

Scores how strongly a news or discussion narrative is attributable to a
specific contributor or project rather than broad ecosystem-level trends.

Design
------
Attribution is computed from a small, ordered set of *signal functions*.
Each signal returns a numeric weight in [0.0, 1.0].  The final score is a
weighted average of all firing signals, clipped to [0.0, 1.0].  Every
intermediate value is preserved so operators can inspect and tune without
retraining a model.

Signals
~~~~~~~
1. entity_link_signal  — direct onchain_entity_links in the article JSON
2. mention_signal      — raw text / detected_entities mentions of the target
3. keyword_signal      — target keywords / aliases in title + summary
4. sentiment_coherence_signal — sentiment aligns with a known contributor action
5. category_signal     — article categories match known project/contributor topics

Confidence tier
~~~~~~~~~~~~~~~
The combined score is mapped to a human-readable tier:

  >= 0.75  →  high
  >= 0.50  →  medium
  >= 0.25  →  low
  <  0.25  →  very_low  (treated as "insufficient evidence" downstream)

Low-confidence handling
~~~~~~~~~~~~~~~~~~~~~~~
When tier is "very_low" the scorer returns an AttributionResult flagged with
``low_confidence=True`` so callers can safely skip or quarantine the result
rather than propagate noisy attribution.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Confidence tier thresholds
# ---------------------------------------------------------------------------
HIGH_CONFIDENCE_THRESHOLD: float = 0.75
MEDIUM_CONFIDENCE_THRESHOLD: float = 0.50
LOW_CONFIDENCE_THRESHOLD: float = 0.25

# Signal weights must sum to 1.0
_SIGNAL_WEIGHTS: Dict[str, float] = {
    "entity_link": 0.35,    # strongest — a deliberate onchain entity link
    "mention": 0.25,        # direct name / address mention in the body
    "keyword": 0.20,        # alias / ticker / slug hit in title or summary
    "sentiment_coherence": 0.10,  # sentiment fits contributor context
    "category": 0.10,       # article categories overlap with target's topics
}

assert abs(sum(_SIGNAL_WEIGHTS.values()) - 1.0) < 1e-9, "Weights must sum to 1.0"


# ---------------------------------------------------------------------------
# Domain types
# ---------------------------------------------------------------------------


@dataclass
class AttributionTarget:
    """
    Describes the contributor or project being matched against.

    Parameters
    ----------
    target_id:
        Opaque identifier — a Stellar address (contributor) or integer
        project_id.  Used as a join key for downstream views.
    target_type:
        ``"contributor"`` or ``"project"``.
    display_name:
        Human-readable label (e.g. ``"Alice"`` or ``"PulseProject 1"``).
    aliases:
        All known text aliases (names, handles, tickers, slugs).  The scorer
        matches any of these against article text.
    asset_codes:
        Optional asset tickers associated with the target (e.g. ``["XLM"]``).
    stable_entity_ids:
        Optional onchain entity stable IDs (e.g. ``["project:10001"]``) used
        to check ``onchain_entity_links``.
    known_categories:
        Optional set of article category strings relevant to this target.
    """

    target_id: str
    target_type: str  # "contributor" | "project"
    display_name: str
    aliases: Sequence[str] = field(default_factory=list)
    asset_codes: Sequence[str] = field(default_factory=list)
    stable_entity_ids: Sequence[str] = field(default_factory=list)
    known_categories: Sequence[str] = field(default_factory=list)


@dataclass
class SignalBreakdown:
    """
    Per-signal weight and firing status — the explainable part of the score.

    Attributes
    ----------
    name:    Signal identifier (matches a key in ``_SIGNAL_WEIGHTS``).
    weight:  Configured importance weight for this signal.
    fired:   Whether the signal matched (True / False).
    value:   Continuous score produced by the signal in [0.0, 1.0].
    detail:  Human-readable explanation of why the signal fired or not.
    """

    name: str
    weight: float
    fired: bool
    value: float
    detail: str

    def contribution(self) -> float:
        """Weighted contribution to the total score."""
        return self.weight * self.value

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "weight": round(self.weight, 4),
            "fired": self.fired,
            "value": round(self.value, 4),
            "detail": self.detail,
            "contribution": round(self.contribution(), 4),
        }


@dataclass
class AttributionResult:
    """
    The full attribution output for one (article, target) pair.

    Attributes
    ----------
    article_id:     Source article identifier.
    target_id:      Matched target's opaque ID (join key).
    target_type:    ``"contributor"`` or ``"project"``.
    display_name:   Human-readable target label.
    score:          Combined attribution score in [0.0, 1.0].
    confidence_tier: ``"high"`` | ``"medium"`` | ``"low"`` | ``"very_low"``.
    low_confidence: ``True`` when tier is ``"very_low"`` — callers should
                    handle these results defensively.
    signals:        Per-signal breakdown for explainability / tuning.
    scorer_version: Monotonic scorer version string.
    """

    article_id: str
    target_id: str
    target_type: str
    display_name: str
    score: float
    confidence_tier: str
    low_confidence: bool
    signals: List[SignalBreakdown] = field(default_factory=list)
    scorer_version: str = "attribution_scorer_v1"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "article_id": self.article_id,
            "target_id": self.target_id,
            "target_type": self.target_type,
            "display_name": self.display_name,
            "score": round(self.score, 4),
            "confidence_tier": self.confidence_tier,
            "low_confidence": self.low_confidence,
            "signals": [s.to_dict() for s in self.signals],
            "scorer_version": self.scorer_version,
        }


# ---------------------------------------------------------------------------
# Scorer
# ---------------------------------------------------------------------------


class AttributionScorer:
    """
    Score narrative attribution between articles and contributor/project targets.

    Usage
    -----
    scorer = AttributionScorer()

    target = AttributionTarget(
        target_id="10001",
        target_type="project",
        display_name="PulseProject 1",
        aliases=["PulseProject 1", "pulse-project-1", "XLM"],
        stable_entity_ids=["project:10001"],
        known_categories=["crypto", "stellar", "defi"],
    )

    article = {
        "article_id": "art-001",
        "title": "PulseProject 1 ships major upgrade",
        "summary": "The XLM-based project released v2...",
        "content": "...",
        "detected_entities": ["PulseProject 1", "XLM"],
        "onchain_entity_links": [{"stable_entity_id": "project:10001", ...}],
        "categories": ["crypto", "stellar"],
        "sentiment_score": 0.6,
    }

    result = scorer.score(article, target)
    print(result.confidence_tier)  # "high"
    print(result.to_dict())        # full breakdown for tuning
    """

    SCORER_VERSION = "attribution_scorer_v1"

    def score(
        self,
        article: Dict[str, Any],
        target: AttributionTarget,
    ) -> AttributionResult:
        """
        Compute an attribution score for one (article, target) pair.

        Parameters
        ----------
        article:
            Article dict with keys: article_id, title, summary, content,
            detected_entities, onchain_entity_links, categories,
            sentiment_score, keywords.  All keys are optional — missing
            fields reduce available signal coverage rather than raising.
        target:
            The contributor or project to score against.

        Returns
        -------
        AttributionResult
        """
        article_id = str(article.get("article_id") or "")

        # --- Collect all signals -----------------------------------------
        signals: List[SignalBreakdown] = [
            self._entity_link_signal(article, target),
            self._mention_signal(article, target),
            self._keyword_signal(article, target),
            self._sentiment_coherence_signal(article, target),
            self._category_signal(article, target),
        ]

        # --- Weighted average -------------------------------------------
        total_weight = sum(s.weight for s in signals)
        if total_weight == 0:  # should never happen, but guard defensively
            score = 0.0
        else:
            score = sum(s.contribution() for s in signals) / total_weight

        score = max(0.0, min(1.0, score))  # clip to [0, 1]

        # --- Confidence tier ---------------------------------------------
        tier = _confidence_tier(score)
        low_confidence = tier == "very_low"

        if low_confidence:
            logger.debug(
                "Low-confidence attribution for article=%s target=%s score=%.3f",
                article_id,
                target.target_id,
                score,
            )

        return AttributionResult(
            article_id=article_id,
            target_id=target.target_id,
            target_type=target.target_type,
            display_name=target.display_name,
            score=score,
            confidence_tier=tier,
            low_confidence=low_confidence,
            signals=signals,
            scorer_version=self.SCORER_VERSION,
        )

    def score_batch(
        self,
        articles: Sequence[Dict[str, Any]],
        targets: Sequence[AttributionTarget],
    ) -> List[AttributionResult]:
        """
        Score all (article, target) combinations.

        Returns results sorted descending by score, with low-confidence
        entries at the end.
        """
        results: List[AttributionResult] = []
        for article in articles:
            for target in targets:
                results.append(self.score(article, target))

        results.sort(key=lambda r: (not r.low_confidence, r.score), reverse=True)
        return results

    # ------------------------------------------------------------------
    # Signal implementations
    # ------------------------------------------------------------------

    def _entity_link_signal(
        self,
        article: Dict[str, Any],
        target: AttributionTarget,
    ) -> SignalBreakdown:
        """
        Signal: a deliberate onchain_entity_link in the article explicitly
        references one of the target's stable entity IDs.

        This is the strongest evidence because the link was produced by the
        OnchainEntityLinker with its own confidence score, so we incorporate
        that confidence directly rather than using a flat 1.0.
        """
        name = "entity_link"
        weight = _SIGNAL_WEIGHTS[name]

        links: List[Dict[str, Any]] = article.get("onchain_entity_links") or []
        target_stable_ids = {sid.lower() for sid in (target.stable_entity_ids or [])}

        if not target_stable_ids or not links:
            return SignalBreakdown(
                name=name,
                weight=weight,
                fired=False,
                value=0.0,
                detail="No onchain entity links or no stable IDs configured for target.",
            )

        best_conf: float = 0.0
        matched_id: Optional[str] = None

        for link in links:
            # Support both key spellings used by different parts of the codebase.
            link_id = (
                link.get("stable_entity_id") or link.get("stable_id") or ""
            ).lower()
            if link_id in target_stable_ids:
                conf = float(link.get("confidence") or 0.0)
                if conf > best_conf:
                    best_conf = conf
                    matched_id = link.get("stable_entity_id") or link.get("stable_id")

        if matched_id:
            return SignalBreakdown(
                name=name,
                weight=weight,
                fired=True,
                value=best_conf,
                detail=f"Onchain entity link matched stable_id={matched_id!r} "
                       f"with confidence={best_conf:.2f}.",
            )

        return SignalBreakdown(
            name=name,
            weight=weight,
            fired=False,
            value=0.0,
            detail=f"No onchain entity link matched stable IDs {sorted(target_stable_ids)}.",
        )

    def _mention_signal(
        self,
        article: Dict[str, Any],
        target: AttributionTarget,
    ) -> SignalBreakdown:
        """
        Signal: the target's name, address, or handle appears directly in
        detected_entities or in the raw article text.

        Score = number of distinct alias hits / total aliases, capped at 1.0.
        Multiple matches provide stronger evidence than a single coincidence.
        """
        name = "mention"
        weight = _SIGNAL_WEIGHTS[name]

        aliases = list(target.aliases or [])
        if target.target_id and target.target_id not in aliases:
            aliases.append(target.target_id)

        if not aliases:
            return SignalBreakdown(
                name=name,
                weight=weight,
                fired=False,
                value=0.0,
                detail="No aliases configured for target.",
            )

        detected: List[str] = [
            str(e).lower()
            for e in (article.get("detected_entities") or [])
        ]

        # Build a searchable corpus from all text fields.
        corpus = _build_text_corpus(article).lower()

        hits: List[str] = []
        for alias in aliases:
            alias_lower = alias.lower()
            if alias_lower in detected:
                hits.append(alias)
                continue
            # Whole-word / whole-token match in the full corpus.
            pattern = r"(?<![a-z0-9_$])" + re.escape(alias_lower) + r"(?![a-z0-9_-])"
            if re.search(pattern, corpus):
                hits.append(alias)

        unique_hits = list(dict.fromkeys(hits))  # preserve order, dedupe

        if not unique_hits:
            return SignalBreakdown(
                name=name,
                weight=weight,
                fired=False,
                value=0.0,
                detail=f"No alias matched detected entities or article text. "
                       f"Tried: {aliases[:5]}{'...' if len(aliases) > 5 else ''}.",
            )

        # Normalise: more distinct hits → higher value, maxing out at 1.0.
        value = min(1.0, len(unique_hits) / max(1, len(aliases)))
        return SignalBreakdown(
            name=name,
            weight=weight,
            fired=True,
            value=value,
            detail=f"Matched {len(unique_hits)} alias(es): {unique_hits[:5]}"
                   f"{'...' if len(unique_hits) > 5 else ''}.",
        )

    def _keyword_signal(
        self,
        article: Dict[str, Any],
        target: AttributionTarget,
    ) -> SignalBreakdown:
        """
        Signal: target aliases appear in the article's extracted keywords list
        or in the title / summary where the signal density is higher.

        Keyword lists are pre-computed by KeywordExtractor; a match here means
        the target's term was prominent enough to be indexed.
        """
        name = "keyword"
        weight = _SIGNAL_WEIGHTS[name]

        aliases = {a.lower() for a in (target.aliases or [])}
        asset_codes = {c.lower() for c in (target.asset_codes or [])}
        searchable = aliases | asset_codes

        if not searchable:
            return SignalBreakdown(
                name=name,
                weight=weight,
                fired=False,
                value=0.0,
                detail="No aliases or asset codes configured for keyword matching.",
            )

        article_keywords = {
            str(k).lower() for k in (article.get("keywords") or [])
        }

        # Also scan title and summary directly (rich signal density).
        title_summary = " ".join(
            filter(None, [article.get("title"), article.get("summary")])
        ).lower()

        keyword_hits = searchable & article_keywords
        inline_hits: set = set()
        for term in searchable:
            pattern = r"(?<![a-z0-9_$])" + re.escape(term) + r"(?![a-z0-9_-])"
            if re.search(pattern, title_summary):
                inline_hits.add(term)

        all_hits = keyword_hits | inline_hits

        if not all_hits:
            return SignalBreakdown(
                name=name,
                weight=weight,
                fired=False,
                value=0.0,
                detail=f"No keyword/title-summary hits for terms "
                       f"{sorted(searchable)[:5]}{'...' if len(searchable) > 5 else ''}.",
            )

        # Keyword hits earn 0.6 base; each inline (title/summary) hit adds 0.2.
        value = min(1.0, 0.5 * bool(keyword_hits) + 0.5 * bool(inline_hits))
        return SignalBreakdown(
            name=name,
            weight=weight,
            fired=True,
            value=value,
            detail=(
                f"Keyword hits: {sorted(keyword_hits)}; "
                f"title/summary hits: {sorted(inline_hits)}."
            ),
        )

    def _sentiment_coherence_signal(
        self,
        article: Dict[str, Any],
        target: AttributionTarget,
    ) -> SignalBreakdown:
        """
        Signal: the article's sentiment score is non-neutral, which makes it
        more likely the article discusses a specific actor rather than just
        reporting ecosystem-wide news.

        A stronger (more extreme) sentiment — positive or negative — is
        evidence of a focused narrative.  A near-zero sentiment is typical of
        broad market summaries with no clear protagonist.

        This is a soft, supporting signal (weight 0.10) and does not fire when
        the sentiment field is absent.
        """
        name = "sentiment_coherence"
        weight = _SIGNAL_WEIGHTS[name]

        raw_sentiment = article.get("sentiment_score")

        if raw_sentiment is None:
            return SignalBreakdown(
                name=name,
                weight=weight,
                fired=False,
                value=0.0,
                detail="No sentiment_score in article; signal skipped.",
            )

        sentiment = float(raw_sentiment)
        magnitude = abs(sentiment)  # 0.0 (neutral) → 1.0 (extreme)

        # Only consider it a real signal if the sentiment crosses the VADER
        # neutral threshold already used elsewhere in the project (|score| > 0.05).
        if magnitude <= 0.05:
            return SignalBreakdown(
                name=name,
                weight=weight,
                fired=False,
                value=0.0,
                detail=f"Sentiment magnitude {magnitude:.3f} ≤ 0.05 — neutral; "
                       "no attribution evidence.",
            )

        return SignalBreakdown(
            name=name,
            weight=weight,
            fired=True,
            value=round(magnitude, 4),
            detail=f"Sentiment score {sentiment:.3f} (magnitude {magnitude:.3f}) "
                   "suggests focused narrative.",
        )

    def _category_signal(
        self,
        article: Dict[str, Any],
        target: AttributionTarget,
    ) -> SignalBreakdown:
        """
        Signal: overlap between article categories and the target's known topic
        categories.

        Jaccard similarity is used so that a target with many categories isn't
        unfairly advantaged over a narrow one.
        """
        name = "category"
        weight = _SIGNAL_WEIGHTS[name]

        target_cats = {c.lower() for c in (target.known_categories or [])}
        article_cats = {
            str(c).lower() for c in (article.get("categories") or [])
        }

        if not target_cats:
            return SignalBreakdown(
                name=name,
                weight=weight,
                fired=False,
                value=0.0,
                detail="No known_categories configured for target.",
            )

        if not article_cats:
            return SignalBreakdown(
                name=name,
                weight=weight,
                fired=False,
                value=0.0,
                detail="Article has no categories.",
            )

        intersection = target_cats & article_cats
        union = target_cats | article_cats
        jaccard = len(intersection) / len(union) if union else 0.0

        if not intersection:
            return SignalBreakdown(
                name=name,
                weight=weight,
                fired=False,
                value=0.0,
                detail=f"No category overlap. Article: {sorted(article_cats)}; "
                       f"Target: {sorted(target_cats)}.",
            )

        return SignalBreakdown(
            name=name,
            weight=weight,
            fired=True,
            value=round(jaccard, 4),
            detail=(
                f"Category overlap: {sorted(intersection)} "
                f"(Jaccard={jaccard:.3f})."
            ),
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _confidence_tier(score: float) -> str:
    """Map a [0, 1] score to a human-readable confidence tier string."""
    if score >= HIGH_CONFIDENCE_THRESHOLD:
        return "high"
    if score >= MEDIUM_CONFIDENCE_THRESHOLD:
        return "medium"
    if score >= LOW_CONFIDENCE_THRESHOLD:
        return "low"
    return "very_low"


def _build_text_corpus(article: Dict[str, Any]) -> str:
    """Concatenate all text fields of an article for broad alias searching."""
    parts = [
        article.get("title") or "",
        article.get("summary") or "",
        article.get("content") or "",
        " ".join(article.get("keywords") or []),
        " ".join(str(e) for e in (article.get("detected_entities") or [])),
    ]
    return " ".join(p for p in parts if p)
