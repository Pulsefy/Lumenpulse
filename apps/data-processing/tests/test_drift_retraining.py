"""Tests for automatic retraining triggered by feature drift."""

import time

import pytest

from src.db.postgres_service import PostgresService
from src.jobs.manager import get_job
from src.ml import drift_retraining


@pytest.fixture
def sqlite_db_service(tmp_path):
    service = PostgresService(database_url=f"sqlite:///{tmp_path / 'drift.db'}")
    service.create_tables()
    return service


def _report(event_id="event-1"):
    return {
        "run_id": event_id,
        "feature_set": "price_predictor_v1",
        "status": "drift_detected",
        "drift_detected": True,
        "drifted_features": ["volume"],
        "schema_mismatch": False,
        "threshold": 0.25,
        "started_at": "2026-10-16T00:00:00+00:00",
        "completed_at": "2026-10-16T00:01:00+00:00",
    }


def _wait_for_job(service, job_id):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        job = get_job(service, job_id)
        if job and job["status"] in {"succeeded", "failed"}:
            return job
        time.sleep(0.02)
    raise AssertionError(f"Job {job_id} did not finish")


def test_enqueue_preserves_event_attribution_and_uses_evaluation_gate(
    monkeypatch, sqlite_db_service
):
    monkeypatch.setenv("FEATURE_DRIFT_AUTO_RETRAIN_ENABLED", "true")
    monkeypatch.setattr(drift_retraining, "_cooldown_seconds", lambda: 3600)
    contexts = []

    def run(trigger_context):
        contexts.append(trigger_context)
        return {"status": "completed", "trigger": trigger_context}

    monkeypatch.setattr(drift_retraining, "run_drift_triggered_retraining", run)

    result = drift_retraining.enqueue_drift_retraining(
        _report(), db_service=sqlite_db_service
    )
    job = _wait_for_job(sqlite_db_service, result["job_id"])

    assert result["status"] == "submitted"
    assert job["params"]["trigger"]["drift_event_id"] == "event-1"
    assert job["result"]["trigger"]["source"] == "feature_drift"
    assert contexts[0]["drift_event_id"] == "event-1"


def test_same_sustained_drift_is_suppressed_during_cooldown(
    monkeypatch, sqlite_db_service
):
    monkeypatch.setenv("FEATURE_DRIFT_AUTO_RETRAIN_ENABLED", "true")
    monkeypatch.setattr(drift_retraining, "_cooldown_seconds", lambda: 3600)
    monkeypatch.setattr(
        drift_retraining,
        "run_drift_triggered_retraining",
        lambda trigger_context: {"status": "completed"},
    )

    first = drift_retraining.enqueue_drift_retraining(
        _report(), db_service=sqlite_db_service
    )
    _wait_for_job(sqlite_db_service, first["job_id"])

    second = drift_retraining.enqueue_drift_retraining(
        _report("event-2"), db_service=sqlite_db_service
    )
    assert second["status"] == "cooldown"
    assert second["drift_event_id"] == "event-2"


def test_configuration_can_disable_automatic_retraining(monkeypatch):
    monkeypatch.setenv("FEATURE_DRIFT_AUTO_RETRAIN_ENABLED", "false")
    assert drift_retraining.enqueue_drift_retraining(_report()) == {
        "status": "disabled"
    }


def test_drift_run_calls_standard_pipeline_without_force(monkeypatch):
    calls = []
    import src.ml.retraining_pipeline as pipeline

    def run_retraining(**kwargs):
        calls.append(kwargs)
        return {"status": "completed"}

    monkeypatch.setattr(pipeline, "run_retraining", run_retraining)
    trigger_context = {"source": "feature_drift", "drift_event_id": "event-1"}

    drift_retraining.run_drift_triggered_retraining(trigger_context)

    assert calls == [{"force": False, "trigger_context": trigger_context}]


def test_invalid_cooldown_configuration_is_rejected(monkeypatch):
    monkeypatch.setenv("FEATURE_DRIFT_RETRAIN_COOLDOWN_SECONDS", "0")
    with pytest.raises(ValueError, match="must be a positive number"):
        drift_retraining._cooldown_seconds()
