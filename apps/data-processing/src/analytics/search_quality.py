"""
search_quality.py
=================
Search quality evaluator for semantic news search (#1455).

Compares the embedded (semantic) retrieval path against the existing keyword
scoring path so regressions in ranking quality are caught in CI instead of
after release.  All metrics are pure-Python/numpy — no spaCy model needed at
import time (this mirrors `feature_drift_detector`'s lightweight-yet-math
convention).

Contract
--------
* ``search_quality_report()`` — full comparison of one query against the
  corpus, producing ranking-aware metrics (precision@k, recall@k, nDCG@k,
  paired RBO vs. keyword baseline, and novel-hit share).
* Underlying primitives are individually tested (``tests/test_search_quality.py``)
  and kept deterministic so a ruff/black-stable, hash-pinned process can
  reproduce a report byte-for-byte.

Guards
------
* Importable without spaCy/sklearn/transformers (only ``math`` + ``numpy``).
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Sequence

try:  # conftest shims numpy out of the loop when absent (#1231)
    import numpy as np
except Exception:  # pragma: no cover - exercised only in CI with numpy
    np = None  # type: ignore[assignment]

# Token boundary used by :func:`keyword_score` (pure regex, deterministic).
_WORD_RE = re.compile(r"[A-Za-z0-9]+")


@dataclass(frozen=True)
class SearchQualityReport:
    """Aggregate ranking-quality metrics for one query."""

    query: str
    model_version: str
    precision_at_1: float
    precision_at_5: float
    precision_at_10: float
    recall_at_5: float
    recall_at_10: float
    ndcg_at_5: float
    ndcg_at_10: float
    rbo_vs_keyword: float
    new_hits_share: float  # fraction of top-10 hits not in keyword top-10
    retrieved: int
    relevant: int

    def to_dict(self) -> Dict[str, object]:  # compact JSON-friendly form
        return {
            "query": self.query,
            "model_version": self.model_version,
            "precision@1": self.precision_at_1,
            "precision@5": self.precision_at_5,
            "precision@10": self.precision_at_10,
            "recall@5": self.recall_at_5,
            "recall@10": self.recall_at_10,
            "ndcg@5": self.ndcg_at_5,
            "ndcg@10": self.ndcg_at_10,
            "rbo_vs_keyword": self.rbo_vs_keyword,
            "new_hits_share": self.new_hits_share,
            "retrieved": self.retrieved,
            "relevant": self.relevant,
        }


def _rel_at(grade: float) -> float:
    """Map a relevance grade [0.0, 1.0] to gain; >0 counts as relevant."""
    return 1.0 if grade > 0.0 else 0.0


def precision_at_k(
    ranking: Sequence[float], k: int, *, threshold: float = 0.5
) -> float:
    """Fraction of the top-``k`` that are relevant (grade >= threshold)."""
    if k <= 0 or not ranking:
        return 0.0
    top = list(ranking)[:k]
    relevant = sum(1 for g in top if g >= threshold)
    return relevant / len(top)


def recall_at_k(
    ranking: Sequence[float],
    k: int,
    total_relevant: int,
    *,
    threshold: float = 0.5,
) -> float:
    """Fraction of *all* relevant items recovered in the top-``k``."""
    if total_relevant <= 0 or k <= 0:
        return 0.0
    top = list(ranking)[:k]
    found = sum(1 for g in top if g >= threshold)
    return found / total_relevant


def ndcg_at_k(ranking: Sequence[float], k: int) -> float:
    """Normalised discounted cumulative gain for the top-``k``."""
    if k <= 0 or not ranking:
        return 0.0
    top = list(ranking)[:k]
    ideal = sorted((max(g, 0.0) for g in top), reverse=True)

    def _dcg(grades: Sequence[float]) -> float:
        return sum(
            (2.0**grade - 1.0) / math.log2(idx + 2.0)
            for idx, grade in enumerate(grades)
        )

    dcg = _dcg(top)
    idcg = _dcg(ideal)
    return dcg / idcg if idcg > 0.0 else 0.0


def rank_biased_overlap(a: Sequence[str], b: Sequence[str], p: float = 0.9) -> float:
    """
    Rank-biased overlap between two (possibly different-length) rankings.

    Standard finite RBO over prefixes, re-scaled so identical rankings score
    1.0 (and disjoint rankings 0.0), so the metric is comparable across
    corpora of different sizes in the quality report.
    """
    a = list(a)
    b = list(b)
    max_len = max(len(a), len(b))
    if max_len == 0:
        return 1.0
    seen_a: set = set()
    seen_b: set = set()
    agreement_sum = 0.0
    for depth in range(1, max_len + 1):
        if depth <= len(a):
            seen_a.add(a[depth - 1])
        if depth <= len(b):
            seen_b.add(b[depth - 1])
        agreement = len(seen_a & seen_b) / depth
        agreement_sum += (p ** (depth - 1)) * agreement
    bounded = (1.0 - p) * agreement_sum
    denom = 1.0 - p**max_len
    return bounded / denom if denom > 0 else 1.0


def keyword_score(query: str, text: str) -> float:
    """
    Deterministic keyword relevance of ``text`` for ``query``, in [0, 1].

    Mirrors how a legacy keyword ranker scores articles: query-token overlap
    weighted by log term-frequency, compressed into [0, 1] so it composes with
    semantic similarity grades in :func:`search_quality_report`. Empty inputs
    score 0.0; adding any matching term strictly raises the score.
    """
    q_terms = _WORD_RE.findall((query or "").lower())
    doc_terms = _WORD_RE.findall((text or "").lower())
    if not q_terms or not doc_terms:
        return 0.0
    term_freq = Counter(doc_terms)
    matches = sum(
        math.log1p(term_freq[term]) for term in set(q_terms) if term in term_freq
    )
    return 1.0 - math.exp(-matches)


def _normalize(vec: Sequence[float]) -> List[float]:
    """L2-normalize a vector (matches embedding_service semantics)."""
    if np is not None:
        a = np.asarray(vec, dtype=np.float64)
        norm = float(np.linalg.norm(a))
        if norm == 0.0:
            return list(vec)
        return (a / norm).tolist()
    # Pure fallback so tests run even when numpy is stubbed out.
    norm = math.sqrt(sum(x * x for x in vec))
    if norm == 0.0:
        return list(vec)
    return [x / norm for x in vec]


def cosine_similarity(a: Sequence[float], b: Sequence[float]) -> float:
    """Cosine similarity between two vectors (0.0 if degenerate)."""
    a = _normalize(a)
    b = _normalize(b)
    if not a or not b or len(a) != len(b):
        return 0.0
    return float(sum(x * y for x, y in zip(a, b)))


# ── Report builder ──────────────────────────────────────────────────────────


def search_quality_report(
    query: str,
    *,
    semantic_scores: Sequence[float],
    keyword_scores: Sequence[float],
    article_ids: Sequence[str],
    relevance_grades: Optional[Sequence[float]] = None,
    threshold: float = 0.5,
    model_version: str = "en_core_web_md-3.7.1",
) -> SearchQualityReport:
    """
    Evaluate one query's semantic ranking against its keyword baseline.

    ``semantic_scores`` / ``keyword_scores`` must be parallel to
    ``article_ids`` (higher = more relevant).  When ``relevance_grades`` is
    supplied it is used for precision/recall/nDCG; otherwise the semantic
    similarity itself is treated as the relevance grade so the endpoint can
    self-evaluate without hand labels.
    """
    svg_order = list(
        sorted(
            range(len(semantic_scores)),
            key=lambda i: semantic_scores[i],
            reverse=True,
        )
    )
    kw_order = list(
        sorted(
            range(len(keyword_scores)),
            key=lambda i: keyword_scores[i],
            reverse=True,
        )
    )
    grades = relevance_grades if relevance_grades is not None else semantic_scores
    svg_ranking = [grades[i] for i in svg_order]

    top_kw = {article_ids[i] for i in kw_order[:10]}
    svg_ids = [article_ids[i] for i in svg_order]
    new_hits = [aid for aid in svg_ids[:10] if aid not in top_kw]

    total_relevant = sum(1 for g in grades if g >= threshold)
    return SearchQualityReport(
        query=query,
        model_version=model_version,
        precision_at_1=precision_at_k(list(svg_ranking), 1, threshold=threshold),
        precision_at_5=precision_at_k(list(svg_ranking), 5, threshold=threshold),
        precision_at_10=precision_at_k(list(svg_ranking), 10, threshold=threshold),
        recall_at_5=recall_at_k(
            list(svg_ranking), 5, total_relevant, threshold=threshold
        ),
        recall_at_10=recall_at_k(
            list(svg_ranking), 10, total_relevant, threshold=threshold
        ),
        ndcg_at_5=ndcg_at_k(list(svg_ranking), 5),
        ndcg_at_10=ndcg_at_k(list(svg_ranking), 10),
        rbo_vs_keyword=rank_biased_overlap(
            [article_ids[i] for i in svg_order[:10]],
            [article_ids[i] for i in kw_order[:10]],
        ),
        new_hits_share=len(new_hits) / min(10, len(svg_ids)) if svg_ids else 0.0,
        retrieved=len(svg_ids),
        relevant=total_relevant,
    )


def summarize(reports: Iterable[SearchQualityReport]) -> Dict[str, object]:
    """Aggregate a set of per-query reports into mean metrics (for PR gates)."""
    reports = list(reports)
    if not reports:
        return {}
    keys = [
        "precision_at_1",
        "precision_at_5",
        "precision_at_10",
        "recall_at_5",
        "recall_at_10",
        "ndcg_at_5",
        "ndcg_at_10",
        "rbo_vs_keyword",
        "new_hits_share",
    ]
    return {
        "queries": len(reports),
        **{
            key: round(sum(getattr(r, key) for r in reports) / len(reports), 6)
            for key in keys
        },
    }
