"""Lexical-support-based input screening for VADER sentiment inference."""

import re
from dataclasses import dataclass
from typing import Iterable, Set

from src.analytics.keywords import CRYPTO_PROJECT_MAP, KNOWN_TICKERS, TICKER_TO_PROJECT


_TOKEN_PATTERN = re.compile(r"[^\W\d_]+(?:['’][^\W\d_]+)?", re.UNICODE)
_COMMON_ENGLISH_WORDS = frozenset(
    """
    a about after again against all also am an and any are as at be because been
    before being below between both but by can could did do does doing down during
    each few for from further had has have having he her here hers herself him
    himself his how i if in into is it its itself just me more most my myself no
    nor not of off on once only or other our ours ourselves out over own same she
    should so some such than that the their theirs them themselves then there
    these they this those through to too under until up very was we were what when
    where which while who whom why will with you your yours yourself yourselves
    """.split()
)
_CRYPTO_VOCABULARY = {
    token.lower()
    for project, aliases in CRYPTO_PROJECT_MAP.items()
    for token in (project.split() + [alias for alias in aliases])
}
_CRYPTO_VOCABULARY.update(ticker.lower() for ticker in KNOWN_TICKERS)
_CRYPTO_VOCABULARY.update(
    project.lower()
    for project_names in TICKER_TO_PROJECT.values()
    for project in project_names
)


@dataclass(frozen=True)
class OODAssessment:
    """Lexical support statistics for one input."""

    is_out_of_distribution: bool
    confidence: float
    unknown_token_ratio: float


def configured_unknown_token_ratio() -> float:
    """Read and validate the maximum tolerated unknown-token ratio."""
    import os

    raw_threshold = os.getenv("ANALYZE_OOD_MAX_UNKNOWN_TOKEN_RATIO", "0.75")
    try:
        threshold = float(raw_threshold)
    except ValueError as exc:
        raise ValueError(
            "ANALYZE_OOD_MAX_UNKNOWN_TOKEN_RATIO must be a number between 0 and 1"
        ) from exc
    if not 0.0 <= threshold <= 1.0:
        raise ValueError(
            "ANALYZE_OOD_MAX_UNKNOWN_TOKEN_RATIO must be a number between 0 and 1"
        )
    return threshold


class LexicalOODDetector:
    """Reject text when most meaningful tokens are outside VADER's vocabulary."""

    def __init__(self, vocabulary: Iterable[str], max_unknown_token_ratio: float):
        if not 0.0 <= max_unknown_token_ratio <= 1.0:
            raise ValueError("max_unknown_token_ratio must be between 0 and 1")
        self.vocabulary: Set[str] = {
            token.lower() for token in vocabulary
        } | _COMMON_ENGLISH_WORDS | _CRYPTO_VOCABULARY
        self.max_unknown_token_ratio = max_unknown_token_ratio

    def assess(self, text: str) -> OODAssessment:
        tokens = [token.lower() for token in _TOKEN_PATTERN.findall(text)]
        if not tokens:
            return OODAssessment(True, 0.0, 1.0)

        unknown_ratio = (
            sum(token not in self.vocabulary for token in tokens) / len(tokens)
        )
        return OODAssessment(
            is_out_of_distribution=unknown_ratio > self.max_unknown_token_ratio,
            confidence=1.0 - unknown_ratio,
            unknown_token_ratio=unknown_ratio,
        )


def false_positive_rate(
    detector: LexicalOODDetector, in_distribution_texts: Iterable[str]
) -> float:
    """Measure the share of known in-distribution examples rejected by detector."""
    examples = list(in_distribution_texts)
    if not examples:
        raise ValueError("in_distribution_texts must contain at least one example")
    false_positives = sum(
        detector.assess(text).is_out_of_distribution for text in examples
    )
    return false_positives / len(examples)
