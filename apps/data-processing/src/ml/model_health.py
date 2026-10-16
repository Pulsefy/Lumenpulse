# -*- coding: utf-8 -*-
"""
Model health / SLO reporting (#1647).

Computes a per-model trustworthiness snapshot for the data-processing service
from the signals it already observes:

* live version        - model registry current pointer
* drift state         - last feature-drift run (distribution / schema drift)
* calibration age     - time since the last successful retraining run
* data freshness      - ingestion freshness monitor for the feeds consumed

Each signal is classified ``trustworthy`` | ``degraded`` | ``unavailable`` and
the per-model overall is the worst of its signals. A snapshot also records
whether the model's overall state just transitioned into a non-trustworthy
state; those transitions are raised as alerts through the backend
notification path (:func:`src.notifications.drift_alert_dispatcher.dispatch_drift_alert`)
so the backend can decide whether to surface a prediction.

The monitor persists the last known state per model type to a JSON file so
transitions are detected across restarts. All external calls are injectable so
the module can be unit tested without a database or network.
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from src.utils.logger import setup_logger

logger = setup_logger(__name__)

# ── Trust states ─────────────────────────────────────────────────────────────

TRUSTWORTHY = "trustworthy"
DEGRADED = "degraded"
UNAVAILABLE = "unavailable"

_TRUST_STATES = (TRUSTWORTHY, DEGRADED, UNAVAILABLE)
_RANK = {TRUSTWORTHY: 0, DEGRADED: 1, UNAVAILABLE: 2}

# ── Defaults (overridable via environment) ───────────────────────────────────

DEFAULT_CALIBRATION_MAX_AGE_SECONDS = float(
    os.getenv("MODEL_CALIBRATION_MAX_AGE_SECONDS", str(7 * 24 * 60 * 60))
)
DEFAULT_STATE_PATH = os.getenv(
    "MODEL_HEALTH_STATE_PATH", "./data/model_health_states.json"
)

# Known serving model types assessed by the health endpoint.
DEFAULT_MODEL_TYPES = ("sentiment", "price_predictor")


def _worst(*states: str) -> str:
    """Return the worst (least trustworthy) of the given states."""
    return max(states, key=lambda state: _RANK.get(state, 99))


def _parse_utc(value: Any) -> Optional[datetime]:
    """Parse an ISO-8601 timestamp, treating naive datetimes as UTC."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


# ── Report types ─────────────────────────────────────────────────────────────


@dataclass
class ModelSignal:
    """The classified state of one health signal for a model."""

    state: str  # trustworthy | degraded | unavailable
    detail: str
    value: Optional[Any] = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ModelHealthSnapshot:
    """Point-in-time health snapshot for a single model type."""

    model_type: str
    live_version: Optional[str]
    drift: ModelSignal
    calibration_age: ModelSignal
    data_freshness: ModelSignal
    overall: str
    checked_at: str
    transitioned_to_degraded: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "model_type": self.model_type,
            "live_version": self.live_version,
            "drift": self.drift.to_dict(),
            "calibration_age": self.calibration_age.to_dict(),
            "data_freshness": self.data_freshness.to_dict(),
            "overall": self.overall,
            "checked_at": self.checked_at,
            "transitioned_to_degraded": self.transitioned_to_degraded,
        }


# ── Monitor ──────────────────────────────────────────────────────────────────


class ModelHealthMonitor:
    """
    Assess per-model SLO health and alert when a model transitions into a
    degraded or unavailable state.
    """

    def __init__(
        self,
        state_path: str = DEFAULT_STATE_PATH,
        model_types: Optional[tuple[str, ...]] = None,
        version_reader: Optional[Callable[[str], Optional[str]]] = None,
        drift_check: Optional[Callable[[], dict[str, Any]]] = None,
        calibration_reader: Optional[Callable[[], dict[str, Any]]] = None,
        freshness_check: Optional[Callable[[], dict[str, Any]]] = None,
        alerter: Optional[Callable[..., bool]] = None,
        calibration_max_age_seconds: float = DEFAULT_CALIBRATION_MAX_AGE_SECONDS,
    ):
        self.state_path = state_path
        self.model_types = model_types or DEFAULT_MODEL_TYPES
        self._version_reader = version_reader
        self._drift_check = drift_check
        self._calibration_reader = calibration_reader
        self._freshness_check = freshness_check
        self._alerter = alerter
        self.calibration_max_age_seconds = calibration_max_age_seconds

    # -- dependency resolution ----------------------------------------------

    def _read_version(self, model_type: str) -> Optional[str]:
        if self._version_reader is not None:
            return self._version_reader(model_type)
        from src.ml.model_registry import get_current_version

        return get_current_version(model_type)

    def _run_drift_check(self) -> dict[str, Any]:
        if self._drift_check is not None:
            return self._drift_check()
        from src.ml.feature_drift_detector import run_feature_drift_check

        return run_feature_drift_check()

    def _read_calibration(self) -> dict[str, Any]:
        if self._calibration_reader is not None:
            return self._calibration_reader()
        from src.ml.retraining_pipeline import get_last_run_status

        return get_last_run_status()

    def _run_freshness_check(self) -> dict[str, Any]:
        if self._freshness_check is not None:
            return self._freshness_check()
        from src.ingestion.freshness_monitor import run_freshness_check

        return run_freshness_check()

    def _alert(
        self,
        alert_type: str,
        title: str,
        message: str,
        severity: str,
        payload: dict[str, Any],
    ) -> bool:
        if self._alerter is not None:
            return bool(
                self._alerter(
                    alert_type=alert_type,
                    title=title,
                    message=message,
                    severity=severity,
                    payload=payload,
                )
            )
        from src.notifications.drift_alert_dispatcher import dispatch_drift_alert

        return bool(
            dispatch_drift_alert(
                alert_type=alert_type,
                title=title,
                message=message,
                severity=severity,
                payload=payload,
            )
        )

    # -- state persistence (transition detection) ---------------------------

    def _load_previous_states(self) -> dict[str, str]:
        try:
            with open(self.state_path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            return data if isinstance(data, dict) else {}
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return {}

    def _persist_states(self, states: dict[str, str]) -> None:
        try:
            parent = os.path.dirname(self.state_path)
            if parent:
                os.makedirs(parent, exist_ok=True)
            temporary = self.state_path + ".tmp"
            with open(temporary, "w", encoding="utf-8") as fh:
                json.dump(states, fh)
            os.replace(temporary, self.state_path)
        except OSError as exc:
            logger.warning("Could not persist model health state: %s", exc)

    # -- signal assessment --------------------------------------------------

    def _assess_drift(self) -> ModelSignal:
        try:
            report = self._run_drift_check()
        except Exception as exc:  # pragma: no cover - defensive
            logger.error("Drift check failed during model health assessment: %s", exc)
            return ModelSignal(UNAVAILABLE, f"drift check unavailable: {exc}")

        status = report.get("status")
        if status == "error":
            return ModelSignal(
                UNAVAILABLE, f"drift check errored: {report.get('error')}"
            )
        if status == "no_baseline":
            return ModelSignal(
                UNAVAILABLE,
                "no drift baseline recorded for the live model",
            )
        if status == "insufficient_serving_data":
            return ModelSignal(
                DEGRADED,
                "insufficient serving data to assess drift",
            )
        if report.get("drift_detected") or report.get("schema_mismatch"):
            drifted = report.get("drifted_features") or []
            detail = "drift detected"
            if drifted:
                detail += f" ({', '.join(drifted)})"
            if report.get("schema_mismatch"):
                detail += "; feature schema mismatch"
            return ModelSignal(DEGRADED, detail, value=drifted)
        return ModelSignal(TRUSTWORTHY, "no drift beyond threshold")

    def _assess_calibration(self) -> ModelSignal:
        try:
            run = self._read_calibration()
        except Exception as exc:  # pragma: no cover - defensive
            logger.error("Calibration status read failed: %s", exc)
            return ModelSignal(UNAVAILABLE, f"calibration status unavailable: {exc}")

        status = run.get("status")
        if status == "never_run" or status != "completed":
            return ModelSignal(
                UNAVAILABLE,
                "model has never been calibrated / last retraining did not complete",
                value=None,
            )

        finished_at = _parse_utc(run.get("finished_at") or run.get("completed_at"))
        if finished_at is None:
            return ModelSignal(
                UNAVAILABLE,
                "no calibration timestamp recorded",
                value=None,
            )

        age_seconds = (datetime.now(timezone.utc) - finished_at).total_seconds()
        if age_seconds < 0:
            age_seconds = 0.0

        if age_seconds > self.calibration_max_age_seconds:
            return ModelSignal(
                DEGRADED,
                f"calibration is {age_seconds:.0f}s old (max {self.calibration_max_age_seconds:.0f}s)",
                value=round(age_seconds),
            )
        return ModelSignal(
            TRUSTWORTHY,
            f"calibrated {age_seconds:.0f}s ago",
            value=round(age_seconds),
        )

    def _assess_freshness(self) -> ModelSignal:
        try:
            report = self._run_freshness_check()
        except Exception as exc:  # pragma: no cover - defensive
            logger.error(
                "Freshness check failed during model health assessment: %s", exc
            )
            return ModelSignal(UNAVAILABLE, f"freshness check unavailable: {exc}")

        results = report.get("results") or []
        worst_age = 0.0
        worst_severity = "healthy"
        stale: list[str] = []
        for result in results:
            severity = str(result.get("severity", "healthy"))
            age = result.get("age_seconds")
            if isinstance(age, (int, float)) and age > worst_age:
                worst_age = float(age)
            if severity == "critical":
                worst_severity = "critical"
            elif severity == "warning" and worst_severity != "critical":
                worst_severity = "warning"
            if severity != "healthy":
                stale.append(str(result.get("source", "?")))

        if worst_severity == "critical":
            return ModelSignal(
                UNAVAILABLE,
                f"data feeds stale: {', '.join(stale) or 'unknown'}",
                value=None if worst_age == float("inf") else round(worst_age),
            )
        if worst_severity == "warning":
            return ModelSignal(
                DEGRADED,
                f"data feeds approaching staleness: {', '.join(stale) or 'unknown'}",
                value=None if worst_age == float("inf") else round(worst_age),
            )
        return ModelSignal(
            TRUSTWORTHY,
            "all data feeds within freshness SLA",
            value=round(worst_age),
        )

    # -- public API ----------------------------------------------------------

    def assess(self, model_type: str) -> ModelHealthSnapshot:
        """Assess one model type, persist the result, and alert on degradation."""
        previous_states = self._load_previous_states()
        previous_state = previous_states.get(model_type)

        drift = self._assess_drift()
        calibration = self._assess_calibration()
        freshness = self._assess_freshness()
        live_version = self._read_version(model_type)

        if live_version is None:
            overall = UNAVAILABLE
        else:
            overall = _worst(drift.state, calibration.state, freshness.state)

        now = datetime.now(timezone.utc).isoformat()

        worsened = (
            previous_state is not None
            and _RANK[overall] > _RANK[previous_state]
            and overall != TRUSTWORTHY
        )
        first_seen_bad = previous_state is None and overall != TRUSTWORTHY
        transitioned = worsened or first_seen_bad

        self._persist_states({**previous_states, model_type: overall})

        snapshot = ModelHealthSnapshot(
            model_type=model_type,
            live_version=live_version,
            drift=drift,
            calibration_age=calibration,
            data_freshness=freshness,
            overall=overall,
            checked_at=now,
            transitioned_to_degraded=transitioned,
        )

        if transitioned:
            self._raise_alert(model_type, snapshot)

        return snapshot

    def assess_all(self) -> dict[str, ModelHealthSnapshot]:
        """Assess every configured model type."""
        return {model_type: self.assess(model_type) for model_type in self.model_types}

    # -- alerting -----------------------------------------------------------

    def _raise_alert(self, model_type: str, snapshot: ModelHealthSnapshot) -> None:
        severity = "critical" if snapshot.overall == UNAVAILABLE else "warning"
        payload = {
            "model_type": model_type,
            "live_version": snapshot.live_version,
            "overall": snapshot.overall,
            "drift": snapshot.drift.to_dict(),
            "calibration_age": snapshot.calibration_age.to_dict(),
            "data_freshness": snapshot.data_freshness.to_dict(),
        }
        title = f"Model {model_type} health is {snapshot.overall}"
        detail = (
            f"{model_type}@{snapshot.live_version or 'unknown'} is {snapshot.overall}: "
            f"drift={snapshot.drift.state}, calibration={snapshot.calibration_age.state}, "
            f"freshness={snapshot.data_freshness.state}"
        )
        try:
            dispatched = self._alert(
                alert_type="model_health",
                title=title,
                message=detail,
                severity=severity,
                payload=payload,
            )
            if dispatched:
                logger.info(
                    "Model health alert dispatched: type=%s state=%s severity=%s",
                    model_type,
                    snapshot.overall,
                    severity,
                )
            else:
                logger.warning(
                    "Model health alert not delivered (spooled for replay): type=%s state=%s",
                    model_type,
                    snapshot.overall,
                )
        except (
            Exception
        ) as exc:  # pragma: no cover - alerting must never fail the check
            logger.exception(
                "Failed to dispatch model health alert for %s: %s", model_type, exc
            )


# ── Default monitor (shared by the API and CLI) ──────────────────────────────

model_health_monitor = ModelHealthMonitor()


def assess_model_health(model_type: str) -> ModelHealthSnapshot:
    """Convenience entrypoint using the shared monitor."""
    return model_health_monitor.assess(model_type)


def get_model_health() -> dict[str, Any]:
    """Return a JSON-serialisable snapshot of every configured model type."""
    snapshots = model_health_monitor.assess_all()
    return {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "models": {
            model_type: snapshot.to_dict() for model_type, snapshot in snapshots.items()
        },
    }
