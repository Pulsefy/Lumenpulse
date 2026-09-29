"""Per-token sentiment score explanations (#1456).

A sentiment score alone cannot be disputed or audited.  This module lets an
analyzer (``src/analytics/sentiment.py`` or the VADER-backed
``src/sentiment.py`` analyzer used by ``POST /analyze``) optionally explain
which tokens moved the score.  Every per-token contribution references the
**lexicon entry** or **model feature** that was responsible, e.g.:

- ``lexicon:crypto:positive:moon``  — the project's crypto-slant lexicon
- ``lexicon:vader:crash``           — a VADER lexicon entry
- ``lexicon:vader:booster:very``    — a VADER booster word
- ``lexicon:vader:negator:not``     — a VADER negation word
- ``model:finbert:<token>``          — a token feature consumed by FinBERT

Explanations are **off by default** and incur a documented latency overhead.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

# Feature kinds used to discriminate "project/vendor lexicon" against "model".
LEXICON_FEATURE_KIND = "lexicon"
MODEL_FEATURE_KIND = "model"

# Maximum number of tokens evaluated for a leave-one-out explanation.  This
# bounds the latency overhead: at most ``MAX_EXPLAIN_TOKENS`` extra scorer
# calls (e.g. VADER ``polarity_scores`` or FinBERT forward passes).
MAX_EXPLAIN_TOKENS = 20

# Tokens with no lexicon/feature entry add nothing to the score by definition;
# they are skipped so leave-one-out work stays proportional to the number of
# sentiment-bearing tokens (*O(explainable tokens) extra scorer calls*).
_TOKEN_RE = re.compile(r"[A-Za-z0-9]+")

# Documented upper bound (per method) on the extra work performed when an
# explanation is requested.  This is the latency overhead ceiling promised in
# SENTIMENT_EXPLANATIONS.md (#1456); it holds regardless of input length.
EXPLAIN_EXTRA_WORK: Dict[str, str] = {
    "finbert": (
        f"at most {MAX_EXPLAIN_TOKENS} extra transformer forward passes, "
        "each truncated to 512 tokens"
    ),
    "vader": (
        f"at most {MAX_EXPLAIN_TOKENS} extra VADER polarity_scores calls "
        "(only for tokens backed by a lexicon/feature entry)"
    ),
    "vader+crypto_fallback": "no extra scoring: pure lexicon lookup",
    "keyword:es": "no extra scoring: pure lexicon lookup",
    "keyword:pt": "no extra scoring: pure lexicon lookup",
    "none": "no extra work",
}


def explanation_latency_overhead(method: str) -> str:
    """Return the documented upper bound on extra work for ``method``."""
    return EXPLAIN_EXTRA_WORK.get(
        method, "at most {} extra scorer calls".format(MAX_EXPLAIN_TOKENS)
    )


@dataclass(frozen=True)
class FeatureContribution:
    """A single token's contribution to a sentiment score."""

    token: str
    contribution: float
    feature: str  # lexicon entry or model feature responsible
    kind: str = LEXICON_FEATURE_KIND
    note: str = ""  # e.g. why a matched lexicon entry did not move the score

    def to_dict(self) -> Dict[str, Any]:
        return {
            "token": self.token,
            "contribution": round(float(self.contribution), 6),
            "feature": self.feature,
            "kind": self.kind,
            "note": self.note,
        }


@dataclass
class SentimentExplanation:
    """Decomposition of a sentiment score into per-token contributions."""

    method: str  # finbert | vader | vader+crypto_fallback | keyword:<lang> | none
    score: float
    contributions: Tuple[FeatureContribution, ...] = ()
    unattributed: float = 0.0
    model: Optional[str] = None  # transformer model name when method == finbert

    def to_dict(self) -> Dict[str, Any]:
        ordered = tuple(
            sorted(self.contributions, key=lambda c: -abs(c.contribution))
        )
        return {
            "method": self.method,
            "score": round(float(self.score), 6),
            "contributions": [c.to_dict() for c in ordered],
            "unattributed": round(float(self.unattributed), 6),
            "model": self.model,
        }


def content_tokens(text: str) -> List[Tuple[str, int, int]]:
    """Return (token, start, end) spans for every alphanumeric word in text."""
    return [(m.group(0), m.start(), m.end()) for m in _TOKEN_RE.finditer(text)]


def remove_span(text: str, start: int, end: int) -> str:
    """Return ``text`` with the ``[start, end)`` span removed."""
    return text[:start] + text[end:]


def empty_explanation(method: str, score: float) -> SentimentExplanation:
    """Return an explanation with no contributing tokens (e.g. neutral text)."""
    return SentimentExplanation(method=method, score=score)


def leave_one_out_explanation(
    method: str,
    text: str,
    base_score: float,
    scorer: Callable[[str], float],
    feature_for: Callable[[str], Optional[Tuple[str, str]]],
    *,
    model: Optional[str] = None,
    max_tokens: int = MAX_EXPLAIN_TOKENS,
    prioritize: Sequence[str] = (),
) -> SentimentExplanation:
    """Attribute ``base_score`` to tokens via leave-one-out re-scoring.

    For each explainable token the text is re-scored without that token and
    the contribution is ``base_score - score_without_token``.  Contributions
    therefore measure how much each token moved the returned score, which is
    what a dispute needs to investigate.  Because ``scorer`` is generally not
    linear, contributions may not add up exactly to ``base_score``; the
    remainder is surfaced as ``unattributed`` instead of being hidden.

    ``feature_for(token)`` returns ``(feature_ref, kind)`` when the token is
    backed by a lexicon entry or model feature (and should be explained), or
    ``None`` for tokens that cannot influence the score.

    Latency overhead: at most ``max_tokens`` extra calls to ``scorer``
    (partitioned to explainable tokens).  ``prioritize`` lets callers ensure
    project vocabulary (e.g. a crypto slang lexicon) is always explained even
    when the input is longer than ``max_tokens``.
    """
    priority = {str(piece).lower() for piece in prioritize}

    candidates: List[Tuple[str, int, int]] = []
    for token, start, end in content_tokens(text):
        if feature_for(token) is None:
            continue
        candidates.append((token, start, end))

    candidates.sort(key=lambda c: (c[0].lower() not in priority, c[0].lower()))
    candidates = candidates[:max_tokens]

    contributions: List[FeatureContribution] = []
    for token, start, end in candidates:
        resolved = feature_for(token)
        if resolved is None:
            continue
        feature, kind = resolved
        removed = remove_span(text, start, end)
        delta = float(base_score) - float(scorer(removed))
        contributions.append(FeatureContribution(token, delta, feature, kind))

    total = sum(c.contribution for c in contributions)
    return SentimentExplanation(
        method=method,
        score=base_score,
        contributions=tuple(contributions),
        unattributed=float(base_score) - total,
        model=model,
    )
