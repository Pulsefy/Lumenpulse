# -*- coding: utf-8 -*-
"""
Pipeline run registry (#1451).

The scheduler (``src/scheduler.py``) and the API (``src/api/server.py``) run in
separate processes, so per-stage run status cannot be shared through in-memory
state. This module persists the last run of each scheduled stage to a small
JSON file that the scheduler process writes (via an APScheduler listener) and
the API process reads (to build the pipeline topology response).

Only the *latest* run of each stage is kept - enough to report last run,
duration and outcome, and to tell a stage that failed apart from one that has
not run yet.

New in this revision (#1451)
----------------------------
* ``record_retry`` — called each time a transient failure triggers a retry;
  increments the stored ``retry_count`` and timestamps the attempt.
* ``record_skip`` — called when a stage is skipped because an upstream
  dependency failed; records the ``skip_reason`` and sets the outcome to
  ``"skipped"``.
* Each persisted entry now carries:

  - ``retry_count``     — how many retry attempts have been made this run.
  - ``last_retry_at``   — ISO-8601 timestamp of the most recent retry attempt.
  - ``skip_reason``     — why the stage was skipped (or ``None``).
  - ``alerted``         — ``True`` once a retry-exhausted alert has fired.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional

# Outcome values persisted for a finished run.
OUTCOME_SUCCESS = "success"
OUTCOME_FAILED = "failed"
OUTCOME_SKIPPED = "skipped"

# Marker written while a stage is executing but has not finished yet.
STATE_RUNNING = "running"

_DEFAULT_STATE_ENV = "PIPELINE_RUN_STATE_PATH"


def _default_state_path() -> str:
    """Resolve the state-file path from the environment, with a sane default."""
    explicit = os.getenv(_DEFAULT_STATE_ENV)
    if explicit:
        return explicit
    state_dir = os.getenv("PIPELINE_STATE_DIR", "./state")
    return os.path.join(state_dir, "pipeline_runs.json")


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class PipelineRunRegistry:
    """A tiny JSON-file-backed store of the latest run per stage id.

    In addition to the original start / finish lifecycle, this class now
    exposes :meth:`record_retry` and :meth:`record_skip` so that retry
    attempts and downstream skips are visible in the registry and therefore
    surfaced through the pipeline topology API.
    """

    def __init__(self, path: Optional[str] = None) -> None:
        self._path = path or _default_state_path()
        self._lock = threading.Lock()
        # Start times for in-flight runs, keyed by stage id (this process only).
        self._started_at: Dict[str, float] = {}

    @property
    def path(self) -> str:
        return self._path

    # ── persistence helpers ────────────────────────────────────────────
    def _read_all(self) -> Dict[str, Dict[str, Any]]:
        try:
            with open(self._path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
        except (FileNotFoundError, ValueError, OSError):
            return {}
        if not isinstance(data, dict):
            return {}
        return {str(k): v for k, v in data.items() if isinstance(v, dict)}

    def _write_all(self, data: Dict[str, Dict[str, Any]]) -> None:
        directory = os.path.dirname(self._path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        # Atomic replace so a concurrent reader never sees a half-written file.
        fd, tmp_path = tempfile.mkstemp(
            prefix="pipeline_runs.", suffix=".tmp", dir=directory or "."
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(data, handle, indent=2, sort_keys=True)
            os.replace(tmp_path, self._path)
        except OSError:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    # ── recording ──────────────────────────────────────────────────────
    def record_start(self, stage_id: str, when: Optional[float] = None) -> None:
        """Mark ``stage_id`` as running. Called when a job is submitted."""
        start = when if when is not None else time.time()
        self._started_at[stage_id] = start
        with self._lock:
            data = self._read_all()
            entry = data.get(stage_id, {})
            entry.update(
                {
                    "stage_id": stage_id,
                    "state": STATE_RUNNING,
                    "started_at": datetime.fromtimestamp(
                        start, tz=timezone.utc
                    ).isoformat(),
                    # Reset retry counter and skip reason for the new run.
                    "retry_count": 0,
                    "last_retry_at": None,
                    "skip_reason": None,
                    "alerted": False,
                }
            )
            data[stage_id] = entry
            self._write_all(data)

    def record_finish(
        self,
        stage_id: str,
        outcome: str,
        duration_seconds: Optional[float] = None,
        error: Optional[str] = None,
        when: Optional[float] = None,
    ) -> None:
        """Record the terminal result of a run for ``stage_id``."""
        finished = when if when is not None else time.time()
        if duration_seconds is None:
            started = self._started_at.pop(stage_id, None)
            if started is not None:
                duration_seconds = max(0.0, finished - started)
        else:
            self._started_at.pop(stage_id, None)

        with self._lock:
            data = self._read_all()
            entry = data.get(stage_id, {})
            entry.update(
                {
                    "stage_id": stage_id,
                    "state": outcome,
                    "outcome": outcome,
                    "last_run": datetime.fromtimestamp(
                        finished, tz=timezone.utc
                    ).isoformat(),
                    "duration_seconds": (
                        round(duration_seconds, 3)
                        if duration_seconds is not None
                        else None
                    ),
                    "error": error,
                }
            )
            data[stage_id] = entry
            self._write_all(data)

    def record_retry(
        self,
        stage_id: str,
        attempt: int,
        error: Optional[str] = None,
        when: Optional[float] = None,
    ) -> None:
        """
        Record that a transient failure triggered a retry for ``stage_id``.

        Parameters
        ----------
        stage_id:
            The stage that is being retried.
        attempt:
            The attempt number (1 = first retry after initial failure).
        error:
            The error message from the failed attempt, stored for visibility.
        when:
            Wall-clock time of the retry (defaults to now).
        """
        ts = datetime.fromtimestamp(
            when if when is not None else time.time(), tz=timezone.utc
        ).isoformat()

        with self._lock:
            data = self._read_all()
            entry = data.get(stage_id, {})
            entry.update(
                {
                    "stage_id": stage_id,
                    # Keep state as running — the stage is still executing.
                    "state": STATE_RUNNING,
                    "retry_count": attempt,
                    "last_retry_at": ts,
                    # Persist the last transient error for observability.
                    "last_retry_error": error,
                }
            )
            data[stage_id] = entry
            self._write_all(data)

    def record_skip(
        self,
        stage_id: str,
        skip_reason: str,
        when: Optional[float] = None,
    ) -> None:
        """
        Record that ``stage_id`` was skipped rather than executed.

        Typically called when one or more upstream dependencies are in the
        ``"failed"`` state, making the stage's inputs incomplete or
        untrustworthy.

        Parameters
        ----------
        stage_id:
            The stage that is being skipped.
        skip_reason:
            Human-readable explanation, e.g.
            ``"upstream stage 'market_analyzer_hourly' failed"``.
        when:
            Wall-clock time of the skip decision (defaults to now).
        """
        ts = datetime.fromtimestamp(
            when if when is not None else time.time(), tz=timezone.utc
        ).isoformat()

        self._started_at.pop(stage_id, None)

        with self._lock:
            data = self._read_all()
            entry = data.get(stage_id, {})
            entry.update(
                {
                    "stage_id": stage_id,
                    "state": OUTCOME_SKIPPED,
                    "outcome": OUTCOME_SKIPPED,
                    "last_run": ts,
                    "skip_reason": skip_reason,
                    "duration_seconds": 0.0,
                    "error": None,
                }
            )
            data[stage_id] = entry
            self._write_all(data)

    def record_alert(self, stage_id: str) -> None:
        """
        Mark that a retry-exhausted alert has been sent for ``stage_id``.

        Prevents duplicate alerts if the stage keeps failing across
        scheduler ticks.
        """
        with self._lock:
            data = self._read_all()
            entry = data.get(stage_id, {})
            entry.update(
                {
                    "stage_id": stage_id,
                    "alerted": True,
                    "alerted_at": _utcnow_iso(),
                }
            )
            data[stage_id] = entry
            self._write_all(data)

    def get_runs(self) -> Dict[str, Dict[str, Any]]:
        """Return the latest recorded run for every known stage id."""
        with self._lock:
            return self._read_all()


# ── module-level default instance ──────────────────────────────────────
_default_registry: Optional[PipelineRunRegistry] = None
_default_lock = threading.Lock()


def get_default_registry() -> PipelineRunRegistry:
    """Return the process-wide default registry (path from the environment)."""
    global _default_registry
    if _default_registry is None:
        with _default_lock:
            if _default_registry is None:
                _default_registry = PipelineRunRegistry()
    return _default_registry


def attach_scheduler_listener(
    scheduler: Any, registry: Optional[PipelineRunRegistry] = None
) -> None:
    """
    Attach APScheduler listeners that record run start/duration/outcome for
    every job into ``registry`` (the default registry when omitted).
    """
    from apscheduler.events import (
        EVENT_JOB_ERROR,
        EVENT_JOB_EXECUTED,
        EVENT_JOB_SUBMITTED,
    )

    reg = registry or get_default_registry()

    def _on_submitted(event: Any) -> None:
        reg.record_start(event.job_id)

    def _on_executed(event: Any) -> None:
        reg.record_finish(event.job_id, OUTCOME_SUCCESS)

    def _on_error(event: Any) -> None:
        exc = getattr(event, "exception", None)
        reg.record_finish(
            event.job_id, OUTCOME_FAILED, error=str(exc) if exc else None
        )

    scheduler.add_listener(_on_submitted, EVENT_JOB_SUBMITTED)
    scheduler.add_listener(_on_executed, EVENT_JOB_EXECUTED)
    scheduler.add_listener(_on_error, EVENT_JOB_ERROR)
