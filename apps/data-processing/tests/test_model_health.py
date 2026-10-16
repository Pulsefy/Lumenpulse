# -*- coding: utf-8 -*-
"""Unit tests for the model health / SLO monitor (#1647)."""

import json
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest

from src.ml.model_health import (
    DEGRADED,
    TRUSTWORTHY,
    UNAVAILABLE,
    ModelHealthMonitor,
    ModelHealthSnapshot,
)

NOW = datetime(2026, 10, 16, 13, 0, 0, tzinfo=timezone.utc)


def _monitor(
    tmp_path,
    *,
    live_version="v1.1",
    drift_state=TRUSTWORTHY,
    drift_detail="no drift",
    calibration_state=TRUSTWORTHY,
    calibration_detail="calibrated",
    freshness_state=TRUSTWORTHY,
    freshness_detail="fresh",
    calibration_age_seconds=None,
    freshness_age_seconds=None,
    drifted_features=None,
):
    def version_reader(model_type):
        return live_version

    def drift_check():
        return {
            "status": "ok",
            "drift_detected": drift_state == DEGRADED,
            "drifted_features": drifted_features or [],
            "schema_mismatch": False,
        }

    def calibration_reader():
        if calibration_state == UNAVAILABLE:
            return {"status": "never_run"}
        age = (
            calibration_age_seconds
            if calibration_age_seconds is not None
            else (60 if calibration_state == TRUSTWORTHY else 8 * 86400)
        )
        finished_at = (NOW - timedelta(seconds=age)).isoformat()
        return {"status": "completed", "finished_at": finished_at}

    def freshness_check():
        results = []
        severity = freshness_state
        age = freshness_age_seconds if freshness_age_seconds is not None else 10
        if freshness_state == TRUSTWORTHY:
            severity = "healthy"
        elif freshness_state == DEGRADED:
            severity = "warning"
        else:
            severity = "critical"
        results.append(
            {
                "source": "price",
                "severity": severity,
                "age_seconds": age,
            }
        )
        return {
            "checked_at": NOW.isoformat(),
            "results": results,
        }

    alerter = MagicMock(return_value=True)
    state_path = str(tmp_path / "model_health_states.json")
    return (
        ModelHealthMonitor(
            state_path=state_path,
            model_types=("sentiment",),
            version_reader=version_reader,
            drift_check=drift_check,
            calibration_reader=calibration_reader,
            freshness_check=freshness_check,
            alerter=alerter,
        ),
        alerter,
    )


@pytest.fixture
def mon():
    return _monitor


# ── overall composition ─────────────────────────────────────────────────────


def test_all_trustworthy_when_live_and_signals_ok(tmp_path, mon):
    monitor, alerter = mon(tmp_path)
    snapshot = monitor.assess("sentiment")

    assert snapshot.overall == TRUSTWORTHY
    assert snapshot.live_version == "v1.1"
    assert snapshot.drift.state == TRUSTWORTHY
    assert snapshot.calibration_age.state == TRUSTWORTHY
    assert snapshot.data_freshness.state == TRUSTWORTHY
    assert snapshot.transitioned_to_degraded is False
    alerter.assert_not_called()


def test_overall_unavailable_when_no_live_version(tmp_path, mon):
    monitor, alerter = mon(tmp_path, live_version=None)
    snapshot = monitor.assess("sentiment")

    assert snapshot.overall == UNAVAILABLE
    assert snapshot.live_version is None


def test_overall_degraded_when_drift_degraded(tmp_path, mon):
    monitor, alerter = mon(
        tmp_path, drift_state=DEGRADED, drifted_features=["volatility"]
    )
    snapshot = monitor.assess("sentiment")

    assert snapshot.overall == DEGRADED
    assert snapshot.drift.state == DEGRADED
    assert "volatility" in snapshot.drift.detail


def test_overall_degraded_when_calibration_stale(tmp_path, mon):
    monitor, _ = mon(
        tmp_path, calibration_state=DEGRADED, calibration_age_seconds=8 * 86400
    )
    snapshot = monitor.assess("sentiment")

    assert snapshot.overall == DEGRADED
    assert snapshot.calibration_age.state == DEGRADED


def test_overall_unavailable_when_freshness_critical(tmp_path, mon):
    monitor, _ = mon(
        tmp_path, freshness_state=UNAVAILABLE, freshness_age_seconds=float("inf")
    )
    snapshot = monitor.assess("sentiment")

    assert snapshot.overall == UNAVAILABLE
    assert snapshot.data_freshness.state == UNAVAILABLE


# ── transition alerting ─────────────────────────────────────────────────────


def test_transition_into_degraded_raises_alert_once(tmp_path, mon):
    monitor, alerter = mon(tmp_path, drift_state=TRUSTWORTHY)
    # First assessment: trustworthy -> no alert.
    monitor.assess("sentiment")
    alerter.assert_not_called()

    # Second assessment: drift becomes degraded -> alert dispatched.
    monitor._drift_check = lambda: {
        "status": "ok",
        "drift_detected": True,
        "drifted_features": ["volatility"],
        "schema_mismatch": False,
    }
    snapshot = monitor.assess("sentiment")

    assert snapshot.overall == DEGRADED
    assert snapshot.transitioned_to_degraded is True
    alerter.assert_called_once()
    kwargs = alerter.call_args.kwargs
    assert kwargs["alert_type"] == "model_health"
    assert kwargs["severity"] == "warning"
    assert kwargs["payload"]["model_type"] == "sentiment"


def test_no_repeat_alert_when_state_unchanged(tmp_path, mon):
    monitor, alerter = mon(tmp_path, drift_state=DEGRADED)
    monitor.assess("sentiment")
    assert alerter.call_count == 1
    monitor.assess("sentiment")
    assert alerter.call_count == 1  # still degraded, not a new transition


def test_recovery_to_trustworthy_does_not_alert(tmp_path, mon):
    monitor, alerter = mon(tmp_path, drift_state=DEGRADED)
    monitor.assess("sentiment")  # transition into degraded -> alert
    assert alerter.call_count == 1
    monitor._drift_check = lambda: {
        "status": "ok",
        "drift_detected": False,
        "drifted_features": [],
        "schema_mismatch": False,
    }
    snapshot = monitor.assess("sentiment")
    assert snapshot.overall == TRUSTWORTHY
    assert alerter.call_count == 1  # no alert on recovery


def test_first_assessment_degraded_alerts(tmp_path, mon):
    monitor, alerter = mon(tmp_path, drift_state=DEGRADED)
    snapshot = monitor.assess("sentiment")
    assert snapshot.transitioned_to_degraded is True
    alerter.assert_called_once()


# ── persistence across assess calls ─────────────────────────────────────────


def test_state_persisted_to_disk(tmp_path, mon):
    state_path = str(tmp_path / "model_health_states.json")
    monitor, _ = mon(tmp_path)
    monitor.state_path = state_path
    monitor.assess("sentiment")

    with open(state_path) as fh:
        persisted = json.load(fh)
    assert persisted == {"sentiment": TRUSTWORTHY}


# ── shared monitor / get_model_health ───────────────────────────────────────


def test_assess_all_and_dict_shape(tmp_path, mon):
    from src.ml.model_health import ModelSignal

    monitor, _ = mon(tmp_path)
    result = monitor.assess_all()
    assert set(result) == {"sentiment"}

    d = result["sentiment"].to_dict()
    assert d["overall"] == TRUSTWORTHY
    assert d["live_version"] == "v1.1"
    assert d["transitioned_to_degraded"] is False
    assert "checked_at" in d
    assert set(d["drift"]) == {"state", "detail", "value"}
    assert set(d["calibration_age"]) == {"state", "detail", "value"}
    assert set(d["data_freshness"]) == {"state", "detail", "value"}

    # to_dict round-trips through the constructor.
    back = ModelHealthSnapshot(
        model_type=d["model_type"],
        live_version=d["live_version"],
        drift=ModelSignal(**d["drift"]),
        calibration_age=ModelSignal(**d["calibration_age"]),
        data_freshness=ModelSignal(**d["data_freshness"]),
        overall=d["overall"],
        checked_at=d["checked_at"],
        transitioned_to_degraded=d["transitioned_to_degraded"],
    )
    assert back.overall == TRUSTWORTHY


def test_unavailable_signal_is_reported_in_detail(tmp_path, mon):
    monitor, _ = mon(tmp_path, live_version=None)
    snapshot = monitor.assess("sentiment")
    assert snapshot.overall == UNAVAILABLE
    assert snapshot.live_version is None
    assert snapshot.transitioned_to_degraded is True
