"""Tests for indexer lag metrics and log-based ingestion alerting (#745)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from prometheus_client import REGISTRY

from src.ingestion import ingestion_alerting as alerting
from src.ingestion.ingestion_alerting import (
    AlertSeverity,
    evaluate_lag_alerts,
    measure_stellar_ledger_lag,
    record_source_failure,
    run_ingestion_alerting_cycle,
)


@pytest.fixture(autouse=True)
def reset_alerting_state():
    alerting._recent_failures.clear()
    alerting._last_cycle_result.clear()
    yield
    alerting._recent_failures.clear()
    alerting._last_cycle_result.clear()


def test_measure_stellar_ledger_lag_healthy():
    fetcher = MagicMock()
    closed_at = datetime.now(timezone.utc) - timedelta(seconds=10)
    with patch(
        "src.ingestion.ingestion_alerting._horizon_latest_ledger",
        return_value={
            "latest_ledger_sequence": 123,
            "ledger_close_time": closed_at.isoformat(),
        },
    ):
        snapshot = measure_stellar_ledger_lag(fetcher=fetcher)

    assert snapshot.metric_name == "stellar_ledger_lag"
    assert snapshot.severity == AlertSeverity.HEALTHY
    assert snapshot.lag_seconds < 60


def test_measure_stellar_ledger_lag_critical_when_horizon_unavailable():
    fetcher = MagicMock()
    with patch(
        "src.ingestion.ingestion_alerting._horizon_latest_ledger",
        return_value={"latest_ledger_sequence": None, "ledger_close_time": ""},
    ):
        snapshot = measure_stellar_ledger_lag(fetcher=fetcher)

    assert snapshot.severity == AlertSeverity.CRITICAL
    assert len(alerting._recent_failures) == 1


def test_evaluate_lag_alerts_publishes_metric_and_returns_alert():
    metric = alerting.LagMetricSnapshot(
        metric_name="stellar_ledger_lag",
        source="stellar_horizon",
        lag_seconds=400.0,
        severity=AlertSeverity.CRITICAL,
        warning_threshold_seconds=60.0,
        critical_threshold_seconds=300.0,
        details={},
    )

    alerts = evaluate_lag_alerts([metric])

    assert len(alerts) == 1
    assert alerts[0]["alert_type"] == "indexer_lag"
    assert alerts[0]["metric"]["severity"] == "critical"
    lag_value = REGISTRY.get_sample_value(
        "lumenpulse_indexer_lag_seconds",
        {"metric_name": "stellar_ledger_lag", "source": "stellar_horizon"},
    )
    assert lag_value == 400.0


def test_record_source_failure_updates_metrics():
    before = REGISTRY.get_sample_value(
        "lumenpulse_source_failures_total",
        {"source": "news", "failure_type": "timeout"},
    ) or 0.0

    record_source_failure("news", "timeout", "request timed out")

    after = REGISTRY.get_sample_value(
        "lumenpulse_source_failures_total",
        {"source": "news", "failure_type": "timeout"},
    )
    health = REGISTRY.get_sample_value("lumenpulse_source_health", {"source": "news"})

    assert after == before + 1.0
    assert health == 0.0


def test_run_ingestion_alerting_cycle_with_mocks():
    fetcher = MagicMock()
    closed_at = datetime.now(timezone.utc) - timedelta(seconds=5)

    with patch(
        "src.ingestion.ingestion_alerting._horizon_latest_ledger",
        return_value={
            "latest_ledger_sequence": 999,
            "ledger_close_time": closed_at.isoformat(),
        },
    ), patch(
        "src.ingestion.ingestion_alerting.measure_pipeline_analytics_lag",
        return_value=None,
    ):
        result = run_ingestion_alerting_cycle(fetcher=fetcher)

    assert result["healthy"] is True
    assert len(result["metrics"]) == 1
    assert result["metrics"][0]["metric_name"] == "stellar_ledger_lag"
