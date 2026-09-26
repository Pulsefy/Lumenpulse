"""Unit tests for the search quality evaluator (#1455)."""

import pytest

from src.analytics.search_quality import (
    cosine_similarity,
    keyword_score,
    ndcg_at_k,
    precision_at_k,
    rank_biased_overlap,
    recall_at_k,
    search_quality_report,
    summarize,
)


def test_precision_at_k() -> None:
    ranking = [0.9, 0.3, 0.7]
    assert precision_at_k(ranking, 2) == 0.5
    assert precision_at_k(ranking, 1) == 1.0
    assert precision_at_k(ranking, 10) == 2 / 3
    assert precision_at_k([], 2) == 0.0
    assert precision_at_k(ranking, 0) == 0.0


def test_recall_at_k() -> None:
    ranking = [0.9, 0.3, 0.7, 0.1]
    # Only grades >= 0.5 count as relevant; 4 are relevant in total.
    assert recall_at_k(ranking, 3, total_relevant=4) == 0.5
    assert recall_at_k(ranking, 10, total_relevant=2) == 1.0
    assert recall_at_k(ranking, 2, total_relevant=0) == 0.0


def test_ndcg_at_k() -> None:
    assert ndcg_at_k([1.0, 1.0, 1.0], 3) == pytest.approx(1.0)
    assert ndcg_at_k([1.0, 0.5, 0.25], 3) == pytest.approx(1.0)  # ideal order
    assert ndcg_at_k([0.0, 0.0], 2) == 0.0
    assert ndcg_at_k([], 3) == 0.0
    assert ndcg_at_k([1.0, 0.0, 1.0], 3) < 1.0  # out of order is penalised


def test_rank_biased_overlap() -> None:
    assert rank_biased_overlap(["a", "b", "c"], ["a", "b", "c"]) == pytest.approx(1.0)
    assert rank_biased_overlap([], []) == pytest.approx(1.0)
    assert rank_biased_overlap(["a", "b"], ["c", "d"]) == 0.0
    partial = rank_biased_overlap(["a", "b"], ["b", "a"])
    assert 0.0 < partial < 1.0


def test_cosine_similarity() -> None:
    assert cosine_similarity([1.0, 0.0], [1.0, 0.0]) == pytest.approx(1.0)
    assert cosine_similarity([1.0, 0.0], [0.0, 1.0]) == 0.0
    assert cosine_similarity([1.0], []) == 0.0


def test_keyword_score_basic() -> None:
    assert keyword_score("Stellar Soroban", "Stellar launches Soroban contracts") > 0.0
    assert keyword_score("zebra municipality", "Stellar Soroban contracts") == 0.0
    assert keyword_score("", "Stellar news") == 0.0
    assert keyword_score("Stellar", "") == 0.0
    assert keyword_score("Stellar", "no matches here") == 0.0


def test_keyword_score_is_monotone_in_matches() -> None:
    assert keyword_score("a b", "a b c") > keyword_score("a b", "a c")
    assert keyword_score("a", "a a a") > keyword_score("a", "a")


def test_search_quality_report_shape_and_consistency() -> None:
    article_ids = ["a1", "a2", "a3", "a4"]
    # Semantic puts the truly-relevant article first; keyword does not.
    semantic_scores = [0.95, 0.8, 0.6, 0.4]
    keyword_scores = [0.3, 0.9, 0.2, 0.1]
    relevance = [1.0, 0.75, 0.5, 0.0]

    report = search_quality_report(
        "Stellar upgrade",
        semantic_scores=semantic_scores,
        keyword_scores=keyword_scores,
        article_ids=article_ids,
        relevance_grades=relevance,
    )

    assert report.query == "Stellar upgrade"
    assert report.retrieved == 4
    assert report.relevant == 3  # grades >= 0.5
    assert report.precision_at_1 == 1.0
    assert 0.0 <= report.ndcg_at_5 <= 1.0
    assert 0.0 <= report.rbo_vs_keyword <= 1.0
    assert 0.0 <= report.new_hits_share <= 1.0
    assert report.to_dict()["query"] == "Stellar upgrade"


def test_search_quality_report_defaults_to_semantic_grades() -> None:
    report = search_quality_report(
        "query",
        semantic_scores=[0.9, 0.1, 0.1],
        keyword_scores=[0.1, 0.5, 0.5],
        article_ids=["x", "y", "z"],
    )
    assert report.relevant == 1  # only the 0.9 grade clears the 0.5 threshold


def test_summarize_aggregates_reports() -> None:
    reports = [
        search_quality_report(
            f"query{i}",
            semantic_scores=[0.9, 0.2],
            keyword_scores=[0.2, 0.9],
            article_ids=["a", "b"],
        )
        for i in range(2)
    ]
    summary = summarize(reports)
    assert summary["queries"] == 2
    assert 0.0 <= summary["ndcg_at_5"] <= 1.0
    assert summary["ndcg_at_5"] == pytest.approx(
        (reports[0].ndcg_at_5 + reports[1].ndcg_at_5) / 2
    )
    assert summarize([]) == {}
