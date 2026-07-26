"""Tests for per-contract ingestion lag metrics.

Covers:
- Lag calculated correctly per domain
- Threshold alert triggered when lag exceeds configured value
- Zero-lag case (processed events are up to date with on-chain events)
- Missing domain data handled gracefully (no contract ID, no DB rows)
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch, PropertyMock

import pytest

from prometheus_client import REGISTRY

from src.ingestion.contract_lag_metrics import (
    DOMAINS,
    ContractLagSnapshot,
    _get_thresholds,
    _severity,
    measure_contract_lag,
    run_contract_lag_cycle,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_postgres(raw_ts: datetime | None, processed_ts: datetime | None) -> MagicMock:
    """Return a mock PostgresService whose session returns fixed timestamps."""
    session_mock = MagicMock()

    # scalar_one_or_none() returns values in call order:
    # first call → raw_ts (RawSorobanEvent.created_at max)
    # second call → processed_ts (ContractEvent.timestamp max)
    session_mock.execute.return_value.scalar_one_or_none.side_effect = [
        raw_ts,
        processed_ts,
    ]

    ctx = MagicMock()
    ctx.__enter__ = MagicMock(return_value=session_mock)
    ctx.__exit__ = MagicMock(return_value=False)

    postgres = MagicMock()
    postgres.get_session.return_value = ctx
    return postgres


# ---------------------------------------------------------------------------
# _get_thresholds
# ---------------------------------------------------------------------------

def test_get_thresholds_defaults():
    t = _get_thresholds("vault")
    assert t["warning"] == 300.0
    assert t["critical"] == 900.0


def test_get_thresholds_from_env(monkeypatch):
    monkeypatch.setenv("CONTRACT_LAG_WARNING_SECONDS_VAULT", "120")
    monkeypatch.setenv("CONTRACT_LAG_CRITICAL_SECONDS_VAULT", "600")
    t = _get_thresholds("vault")
    assert t["warning"] == 120.0
    assert t["critical"] == 600.0


# ---------------------------------------------------------------------------
# _severity
# ---------------------------------------------------------------------------

def test_severity_healthy():
    assert _severity(10.0, "vault") == "healthy"


def test_severity_warning():
    # default warning = 300 s
    assert _severity(400.0, "vault") == "warning"


def test_severity_critical():
    # default critical = 900 s
    assert _severity(1000.0, "vault") == "critical"


# ---------------------------------------------------------------------------
# measure_contract_lag – zero lag (caught up)
# ---------------------------------------------------------------------------

def test_measure_contract_lag_zero_lag():
    now = datetime.now(timezone.utc)
    # raw and processed timestamps are equal → lag = 0
    postgres = _make_postgres(raw_ts=now, processed_ts=now)

    with patch(
        "src.ingestion.contract_lag_metrics._contract_id_for",
        return_value="CFAKECONTRACTID",
    ):
        snap = measure_contract_lag("vault", postgres)

    assert snap.lag_seconds == 0.0
    assert snap.severity == "healthy"
    assert snap.domain == "vault"


# ---------------------------------------------------------------------------
# measure_contract_lag – lag calculated correctly per domain
# ---------------------------------------------------------------------------

def test_measure_contract_lag_calculates_lag_correctly():
    now = datetime.now(timezone.utc)
    raw_ts = now  # on-chain arrived at "now"
    processed_ts = now - timedelta(seconds=500)  # processed 500 s ago

    postgres = _make_postgres(raw_ts=raw_ts, processed_ts=processed_ts)

    with patch(
        "src.ingestion.contract_lag_metrics._contract_id_for",
        return_value="CFAKECONTRACTID",
    ):
        snap = measure_contract_lag("registry", postgres)

    assert snap.lag_seconds == pytest.approx(500.0, abs=1.0)
    assert snap.severity == "warning"  # 500 > 300 (warning), < 900 (critical)
    assert snap.domain == "registry"


def test_measure_contract_lag_critical_threshold():
    now = datetime.now(timezone.utc)
    postgres = _make_postgres(
        raw_ts=now,
        processed_ts=now - timedelta(seconds=1000),
    )

    with patch(
        "src.ingestion.contract_lag_metrics._contract_id_for",
        return_value="CFAKECONTRACTID",
    ):
        snap = measure_contract_lag("treasury", postgres)

    assert snap.lag_seconds == pytest.approx(1000.0, abs=1.0)
    assert snap.severity == "critical"


# ---------------------------------------------------------------------------
# measure_contract_lag – custom threshold alert
# ---------------------------------------------------------------------------

def test_threshold_alert_triggered_when_exceeded(monkeypatch):
    monkeypatch.setenv("CONTRACT_LAG_WARNING_SECONDS_VAULT", "60")
    monkeypatch.setenv("CONTRACT_LAG_CRITICAL_SECONDS_VAULT", "120")

    now = datetime.now(timezone.utc)
    postgres = _make_postgres(
        raw_ts=now,
        processed_ts=now - timedelta(seconds=90),  # 90 s – between warning and critical
    )

    with patch(
        "src.ingestion.contract_lag_metrics._contract_id_for",
        return_value="CFAKECONTRACTID",
    ):
        snap = measure_contract_lag("vault", postgres)

    assert snap.lag_seconds == pytest.approx(90.0, abs=1.0)
    assert snap.severity == "warning"
    assert snap.warning_threshold_seconds == 60.0
    assert snap.critical_threshold_seconds == 120.0


def test_threshold_critical_alert_triggered(monkeypatch):
    monkeypatch.setenv("CONTRACT_LAG_WARNING_SECONDS_MATCHING_POOL", "60")
    monkeypatch.setenv("CONTRACT_LAG_CRITICAL_SECONDS_MATCHING_POOL", "120")

    now = datetime.now(timezone.utc)
    postgres = _make_postgres(
        raw_ts=now,
        processed_ts=now - timedelta(seconds=200),
    )

    with patch(
        "src.ingestion.contract_lag_metrics._contract_id_for",
        return_value="CFAKECONTRACTID",
    ):
        snap = measure_contract_lag("matching_pool", postgres)

    assert snap.severity == "critical"


# ---------------------------------------------------------------------------
# measure_contract_lag – missing domain data handled gracefully
# ---------------------------------------------------------------------------

def test_missing_contract_id_returns_missing_severity():
    postgres = MagicMock()

    with patch(
        "src.ingestion.contract_lag_metrics._contract_id_for",
        return_value=None,
    ):
        snap = measure_contract_lag("vesting", postgres)

    assert snap.severity == "missing"
    assert snap.lag_seconds is None
    assert snap.contract_id is None
    # DB should never be queried for a missing contract ID
    postgres.get_session.assert_not_called()


def test_no_raw_soroban_events_returns_missing_severity():
    """Domain configured but no raw_soroban_events rows → missing."""
    postgres = _make_postgres(raw_ts=None, processed_ts=None)

    with patch(
        "src.ingestion.contract_lag_metrics._contract_id_for",
        return_value="CFAKECONTRACTID",
    ):
        snap = measure_contract_lag("vault", postgres)

    assert snap.severity == "missing"
    assert snap.lag_seconds is None


def test_no_processed_events_returns_lag_from_raw_ts():
    """Raw events exist but contract_events is empty → lag measured from now."""
    now = datetime.now(timezone.utc)
    raw_ts = now - timedelta(seconds=400)  # arrived 400 s ago, never processed

    postgres = _make_postgres(raw_ts=raw_ts, processed_ts=None)

    with patch(
        "src.ingestion.contract_lag_metrics._contract_id_for",
        return_value="CFAKECONTRACTID",
    ):
        snap = measure_contract_lag("vault", postgres)

    assert snap.lag_seconds == pytest.approx(400.0, abs=5.0)
    assert snap.severity == "warning"  # > 300 s


def test_db_error_returns_missing_gracefully():
    """If the DB query raises, the function returns severity='missing', no crash."""
    postgres = MagicMock()
    ctx = MagicMock()
    ctx.__enter__ = MagicMock(side_effect=RuntimeError("connection refused"))
    ctx.__exit__ = MagicMock(return_value=False)
    postgres.get_session.return_value = ctx

    with patch(
        "src.ingestion.contract_lag_metrics._contract_id_for",
        return_value="CFAKECONTRACTID",
    ):
        snap = measure_contract_lag("registry", postgres)

    assert snap.severity == "missing"
    assert snap.lag_seconds is None


# ---------------------------------------------------------------------------
# Prometheus metric published
# ---------------------------------------------------------------------------

def test_prometheus_gauge_updated():
    now = datetime.now(timezone.utc)
    postgres = _make_postgres(
        raw_ts=now,
        processed_ts=now - timedelta(seconds=42),
    )

    with patch(
        "src.ingestion.contract_lag_metrics._contract_id_for",
        return_value="CFAKECONTRACTID",
    ):
        from src.ingestion.contract_lag_metrics import _publish_snapshot
        snap = measure_contract_lag("vault", postgres)
        _publish_snapshot(snap)

    value = REGISTRY.get_sample_value(
        "lumenpulse_contract_ingestion_lag_seconds",
        {"domain": "vault"},
    )
    assert value == pytest.approx(42.0, abs=1.0)


# ---------------------------------------------------------------------------
# run_contract_lag_cycle
# ---------------------------------------------------------------------------

def test_run_contract_lag_cycle_healthy():
    now = datetime.now(timezone.utc)

    def _make_snap(domain, postgres):
        return ContractLagSnapshot(
            domain=domain,
            contract_id="CFAKE",
            lag_seconds=0.0,
            latest_onchain_ts=now,
            latest_processed_ts=now,
            severity="healthy",
            warning_threshold_seconds=300.0,
            critical_threshold_seconds=900.0,
        )

    with patch(
        "src.ingestion.contract_lag_metrics.measure_contract_lag",
        side_effect=_make_snap,
    ), patch(
        "src.ingestion.contract_lag_metrics.PostgresService",
        return_value=MagicMock(engine=MagicMock()),
    ):
        result = run_contract_lag_cycle()

    assert result["healthy"] is True
    assert len(result["lag_alerts"]) == 0
    assert len(result["snapshots"]) == len(DOMAINS)


def test_run_contract_lag_cycle_with_alerts():
    now = datetime.now(timezone.utc)

    def _make_snap(domain, postgres):
        return ContractLagSnapshot(
            domain=domain,
            contract_id="CFAKE",
            lag_seconds=1000.0,
            latest_onchain_ts=now,
            latest_processed_ts=now - timedelta(seconds=1000),
            severity="critical",
            warning_threshold_seconds=300.0,
            critical_threshold_seconds=900.0,
        )

    with patch(
        "src.ingestion.contract_lag_metrics.measure_contract_lag",
        side_effect=_make_snap,
    ), patch(
        "src.ingestion.contract_lag_metrics.PostgresService",
        return_value=MagicMock(engine=MagicMock()),
    ):
        result = run_contract_lag_cycle()

    assert result["healthy"] is False
    assert len(result["lag_alerts"]) == len(DOMAINS)


def test_run_contract_lag_cycle_db_unavailable():
    with patch(
        "src.ingestion.contract_lag_metrics.PostgresService",
        side_effect=Exception("no db"),
    ):
        result = run_contract_lag_cycle()

    assert result["healthy"] is False
    assert "error" in result


def test_run_contract_lag_cycle_subset_of_domains():
    now = datetime.now(timezone.utc)

    def _make_snap(domain, postgres):
        return ContractLagSnapshot(
            domain=domain,
            contract_id="CFAKE",
            lag_seconds=0.0,
            latest_onchain_ts=now,
            latest_processed_ts=now,
            severity="healthy",
            warning_threshold_seconds=300.0,
            critical_threshold_seconds=900.0,
        )

    with patch(
        "src.ingestion.contract_lag_metrics.measure_contract_lag",
        side_effect=_make_snap,
    ), patch(
        "src.ingestion.contract_lag_metrics.PostgresService",
        return_value=MagicMock(engine=MagicMock()),
    ):
        result = run_contract_lag_cycle(domains=["vault", "treasury"])

    assert len(result["snapshots"]) == 2
    domains_returned = {s["domain"] for s in result["snapshots"]}
    assert domains_returned == {"vault", "treasury"}
