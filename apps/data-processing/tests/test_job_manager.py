"""
Tests for the async analytics job queue (#1248).
"""

import time

import pytest

from src.db.postgres_service import PostgresService
from src.jobs.manager import make_dedupe_key, submit_job, get_job, reconcile_orphaned_jobs


@pytest.fixture
def sqlite_db_service(tmp_path):
    """Provide a SQLite-backed PostgresService for testing."""
    db_path = tmp_path / "test_analytics_jobs.db"
    service = PostgresService(database_url=f"sqlite:///{db_path}")
    service.create_tables()
    return service


def _wait_for_terminal(db_service, job_id, timeout=5.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = get_job(db_service, job_id)
        if job["status"] in ("succeeded", "failed"):
            return job
        time.sleep(0.02)
    raise AssertionError(f"job {job_id} did not reach a terminal state in time")


def test_make_dedupe_key_is_stable_regardless_of_key_order():
    key_a = make_dedupe_key("retrain", {"a": 1, "b": 2})
    key_b = make_dedupe_key("retrain", {"b": 2, "a": 1})
    assert key_a == key_b


def test_make_dedupe_key_differs_by_job_type():
    key_a = make_dedupe_key("retrain", {"a": 1})
    key_b = make_dedupe_key("correlation_analyze", {"a": 1})
    assert key_a != key_b


def test_submit_job_runs_in_background_and_succeeds(sqlite_db_service):
    job, created = submit_job(
        sqlite_db_service,
        job_type="correlation_analyze",
        idempotency_payload={"x": 1},
        work_fn=lambda: {"summary": {"correlation": 0.5}},
    )
    assert created is True
    assert job["status"] == "queued"

    final = _wait_for_terminal(sqlite_db_service, job["job_id"])
    assert final["status"] == "succeeded"
    assert final["result"] == {"summary": {"correlation": 0.5}}
    assert final["started_at"] is not None
    assert final["finished_at"] is not None


def test_submit_job_records_failure(sqlite_db_service):
    def _boom():
        raise ValueError("bad input data")

    job, created = submit_job(
        sqlite_db_service,
        job_type="correlation_analyze",
        idempotency_payload={"x": 2},
        work_fn=_boom,
    )
    assert created is True

    final = _wait_for_terminal(sqlite_db_service, job["job_id"])
    assert final["status"] == "failed"
    assert "bad input data" in final["error"]


def test_submit_job_collapses_concurrent_duplicates(sqlite_db_service):
    started = []

    def _slow_job():
        started.append(1)
        time.sleep(0.2)
        return {"ok": True}

    job1, created1 = submit_job(
        sqlite_db_service,
        job_type="daily_kpi_snapshot",
        idempotency_payload={"target_date": "2026-08-01", "period": "daily"},
        work_fn=_slow_job,
    )
    job2, created2 = submit_job(
        sqlite_db_service,
        job_type="daily_kpi_snapshot",
        idempotency_payload={"target_date": "2026-08-01", "period": "daily"},
        work_fn=_slow_job,
    )

    assert created1 is True
    assert created2 is False
    assert job1["job_id"] == job2["job_id"]

    _wait_for_terminal(sqlite_db_service, job1["job_id"])
    # The second submission must not have started its own execution.
    assert len(started) == 1


def test_submit_job_allows_resubmission_after_completion(sqlite_db_service):
    job1, _ = submit_job(
        sqlite_db_service,
        job_type="retrain",
        idempotency_payload={"singleton": True},
        work_fn=lambda: {"status": "completed"},
    )
    _wait_for_terminal(sqlite_db_service, job1["job_id"])

    job2, created2 = submit_job(
        sqlite_db_service,
        job_type="retrain",
        idempotency_payload={"singleton": True},
        work_fn=lambda: {"status": "completed"},
    )
    assert created2 is True
    assert job2["job_id"] != job1["job_id"]


def test_get_job_returns_none_for_unknown_id(sqlite_db_service):
    assert get_job(sqlite_db_service, "does-not-exist") is None


def test_reconcile_orphaned_jobs_fails_stuck_jobs(sqlite_db_service):
    # Simulate a job left "running" by a process that died mid-run: create
    # it directly rather than via submit_job (which would actually finish it).
    job = sqlite_db_service.create_analytics_job(
        job_type="retrain", dedupe_key="retrain:orphan", params={}
    )
    sqlite_db_service.mark_analytics_job_running(job["job_id"])

    count = reconcile_orphaned_jobs(sqlite_db_service)
    assert count == 1

    final = get_job(sqlite_db_service, job["job_id"])
    assert final["status"] == "failed"
    assert "restart" in final["error"]

    # The dedupe key must be freed so the job type can be submitted again.
    job2, created2 = submit_job(
        sqlite_db_service,
        job_type="retrain",
        idempotency_payload={},
        work_fn=lambda: {"status": "completed"},
    )
    assert created2 is True


def test_submit_job_without_db_service_raises():
    with pytest.raises(RuntimeError):
        submit_job(None, "retrain", {}, work_fn=lambda: {})


def test_get_job_without_db_service_returns_none():
    assert get_job(None, "any-id") is None


def test_reconcile_orphaned_jobs_without_db_service_returns_zero():
    assert reconcile_orphaned_jobs(None) == 0
