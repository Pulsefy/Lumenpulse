# -*- coding: utf-8 -*-
"""Tests for the pipeline topology API (#1451)."""

from __future__ import annotations

import os

from src.pipeline_run_registry import (
    OUTCOME_FAILED,
    OUTCOME_SUCCESS,
    PipelineRunRegistry,
)
from src.pipeline_topology import (
    PIPELINE_STAGES,
    STATUS_FAILED,
    STATUS_NEVER_RUN,
    STATUS_RUNNING,
    STATUS_SUCCESS,
    build_topology,
    stage_ids,
    validate_dependencies,
)


def test_stage_ids_are_unique():
    ids = stage_ids()
    assert len(ids) == len(set(ids))
    assert len(ids) == len(PIPELINE_STAGES)


def test_dependencies_reference_known_stages():
    # Should not raise.
    validate_dependencies()
    known = set(stage_ids())
    for stage in PIPELINE_STAGES:
        for dep in stage.depends_on:
            assert dep in known


def test_build_topology_reports_never_run_without_records():
    stages = build_topology({})
    assert len(stages) == len(PIPELINE_STAGES)
    for stage in stages:
        assert stage["status"] == STATUS_NEVER_RUN
        assert stage["last_run"] is None
        assert stage["duration_seconds"] is None
        assert stage["outcome"] is None


def test_build_topology_distinguishes_failed_running_and_success():
    first = PIPELINE_STAGES[0].id
    second = PIPELINE_STAGES[1].id
    third = PIPELINE_STAGES[2].id
    runs = {
        first: {
            "state": OUTCOME_SUCCESS,
            "outcome": OUTCOME_SUCCESS,
            "last_run": "2026-09-29T00:00:00+00:00",
            "duration_seconds": 1.5,
        },
        second: {
            "state": OUTCOME_FAILED,
            "outcome": OUTCOME_FAILED,
            "last_run": "2026-09-29T01:00:00+00:00",
            "duration_seconds": 0.2,
            "error": "boom",
        },
        third: {"state": "running", "started_at": "2026-09-29T02:00:00+00:00"},
    }
    by_id = {stage["id"]: stage for stage in build_topology(runs)}

    assert by_id[first]["status"] == STATUS_SUCCESS
    assert by_id[first]["duration_seconds"] == 1.5

    assert by_id[second]["status"] == STATUS_FAILED
    assert by_id[second]["error"] == "boom"

    assert by_id[third]["status"] == STATUS_RUNNING

    # A failed stage must be distinguishable from one that never ran.
    untouched = PIPELINE_STAGES[3].id
    assert by_id[untouched]["status"] == STATUS_NEVER_RUN
    assert by_id[second]["status"] != by_id[untouched]["status"]


def test_registry_records_start_and_finish(tmp_path):
    path = os.path.join(str(tmp_path), "runs.json")
    registry = PipelineRunRegistry(path=path)

    registry.record_start("stage_a", when=100.0)
    running = registry.get_runs()
    assert running["stage_a"]["state"] == "running"

    registry.record_finish("stage_a", OUTCOME_SUCCESS, when=105.0)
    finished = registry.get_runs()
    assert finished["stage_a"]["outcome"] == OUTCOME_SUCCESS
    # Duration is derived from the recorded start when not given explicitly.
    assert finished["stage_a"]["duration_seconds"] == 5.0
    assert finished["stage_a"]["last_run"] is not None


def test_registry_records_failure_with_error(tmp_path):
    path = os.path.join(str(tmp_path), "runs.json")
    registry = PipelineRunRegistry(path=path)

    registry.record_finish(
        "stage_b", OUTCOME_FAILED, duration_seconds=2.0, error="kaboom"
    )
    runs = registry.get_runs()
    assert runs["stage_b"]["outcome"] == OUTCOME_FAILED
    assert runs["stage_b"]["error"] == "kaboom"
    assert runs["stage_b"]["duration_seconds"] == 2.0


def test_registry_tolerates_missing_file(tmp_path):
    path = os.path.join(str(tmp_path), "does-not-exist.json")
    registry = PipelineRunRegistry(path=path)
    assert registry.get_runs() == {}


def test_topology_ids_match_scheduler_jobs(monkeypatch, tmp_path):
    """
    The declared stages must match the jobs the scheduler actually registers,
    so the topology cannot drift from the scheduler configuration.
    """
    # Keep run-tracking writes out of the repo during the test.
    monkeypatch.setenv(
        "PIPELINE_RUN_STATE_PATH", os.path.join(str(tmp_path), "runs.json")
    )
    from src.scheduler import AnalyticsScheduler

    scheduler = AnalyticsScheduler()
    try:
        scheduler.start()
        job_ids = {job.id for job in scheduler.get_jobs()}
    finally:
        scheduler.stop()

    assert job_ids == set(stage_ids())
