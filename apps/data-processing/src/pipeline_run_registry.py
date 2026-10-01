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
    """A tiny JSON-file-backed store of the latest run per stage id."""

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
