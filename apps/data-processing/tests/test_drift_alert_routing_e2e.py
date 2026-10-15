# -*- coding: utf-8 -*-
"""
End-to-end tests for routing drift alerts into backend notifications (#1447).

Drives a synthetic drift from the detectors through the suppression engine
and the authenticated backend client all the way to a "delivered"
notification, plus the failure paths (retry + spool, suppression).
"""

import json
from unittest.mock import MagicMock

import pandas as pd
import pytest

from src.metadata_drift_detector import MetadataDriftDetector
from src.ml.feature_drift_detector import FeatureDriftDetector
from src.ml.feature_schema import current_feature_schema
from src.ml.feature_drift_detector import compute_distribution_baseline
from src.notifications import drift_alert_dispatcher as dispatcher
from src.notifications.backend_client import BackendNotificationClient

FEATURES = ["sentiment_score", "volume", "volatility"]


@pytest.fixture(autouse=True)
def _fresh_state(tmp_path):
    dispatcher.reset_drift_suppression_engine()
    yield
    dispatcher.reset_drift_suppression_engine()


class _BackendCapture:
    """Stands in for the backend /notifications/drift-alerts endpoint."""

    def __init__(self, fail_times: int = 0):
        self.fail_times = fail_times
        self.calls = []

    def post(self, url, data=None, headers=None, timeout=None):
        self.calls.append(
            {"url": url, "body": json.loads(data), "headers": headers}
        )
        if self.fail_times > 0:
            self.fail_times -= 1
            resp = MagicMock()
            resp.status_code = 503
            resp.text = "overloaded"
            return resp
        resp = MagicMock()
        resp.status_code = 201
        return resp


def _wire_backend(monkeypatch, tmp_path, capture: _BackendCapture):
    """Point the real client at the capture endpoint via env + session."""
    monkeypatch.setenv("BACKEND_NOTIFICATION_URL", "http://backend.test")
    monkeypatch.setenv("DRIFT_ALERT_INGEST_SECRET", "e2e-shared-secret")
    monkeypatch.setenv(
        "BACKEND_NOTIFICATION_SPOOL_PATH",
        str(tmp_path / "undelivered.jsonl"),
    )
    monkeypatch.setenv(
        "DRIFT_ALERT_SUPPRESSION_STORE_PATH",
        str(tmp_path / "drift_suppression.json"),
    )
    monkeypatch.setenv("BACKEND_NOTIFICATION_MAX_RETRIES", "3")
    monkeypatch.setenv("BACKEND_NOTIFICATION_BACKOFF_SECONDS", "0")

    session = MagicMock()
    session.post.side_effect = capture.post
    client = BackendNotificationClient(session=session)
    monkeypatch.setattr(
        dispatcher, "_backend_client", client
    )
    return client


def _training_frame(seed: int = 42, n: int = 500) -> pd.DataFrame:
    import numpy as np

    rng = np.random.default_rng(seed)
    return pd.DataFrame(
        {
            "sentiment_score": rng.uniform(-1, 1, n),
            "volume": rng.uniform(1_000, 100_000, n),
            "volatility": rng.uniform(0, 0.5, n),
        }
    )


# ── E2E: synthetic feature drift → delivered backend notification ──────────


def test_e2e_synthetic_feature_drift_reaches_backend(monkeypatch, tmp_path):
    capture = _BackendCapture()
    _wire_backend(monkeypatch, tmp_path, capture)

    frame = _training_frame()
    schema = current_feature_schema()
    metadata = {
        "schema_version": schema.version,
        "schema_fingerprint": schema.fingerprint,
        "feature_names": FEATURES,
        "feature_baseline": compute_distribution_baseline(frame, FEATURES),
    }

    # Synthetic serving drift: sentiment distribution shifts hard.
    serving = _training_frame(seed=7)
    serving["sentiment_score"] = serving["sentiment_score"] + 5.0

    detector = FeatureDriftDetector(
        metadata_loader=lambda *_: metadata,
        serving_frame_provider=lambda: serving,
    )
    report = detector.detect()

    assert report.status == "drift_detected"
    assert report.alerted is True

    # The alert travelled the full path into an authenticated backend call.
    assert len(capture.calls) == 1
    delivered = capture.calls[0]
    assert delivered["url"].endswith("/notifications/drift-alerts")
    assert delivered["headers"]["x-drift-alert-signature"]
    assert delivered["headers"]["x-drift-alert-timestamp"]

    body = delivered["body"]
    # Severity mapped onto the backend priority model: warning → high.
    assert body["severity"] == "high"
    assert body["type"] == "drift"
    assert body["title"].startswith("Feature drift detected")
    assert body["metadata"]["alertType"] == "feature_drift"
    assert "sentiment_score" in body["metadata"]["drifted_features"]


def test_e2e_schema_mismatch_maps_to_critical(monkeypatch, tmp_path):
    capture = _BackendCapture()
    _wire_backend(monkeypatch, tmp_path, capture)

    frame = _training_frame()
    schema = current_feature_schema()
    metadata = {
        "schema_version": "v0-stale",
        "schema_fingerprint": "deadbeef",
        "feature_names": FEATURES,
        "feature_baseline": compute_distribution_baseline(frame, FEATURES),
    }

    detector = FeatureDriftDetector(
        metadata_loader=lambda *_: metadata,
        serving_frame_provider=lambda: _training_frame(seed=42),
    )
    report = detector.detect()

    assert report.schema_mismatch is True
    assert report.alerted is True
    assert capture.calls[0]["body"]["severity"] == "critical"


def test_e2e_repeated_drift_is_deduped_not_spammed(monkeypatch, tmp_path):
    capture = _BackendCapture()
    _wire_backend(monkeypatch, tmp_path, capture)

    frame = _training_frame()
    schema = current_feature_schema()
    metadata = {
        "schema_version": schema.version,
        "schema_fingerprint": schema.fingerprint,
        "feature_names": FEATURES,
        "feature_baseline": compute_distribution_baseline(frame, FEATURES),
    }
    serving = _training_frame(seed=7)
    serving["sentiment_score"] = serving["sentiment_score"] + 5.0

    for _ in range(3):
        report = FeatureDriftDetector(
            metadata_loader=lambda *_: metadata,
            serving_frame_provider=lambda: serving.copy(),
        ).detect()
        assert report.alerted is True  # notifier ran

    # Only the first occurrence was delivered to the backend; the repeats
    # were suppressed by the dedup engine instead of spamming notifications.
    assert len(capture.calls) == 1


def test_e2e_backend_outage_retries_and_spools_then_replays(
    monkeypatch, tmp_path
):
    capture = _BackendCapture(fail_times=99)
    _wire_backend(monkeypatch, tmp_path, capture)

    frame = _training_frame()
    schema = current_feature_schema()
    metadata = {
        "schema_version": schema.version,
        "schema_fingerprint": schema.fingerprint,
        "feature_names": FEATURES,
        "feature_baseline": compute_distribution_baseline(frame, FEATURES),
    }
    serving = _training_frame(seed=7)
    serving["sentiment_score"] = serving["sentiment_score"] + 5.0

    report = FeatureDriftDetector(
        metadata_loader=lambda *_: metadata,
        serving_frame_provider=lambda: serving,
    ).detect()
    assert report.alerted is True  # alert raised; delivery failed downstream

    # Retried up to max_retries, then spooled — never dropped.
    assert capture.calls[-1] is not None
    assert len(capture.calls) == 3  # max_retries
    spool = tmp_path / "undelivered.jsonl"
    assert spool.exists()
    spooled = [json.loads(line) for line in spool.read_text().splitlines()]
    assert len(spooled) == 1
    assert spooled[0]["title"].startswith("Feature drift detected")

    # Backend recovers → replay delivers the retained alert.
    capture.fail_times = 0
    replayed = dispatcher._get_backend_client().replay_spooled()
    assert replayed == 1
    assert spool.read_text().strip() == ""


# ── E2E: metadata drift findings → backend notification ────────────────────


def test_e2e_metadata_drift_findings_reach_backend(monkeypatch, tmp_path):
    from tests.test_metadata_drift_detector import build_sqlite_service

    capture = _BackendCapture()
    _wire_backend(monkeypatch, tmp_path, capture)

    service = build_sqlite_service()
    from datetime import datetime, timedelta, timezone

    service.save_contract_event(
        contract_id="CCONTRACT_E2E",
        event_id="evt-1",
        ledger=100,
        event_type="DepositEvent",
        project_id=1,
        contributor="GALICE",
        amount=100.0,
        status="completed",
        timestamp=datetime.now(timezone.utc) + timedelta(seconds=1),
    )
    # Backend view is stale → drift.
    service.save_project_view(
        project_id=1,
        contract_id="CCONTRACT_E2E",
        status="active",
        add_total_contributions=10.0,
    )

    detector = MetadataDriftDetector(db_service=service)
    report = detector.run_and_persist(project_id=1)

    assert report.drift_detected is True
    assert len(capture.calls) == 1
    body = capture.calls[0]["body"]
    assert body["severity"] == "critical"  # status mismatch is critical
    assert body["metadata"]["alertType"] == "metadata_drift"
    assert body["metadata"]["findings"]
