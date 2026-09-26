# -*- coding: utf-8 -*-
"""Unit tests for the backend notification client (#1447)."""

import hashlib
import hmac
import json
from unittest.mock import MagicMock, patch

import pytest

from src.notifications.backend_client import (
    BackendNotificationClient,
    map_severity_to_backend_priority,
)

SECRET = "shared-test-secret"


class _FakeResponse:
    def __init__(self, status_code=201, text=""):
        self.status_code = status_code
        self.text = text


def _make_client(tmp_path, **overrides):
    defaults = dict(
        base_url="http://backend.test",
        ingest_secret=SECRET,
        max_retries=2,
        backoff_seconds=0.0,
        spool_path=str(tmp_path / "spool.jsonl"),
        session=MagicMock(),
    )
    defaults.update(overrides)
    return BackendNotificationClient(**defaults)


# ── severity mapping ────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("severity", "expected"),
    [
        ("critical", "critical"),
        ("CRITICAL", "critical"),
        ("warning", "high"),
        ("info", "medium"),
        ("healthy", "low"),
        ("", "medium"),
        (None, "medium"),
        ("banana", "medium"),
    ],
)
def test_severity_maps_to_backend_priority_model(severity, expected):
    assert map_severity_to_backend_priority(severity) == expected


# ── authenticated delivery ──────────────────────────────────────────────────


def test_delivery_is_hmac_authenticated(tmp_path):
    client = _make_client(tmp_path)
    client.session.post.return_value = _FakeResponse(201)

    assert client.send_drift_alert(
        alert_type="feature_drift",
        title="t",
        message="m",
        severity="warning",
        alert_id="123e4567-e89b-12d3-a456-426614174000",
    )

    call = client.session.post.call_args
    headers = call.kwargs["headers"]
    body = call.kwargs["data"]
    timestamp = headers["x-drift-alert-timestamp"]

    expected_sig = hmac.new(
        SECRET.encode(),
        f"{timestamp}.{body}".encode(),
        hashlib.sha256,
    ).hexdigest()
    assert headers["x-drift-alert-signature"] == expected_sig
    assert call.args[0] == "http://backend.test/notifications/drift-alerts"


def test_payload_uses_backend_priority_and_type(tmp_path):
    client = _make_client(tmp_path)
    client.session.post.return_value = _FakeResponse(201)

    client.send_drift_alert(
        alert_type="metadata_drift",
        title="t",
        message="m",
        severity="critical",
    )

    body = json.loads(client.session.post.call_args.kwargs["data"])
    assert body["type"] == "drift"
    assert body["severity"] == "critical"
    assert body["metadata"]["alertType"] == "metadata_drift"


# ── retry behaviour ─────────────────────────────────────────────────────────


def test_transient_failure_is_retried_then_delivered(tmp_path):
    client = _make_client(tmp_path, max_retries=3)
    client.session.post.side_effect = iter(
        [_FakeResponse(503), _FakeResponse(503), _FakeResponse(201)]
    )

    assert client.send_drift_alert(
        alert_type="feature_drift", title="t", message="m", severity="warning"
    )
    assert client.session.post.call_count == 3


def test_terminal_failure_spools_alert_never_dropped(tmp_path):
    spool = tmp_path / "spool.jsonl"
    client = _make_client(tmp_path, max_retries=2, spool_path=str(spool))
    client.session.post.return_value = _FakeResponse(503)

    delivered = client.send_drift_alert(
        alert_type="feature_drift",
        title="undelivered",
        message="m",
        severity="critical",
    )

    assert delivered is False
    assert client.session.post.call_count == 2  # retried
    spooled = [json.loads(line) for line in spool.read_text().splitlines()]
    assert len(spooled) == 1
    assert spooled[0]["title"] == "undelivered"
    assert spooled[0]["severity"] == "critical"


def test_unconfigured_client_spools_instead_of_dropping(tmp_path):
    spool = tmp_path / "spool.jsonl"
    client = _make_client(
        tmp_path, base_url="", ingest_secret="", spool_path=str(spool)
    )
    assert client.is_configured is False

    delivered = client.send_drift_alert(
        alert_type="feature_drift", title="t", message="m", severity="warning"
    )

    assert delivered is False
    assert spool.exists()
    client.session.post.assert_not_called()


def test_4xx_rejection_is_not_retried_but_spooled(tmp_path):
    client = _make_client(tmp_path, max_retries=4)
    client.session.post.return_value = _FakeResponse(400, "bad request")

    delivered = client.send_drift_alert(
        alert_type="feature_drift", title="t", message="m", severity="warning"
    )

    assert delivered is False
    assert client.session.post.call_count == 1


# ── spool replay ────────────────────────────────────────────────────────────


def test_replay_spooled_delivers_and_clears(tmp_path):
    spool = tmp_path / "spool.jsonl"
    client = _make_client(tmp_path, spool_path=str(spool))
    client.session.post.return_value = _FakeResponse(503)
    client.send_drift_alert(
        alert_type="feature_drift", title="t", message="m", severity="warning"
    )
    client.session.post.return_value = _FakeResponse(201)

    replayed = client.replay_spooled()

    assert replayed == 1
    assert spool.read_text().strip() == ""
