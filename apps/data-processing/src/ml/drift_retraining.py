"""Queue evaluation-gated retraining runs in response to feature drift."""

from __future__ import annotations

import hashlib
import json
import math
import os
from typing import Any

from src.db.postgres_service import PostgresService
from src.jobs.manager import submit_job
from src.utils.logger import setup_logger

logger = setup_logger(__name__)

_DEFAULT_COOLDOWN_SECONDS = 86_400.0


def _automatic_retraining_enabled() -> bool:
    value = os.getenv("FEATURE_DRIFT_AUTO_RETRAIN_ENABLED", "true").strip().lower()
    if value not in {"true", "false"}:
        raise ValueError(
            "FEATURE_DRIFT_AUTO_RETRAIN_ENABLED must be 'true' or 'false'"
        )
    return value == "true"


def _cooldown_seconds() -> float:
    seconds = float(
        os.getenv(
            "FEATURE_DRIFT_RETRAIN_COOLDOWN_SECONDS",
            str(_DEFAULT_COOLDOWN_SECONDS),
        )
    )
    if not math.isfinite(seconds) or seconds <= 0:
        raise ValueError(
            "FEATURE_DRIFT_RETRAIN_COOLDOWN_SECONDS must be a positive number"
        )
    return seconds


def _drift_signature(report: dict[str, Any]) -> str:
    identity = {
        "feature_set": report.get("feature_set"),
        "drifted_features": sorted(report.get("drifted_features") or []),
        "schema_mismatch": bool(report.get("schema_mismatch")),
    }
    canonical = json.dumps(identity, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def run_drift_triggered_retraining(
    trigger_context: dict[str, Any],
) -> dict[str, Any]:
    """Run the standard retraining pipeline without bypassing its evaluation gates."""
    from src.ml.retraining_pipeline import run_retraining

    return run_retraining(force=False, trigger_context=trigger_context)


def enqueue_drift_retraining(
    report: dict[str, Any],
    db_service: PostgresService | None = None,
) -> dict[str, Any]:
    """Queue a gated retraining job once per drift signature and cooldown."""
    if not report.get("drift_detected"):
        return {"status": "not_drifted"}
    if not _automatic_retraining_enabled():
        logger.info("Automatic drift retraining is disabled by configuration")
        return {"status": "disabled"}

    event_id = report.get("run_id")
    if not event_id:
        raise ValueError("Drift report is missing its run_id event identifier")

    signature = _drift_signature(report)
    trigger_context: dict[str, Any] = {
        "source": "feature_drift",
        "drift_event_id": event_id,
        "drift_signature": signature,
        "feature_set": report.get("feature_set"),
        "drifted_features": sorted(report.get("drifted_features") or []),
        "schema_mismatch": bool(report.get("schema_mismatch")),
        "threshold": report.get("threshold"),
        "detected_at": report.get("completed_at") or report.get("started_at"),
    }
    service = db_service or PostgresService()
    claimed = service.claim_feature_drift_retraining_cooldown(
        drift_signature=signature,
        drift_event_id=event_id,
        cooldown_seconds=_cooldown_seconds(),
    )
    if not claimed:
        logger.info(
            "Automatic retraining suppressed by drift cooldown: signature=%s",
            signature,
        )
        return {
            "status": "cooldown",
            "drift_event_id": event_id,
            "drift_signature": signature,
        }

    try:
        job, created = submit_job(
            service,
            job_type="retrain",
            idempotency_payload={"singleton": True},
            job_params={"singleton": True, "trigger": trigger_context},
            work_fn=lambda: run_drift_triggered_retraining(trigger_context),
        )
    except Exception:
        service.release_feature_drift_retraining_cooldown(signature, event_id)
        raise

    status = "submitted" if created else "already_running"
    logger.info(
        "Drift-triggered retraining %s: job_id=%s event_id=%s",
        status,
        job["job_id"],
        event_id,
    )
    return {
        "status": status,
        "job_id": job["job_id"],
        "created": created,
        "drift_event_id": event_id,
        "drift_signature": signature,
    }
