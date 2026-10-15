"""Tests for dataset-level ingestion SLA targets and metrics."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from prometheus_client import REGISTRY

from src.ingestion.dataset_sla import (
    DatasetSLAMeasurement,
    evaluate_dataset_slas,
    get_dataset_sla_target,
    get_dataset_sla_targets,
)


def test_each_ingested_dataset_has_freshness_and_completeness_targets():
    targets = get_dataset_sla_targets()
    datasets = {target.dataset for target in targets}

    assert {
        "news_articles",
        "price_ticks",
        "social_posts",
        "stellar_ledger_events",
        "contract_events",
        "analytics_records",
    }.issubset(datasets)

    for target in targets:
        assert target.freshness_target_seconds > 0
        assert 0 < target.completeness_target_ratio <= 1
        assert target.runbook_hint


def test_env_override_for_dataset_target(monkeypatch):
    monkeypatch.setenv(
        "INGESTION_SLA_NEWS_ARTICLES_FRESHNESS_SECONDS",
        "7200",
    )
    monkeypatch.setenv(
        "INGESTION_SLA_NEWS_ARTICLES_COMPLETENESS_RATIO",
        "0.90",
    )

    target = get_dataset_sla_target("news_articles")

    assert target.freshness_target_seconds == 7200.0
    assert target.completeness_target_ratio == 0.90


def test_evaluate_dataset_slas_publishes_current_and_target_metrics():
    checked_at = datetime.now(timezone.utc)
    measurement = DatasetSLAMeasurement(
        dataset="price_ticks",
        freshness_seconds=120.0,
        completeness_ratio=0.995,
        checked_at=checked_at,
    )

    breaches = evaluate_dataset_slas([measurement])

    assert breaches == []
    assert REGISTRY.get_sample_value(
        "lumenpulse_ingestion_dataset_freshness_seconds",
        {"dataset": "price_ticks"},
    ) == 120.0
    assert REGISTRY.get_sample_value(
        "lumenpulse_ingestion_dataset_completeness_ratio",
        {"dataset": "price_ticks"},
    ) == pytest.approx(0.995)
    assert REGISTRY.get_sample_value(
        "lumenpulse_ingestion_dataset_freshness_target_seconds",
        {"dataset": "price_ticks"},
    ) == 900.0
    assert REGISTRY.get_sample_value(
        "lumenpulse_ingestion_dataset_completeness_target_ratio",
        {"dataset": "price_ticks"},
    ) == pytest.approx(0.99)


def test_evaluate_dataset_slas_returns_freshness_and_completeness_breaches():
    measurement = DatasetSLAMeasurement(
        dataset="news_articles",
        freshness_seconds=4000.0,
        completeness_ratio=0.80,
    )

    breaches = evaluate_dataset_slas([measurement])
    breach_types = {breach.sla_type for breach in breaches}

    assert breach_types == {"freshness", "completeness"}
    assert all(breach.severity == "critical" for breach in breaches)
    assert REGISTRY.get_sample_value(
        "lumenpulse_ingestion_dataset_sla_breach",
        {
            "dataset": "news_articles",
            "sla_type": "freshness",
            "severity": "critical",
        },
    ) == 1.0
