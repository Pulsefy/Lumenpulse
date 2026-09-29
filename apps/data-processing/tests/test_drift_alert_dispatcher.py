# -*- coding: utf-8 -*-
"""Tests for the drift-alert dispatch pipeline (#1447)."""

import json
from unittest.mock import MagicMock

import pytest

from src.notifications import drift_alert_dispatcher as dispatcher
from src.notifications.backend_client import BackendNotificationClient


@pytest.fixture(autouse=True)
def _fresh_engine(tmp_path, monkeypatch):
    # Isolate the suppression store per test (the engine persists to disk).
    monkeypatch.setenv(
        "DRIFT_ALERT_SUPPRESSION_STORE_PATH", str(tmp_path / "drift_suppression.json")
    )
    dispatcher.reset_drift_suppression_engine()
    yield
    dispatcher.reset_drift_suppression_engine()


def _spying_client(tmp_path):
    client = MagicMock(spec=BackendNotificationClient)
    client.send_drift_alert.return_value = True
    dispatcher._set_backend_client_for_testing(client)
    return client


def test_first_alert_is_delivered(tmp_path):
    client = _spying_client(tmp_path)

    delivered = dispatcher.dispatch_drift_alert(
        alert_type="feature_drift",
        title="Feature drift detected",
        message="sentiment_score shifted",
        severity="warning",
        payload={"feature_set": "price_predictor_v1", "drifted_features": ["sentiment_score"]},
    )

    assert delivered is True
    client.send_drift_alert.assert_called_once()
    kwargs = client.send_drift_alert.call_args.kwargs
    assert kwargs["alert_type"] == "feature_drift"
    assert kwargs["severity"] == "warning"
    assert kwargs["alert_id"]  # a UUID is assigned for backend dedup


def test_persistent_drift_is_suppressed_within_window(tmp_path):
    _spying_client(tmp_path)
    payload = {
        "feature_set": "price_predictor_v1",
        "drifted_features": ["sentiment_score"],
        "schema_mismatch": False,
    }

    assert dispatcher.dispatch_drift_alert(
        alert_type="feature_drift",
        title="drift",
        message="m",
        severity="warning",
        payload=dict(payload),
    ) is True

    # Same drift again inside the suppression window → not re-delivered.
    assert dispatcher.dispatch_drift_alert(
        alert_type="feature_drift",
        title="drift",
        message="m",
        severity="warning",
        payload=dict(payload),
    ) is False

    engine = dispatcher.get_drift_suppression_engine()
    assert engine.stats["suppressions_total"] >= 1


def test_different_drift_is_not_suppressed(tmp_path):
    _spying_client(tmp_path)

    assert dispatcher.dispatch_drift_alert(
        alert_type="feature_drift",
        title="drift",
        message="m",
        severity="warning",
        payload={"feature_set": "price_predictor_v1", "drifted_features": ["volume"]},
    ) is True

    # A different drifted feature is a distinct alert identity.
    assert dispatcher.dispatch_drift_alert(
        alert_type="feature_drift",
        title="drift",
        message="m",
        severity="warning",
        payload={"feature_set": "price_predictor_v1", "drifted_features": ["volatility"]},
    ) is True


def test_metadata_drift_dedups_on_findings_identity(tmp_path):
    _spying_client(tmp_path)
    payload = {
        "run_id": "run-1",
        "projects_with_drift": 1,
        "findings": [
            {"project_id": 2, "scope": "project", "field": "status"},
            {"project_id": 2, "scope": "project", "field": "total_contributions"},
        ],
    }

    assert dispatcher.dispatch_drift_alert(
        alert_type="metadata_drift",
        title="m",
        message="m",
        severity="critical",
        payload=dict(payload),
    ) is True
    assert dispatcher.dispatch_drift_alert(
        alert_type="metadata_drift",
        title="m",
        message="m",
        severity="critical",
        payload=dict(payload),
    ) is False


def test_failed_delivery_does_not_consume_dedup_window(tmp_path):
    """A spooled alert must be re-attemptable, not suppressed into silence."""
    client = _spying_client(tmp_path)
    client.send_drift_alert.return_value = False
    payload = {"feature_set": "fs", "drifted_features": ["volume"]}

    assert dispatcher.dispatch_drift_alert(
        alert_type="feature_drift",
        title="t",
        message="m",
        severity="warning",
        payload=dict(payload),
    ) is False

    # Backend recovered → the same drift can be delivered again.
    client.send_drift_alert.return_value = True
    assert dispatcher.dispatch_drift_alert(
        alert_type="feature_drift",
        title="t",
        message="m",
        severity="warning",
        payload=dict(payload),
    ) is True


def test_suppression_engine_custom_rules_json(tmp_path, monkeypatch):
    monkeypatch.setenv(
        "DRIFT_ALERT_RULES_JSON",
        json.dumps(
            [
                {
                    "type": "alert_type",
                    "name": "custom_dedup",
                    "window_seconds": 60,
                    "key_fields": ["alert_type"],
                    "alert_types": ["feature_drift"],
                }
            ]
        ),
    )
    monkeypatch.setenv(
        "DRIFT_ALERT_SUPPRESSION_STORE_PATH",
        str(tmp_path / "store.json"),
    )
    _spying_client(tmp_path)
    try:
        assert dispatcher.dispatch_drift_alert(
            alert_type="feature_drift",
            title="t",
            message="m",
            severity="warning",
            payload={"feature_set": "a"},
        ) is True
        # key_fields only include alert_type → every feature_drift dedups.
        assert dispatcher.dispatch_drift_alert(
            alert_type="feature_drift",
            title="t",
            message="m",
            severity="warning",
            payload={"feature_set": "b"},
        ) is False
    finally:
        monkeypatch.delenv("DRIFT_ALERT_RULES_JSON")
        monkeypatch.delenv("DRIFT_ALERT_SUPPRESSION_STORE_PATH")
