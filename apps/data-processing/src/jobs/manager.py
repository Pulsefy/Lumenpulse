"""
Async analytics job queue (#1248).

POST /retrain, /correlation/analyze, /correlation/lag-analysis, and
/analytics/kpis/daily-snapshots/run used to run their work inline inside the
HTTP request. A caller that timed out had no way to learn the outcome, and a
redeploy mid-run lost the work entirely.

This module submits that work to a background thread instead, tracking each
run as a row in the `analytics_jobs` table (see src/db/models.py) so a status
endpoint can report queued/running/succeeded/failed with a result reference,
and so a job orphaned by a process restart is detected and reported rather
than left silently stuck (see `reconcile_orphaned_jobs`, called on startup).

Callers pass the live PostgresService instance in explicitly (rather than
this module holding one of its own) so tests can monkeypatch the same
`postgres_service` global that server.py and its routers already use.
"""

import hashlib
import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Dict, Optional, Tuple

from src.db.postgres_service import PostgresService

logger = logging.getLogger(__name__)

_EXECUTOR = ThreadPoolExecutor(
    max_workers=int(os.getenv("JOB_QUEUE_WORKERS", "4")),
    thread_name_prefix="analytics-job",
)


def make_dedupe_key(job_type: str, payload: Dict[str, Any]) -> str:
    """A stable key used to collapse concurrent duplicate submissions."""
    canonical = json.dumps(payload, sort_keys=True, default=str)
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return f"{job_type}:{digest}"


def submit_job(
    db_service: Optional[PostgresService],
    job_type: str,
    idempotency_payload: Dict[str, Any],
    work_fn: Callable[[], Dict[str, Any]],
) -> Tuple[Dict[str, Any], bool]:
    """
    Submit a job for background execution.

    Returns (job, created). `created` is False when an identical job (same
    job_type and payload) is already queued or running — that existing job
    is returned instead of starting a duplicate one.
    """
    if db_service is None:
        raise RuntimeError("Job queue unavailable: database service not configured")

    dedupe_key = make_dedupe_key(job_type, idempotency_payload)

    existing = db_service.find_active_analytics_job(dedupe_key)
    if existing:
        logger.info(
            f"Collapsing duplicate {job_type} submission onto job {existing['job_id']}"
        )
        return existing, False

    job = db_service.create_analytics_job(
        job_type=job_type, dedupe_key=dedupe_key, params=idempotency_payload
    )
    if job is None:
        # Lost the race to a concurrent identical submission — return theirs.
        existing = db_service.find_active_analytics_job(dedupe_key)
        if existing:
            return existing, False
        raise RuntimeError(f"Failed to submit {job_type} job")

    _EXECUTOR.submit(_run_job, db_service, job["job_id"], work_fn)
    return job, True


def _run_job(
    db_service: PostgresService, job_id: str, work_fn: Callable[[], Dict[str, Any]]
) -> None:
    db_service.mark_analytics_job_running(job_id)
    try:
        result = work_fn()
        if not isinstance(result, dict):
            result = {"value": result}
        db_service.mark_analytics_job_succeeded(job_id, result)
    except Exception as exc:
        logger.error(f"Analytics job {job_id} failed: {exc}", exc_info=True)
        db_service.mark_analytics_job_failed(job_id, str(exc))


def get_job(db_service: Optional[PostgresService], job_id: str) -> Optional[Dict[str, Any]]:
    if db_service is None:
        return None
    return db_service.get_analytics_job(job_id)


def reconcile_orphaned_jobs(db_service: Optional[PostgresService]) -> int:
    """
    Mark any job left queued/running by a previous process as failed.

    Jobs run in an in-process thread pool, so they cannot survive a process
    restart; call this once on startup so a lost job is reported instead of
    staying stuck at "running" forever.
    """
    if db_service is None:
        return 0
    count = db_service.fail_orphaned_analytics_jobs(
        "Job lost: process restarted before the job finished"
    )
    if count:
        logger.warning(
            f"Reconciled {count} orphaned analytics job(s) left by a previous process"
        )
    return count
