"""
Route-level tests for the async analytics job queue (#1248): submitting
/retrain, /correlation/analyze, /correlation/lag-analysis, and
/analytics/kpis/daily-snapshots/run returns a job identifier immediately,
and GET /api/jobs/{job_id} reports the outcome.
"""

import time

import pytest
from fastapi.testclient import TestClient

from src.db.postgres_service import PostgresService
from src.security import security_config
import src.api.server as server_module
import src.api.job_routes as job_routes_module
from src.api.server import app

_HEADERS = {"X-API-Key": "test-key"}


@pytest.fixture(scope="module")
def sqlite_db_service(tmp_path_factory):
    """A single SQLite-backed PostgresService shared by all tests in this module."""
    db_path = tmp_path_factory.mktemp("job_routes") / "test_jobs.db"
    service = PostgresService(database_url=f"sqlite:///{db_path}")
    service.create_tables()
    return service


@pytest.fixture(autouse=True)
def _wire_up(sqlite_db_service, monkeypatch):
    monkeypatch.setattr(security_config, "api_key", "test-key")
    monkeypatch.setattr(server_module, "postgres_service", sqlite_db_service)
    monkeypatch.setattr(job_routes_module, "postgres_service", sqlite_db_service)


@pytest.fixture
def client():
    return TestClient(app)


def _poll_until_terminal(client, job_id, timeout=10.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        resp = client.get(f"/api/jobs/{job_id}", headers=_HEADERS)
        assert resp.status_code == 200
        body = resp.json()
        if body["status"] in ("succeeded", "failed"):
            return body
        time.sleep(0.02)
    raise AssertionError(f"job {job_id} did not reach a terminal state in time")


def test_get_unknown_job_returns_404(client):
    resp = client.get("/api/jobs/does-not-exist", headers=_HEADERS)
    assert resp.status_code == 404


def test_retrain_submits_job_and_can_be_polled(client, monkeypatch):
    fake_result = {"status": "completed", "duration_seconds": 0.01, "models": {}}
    monkeypatch.setattr(server_module, "run_retraining", lambda force=False: fake_result)

    resp = client.post("/retrain", json={"force": False}, headers=_HEADERS)
    assert resp.status_code == 202
    body = resp.json()
    assert body["job_type"] == "retrain"
    assert body["status"] == "queued"
    assert body["created"] is True

    final = _poll_until_terminal(client, body["job_id"])
    assert final["status"] == "succeeded"
    assert final["result"] == fake_result


def test_concurrent_retrain_submissions_collapse(client, monkeypatch):
    monkeypatch.setattr(
        server_module, "run_retraining", lambda force=False: {"status": "completed"}
    )

    resp1 = client.post("/retrain", json={"force": False}, headers=_HEADERS)
    resp2 = client.post("/retrain", json={"force": True}, headers=_HEADERS)
    assert resp1.status_code == 202
    assert resp2.status_code == 202

    body1, body2 = resp1.json(), resp2.json()
    # Both requests are the same conceptual job (only one retrain runs at a
    # time), so the second collapses onto the first regardless of `force`.
    assert body1["job_id"] == body2["job_id"] or body2["created"] is False
    _poll_until_terminal(client, body1["job_id"])


def test_correlation_analyze_submits_job_and_returns_result(client):
    payload = {
        "sentiment_data": [{"timestamp": "2026-01-01T00:00:00Z", "score": 0.5}],
        "price_data": [{"timestamp": "2026-01-01T00:00:00Z", "value": 100.0}],
        "lag_hours": 0,
    }
    resp = client.post("/correlation/analyze", json=payload, headers=_HEADERS)
    assert resp.status_code == 202
    body = resp.json()
    assert body["job_type"] == "correlation_analyze"
    assert body["created"] is True

    final = _poll_until_terminal(client, body["job_id"])
    assert final["status"] == "succeeded"
    assert "summary" in final["result"]


def test_correlation_lag_analysis_submits_job_and_returns_result(client):
    payload = {
        "sentiment_data": [{"timestamp": "2026-01-01T00:00:00Z", "score": 0.5}],
        "metric_data": [{"timestamp": "2026-01-01T00:00:00Z", "value": 100.0}],
        "metric_type": "volume",
        "max_lag_hours": 2,
    }
    resp = client.post("/correlation/lag-analysis", json=payload, headers=_HEADERS)
    assert resp.status_code == 202
    body = resp.json()
    assert body["job_type"] == "correlation_lag_analysis"

    final = _poll_until_terminal(client, body["job_id"])
    assert final["status"] == "succeeded"
    assert "best_lag_hours" in final["result"]


def test_daily_kpi_snapshot_run_submits_job_and_returns_result(client):
    resp = client.post(
        "/analytics/kpis/daily-snapshots/run?target_date=2026-08-15&period=daily",
        headers=_HEADERS,
    )
    assert resp.status_code == 202
    body = resp.json()
    assert body["job_type"] == "daily_kpi_snapshot"

    final = _poll_until_terminal(client, body["job_id"])
    assert final["status"] == "succeeded"
    assert final["result"]["date"] == "2026-08-15"
    assert final["result"]["status"] in ("created", "skipped")


def test_reconciliation_marks_orphaned_job_failed_on_startup(sqlite_db_service):
    from src.jobs.manager import reconcile_orphaned_jobs, get_job

    job = sqlite_db_service.create_analytics_job(
        job_type="correlation_analyze", dedupe_key="correlation_analyze:orphan-route-test", params={}
    )
    sqlite_db_service.mark_analytics_job_running(job["job_id"])

    count = reconcile_orphaned_jobs(sqlite_db_service)
    assert count >= 1

    final = get_job(sqlite_db_service, job["job_id"])
    assert final["status"] == "failed"
    assert "restart" in final["error"]
