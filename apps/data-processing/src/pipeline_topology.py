# -*- coding: utf-8 -*-
"""
Pipeline topology (#1451).

Describes the scheduled data-processing pipeline - what runs, on what schedule,
and what each stage logically depends on - so the topology can be served over
the API instead of being reverse-engineered from ``src/scheduler.py``.

The stage ids and names here mirror the jobs registered by
``AnalyticsScheduler`` in ``src/scheduler.py``. That correspondence is not left
to trust: ``tests/test_pipeline_topology.py`` asserts that the ids declared in
``PIPELINE_STAGES`` exactly match the job ids the scheduler registers, so this
list cannot silently drift from the scheduler configuration.

APScheduler models no edges between jobs (every job is time-triggered and
independent), so ``depends_on`` records the *logical* data-flow dependencies
between stages. Every id it references is validated against the declared stages.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Tuple

# Derived status values reported per stage.
STATUS_NEVER_RUN = "never_run"
STATUS_RUNNING = "running"
STATUS_SUCCESS = "success"
STATUS_FAILED = "failed"


@dataclass(frozen=True)
class StageSpec:
    """A single scheduled pipeline stage."""

    id: str
    name: str
    schedule: str
    depends_on: Tuple[str, ...] = field(default=())


# Canonical stage list. Ids/names/schedules mirror ``AnalyticsScheduler``.
PIPELINE_STAGES: List[StageSpec] = [
    StageSpec(
        id="market_analyzer_hourly",
        name="Market Analyzer - Hourly Analytics",
        schedule="Every hour",
    ),
    StageSpec(
        id="stellar_ingestion_quality_checks_hourly",
        name="Stellar Ingestion Quality Checks - Hourly",
        schedule="Every hour",
    ),
    StageSpec(
        id="ingestion_lag_alerting",
        name="Indexer Lag and Source Failure Alerting",
        schedule="Every INGESTION_ALERT_INTERVAL_MINUTES minutes (default 5)",
    ),
    StageSpec(
        id="model_retraining_daily",
        name="Automated Model Retraining - Daily",
        schedule="Daily at 02:00 UTC",
        depends_on=("market_analyzer_hourly",),
    ),
    StageSpec(
        id="project_verification_trend",
        name="Project Verification Trend Analyzer",
        schedule="Every 6 hours",
    ),
    StageSpec(
        id="rpc_provider_benchmark",
        name="RPC Provider Benchmark",
        schedule="Every 30 minutes",
    ),
    StageSpec(
        id="round_anomaly_detection",
        name="Round Anomaly Detection",
        schedule="Every 6 hours",
    ),
    StageSpec(
        id="contributor_reputation_snapshot_daily",
        name="Contributor Reputation Snapshot Builder",
        schedule="Daily at 03:30 UTC",
    ),
    StageSpec(
        id="metadata_drift_detection",
        name="Metadata Drift Detector (backend vs on-chain)",
        schedule="Every 6 hours",
    ),
    StageSpec(
        id="feature_drift_detection",
        name="Training-vs-Serving Feature Drift Detection",
        schedule="Every FEATURE_DRIFT_INTERVAL_HOURS hours (default 6)",
        depends_on=("model_retraining_daily",),
    ),
    StageSpec(
        id="kpi_reconciliation",
        name="KPI Reconciler against Live Contract Reads",
        schedule="Every 6 hours",
        depends_on=("daily_onchain_kpi_snapshot",),
    ),
    StageSpec(
        id="daily_onchain_kpi_snapshot",
        name="Daily On-Chain KPI Snapshot Scheduler",
        schedule="Daily at 00:05 UTC",
    ),
    StageSpec(
        id="contract_ingestion_lag_metrics",
        name="Per-Contract Ingestion Lag Metrics",
        schedule="Every CONTRACT_LAG_INTERVAL_MINUTES minutes (default 5)",
    ),
    StageSpec(
        id="prediction_logs_cleanup",
        name="Prediction Logs Cleanup Scheduler",
        schedule="Daily at 02:00 UTC",
    ),
]


def stage_ids() -> List[str]:
    """Return the declared stage ids, in order."""
    return [stage.id for stage in PIPELINE_STAGES]


def validate_dependencies() -> None:
    """Raise ``ValueError`` if any ``depends_on`` references an unknown stage."""
    known = set(stage_ids())
    for stage in PIPELINE_STAGES:
        for dep in stage.depends_on:
            if dep not in known:
                raise ValueError(
                    f"Stage '{stage.id}' depends on unknown stage '{dep}'"
                )


def _status_for(record: Dict[str, Any]) -> str:
    """Map a persisted run record to a reported status."""
    state = record.get("state") or record.get("outcome")
    if state == STATUS_FAILED:
        return STATUS_FAILED
    if state == STATUS_RUNNING:
        return STATUS_RUNNING
    if state == STATUS_SUCCESS:
        return STATUS_SUCCESS
    return STATUS_SUCCESS if record.get("last_run") else STATUS_NEVER_RUN


def build_topology(runs: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Merge the declared stages with their latest run records.

    ``runs`` maps stage id -> the persisted run record (see
    ``pipeline_run_registry``). A stage with no record is reported as
    ``never_run`` with null run fields, which is how a stage that failed is
    told apart from one that has simply not run yet.
    """
    validate_dependencies()
    stages: List[Dict[str, Any]] = []
    for stage in PIPELINE_STAGES:
        record = runs.get(stage.id)
        if record is None:
            stages.append(
                {
                    "id": stage.id,
                    "name": stage.name,
                    "schedule": stage.schedule,
                    "depends_on": list(stage.depends_on),
                    "status": STATUS_NEVER_RUN,
                    "last_run": None,
                    "duration_seconds": None,
                    "outcome": None,
                    "error": None,
                }
            )
            continue
        stages.append(
            {
                "id": stage.id,
                "name": stage.name,
                "schedule": stage.schedule,
                "depends_on": list(stage.depends_on),
                "status": _status_for(record),
                "last_run": record.get("last_run"),
                "duration_seconds": record.get("duration_seconds"),
                "outcome": record.get("outcome"),
                "error": record.get("error"),
            }
        )
    return stages


def generated_at() -> str:
    """UTC timestamp for when a topology response is produced."""
    return datetime.now(timezone.utc).isoformat()
