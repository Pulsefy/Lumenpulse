# -*- coding: utf-8 -*-
"""
Drift-alert dispatch pipeline (#1447).

Bridges the drift detectors (:mod:`src.ml.feature_drift_detector`,
:mod:`src.metadata_drift_detector`) and the generic alert engine
(:mod:`src.alert_engine`) into the backend notification system.

Flow for every drift alert:

    drift detector
      → AlertSuppressionEngine.evaluate()      # dedup / suppression window
      → emitted? → BackendNotificationClient.send_drift_alert()
      → suppressed? → counted + logged only

This keeps a persistent drift from spamming the backend: the same
feature-set/schema-mismatch alert inside the suppression window is recorded
and counted, but not delivered again. Delivery failures never drop an alert
(see :class:`BackendNotificationClient`).
"""

from __future__ import annotations

import os
import uuid
from typing import Any, Dict, Optional

from src.alert_engine.engine import AlertSuppressionEngine
from src.notifications.backend_client import BackendNotificationClient
from src.utils.logger import setup_logger
from src.utils.metrics import (
    ALERT_EMISSIONS_TOTAL,
    ALERT_SUPPRESSIONS_TOTAL,
    DRIFT_ALERTS_DELIVERED_TOTAL,
)

logger = setup_logger("lumenpulse.drift_alerts")

# Alert types routed by this dispatcher, used as suppression rule keys.
FEATURE_DRIFT_ALERT_TYPE = "feature_drift"
METADATA_DRIFT_ALERT_TYPE = "metadata_drift"

# Suppression window defaults: a persistent drift re-emits at most every
# DRIFT_ALERT_SUPPRESSION_WINDOW_SECONDS while it persists.
_DEFAULT_SUPPRESSION_WINDOW_SECONDS = 3600.0


def get_drift_suppression_engine() -> AlertSuppressionEngine:
    """
    Suppression engine dedicated to drift alerts.

    Configured from DRIFT_ALERT_RULES_JSON when provided (same schema as
    ALERT_RULES_JSON), otherwise a single repeat-alert rule that dedups on
    alert type + drift identity with a configurable window.
    """
    global _drift_engine
    if _drift_engine is None:
        import json

        rules_json = os.getenv("DRIFT_ALERT_RULES_JSON")
        if rules_json:
            try:
                from src.alert_engine.config import build_rules_from_config

                data = json.loads(rules_json)
                if isinstance(data, list):
                    _drift_engine = AlertSuppressionEngine(
                        rules=build_rules_from_config(data),
                        storage_path=os.getenv(
                            "DRIFT_ALERT_SUPPRESSION_STORE_PATH",
                            "./data/drift_alert_suppression.json",
                        ),
                    )
            except (json.JSONDecodeError, TypeError, ValueError) as exc:
                logger.error(
                    "Invalid DRIFT_ALERT_RULES_JSON (%s); falling back to the "
                    "default drift suppression rule",
                    exc,
                )

        if _drift_engine is None:
            from src.alert_engine.rule import RepeatAlertRule

            window = float(
                os.getenv(
                    "DRIFT_ALERT_SUPPRESSION_WINDOW_SECONDS",
                    str(_DEFAULT_SUPPRESSION_WINDOW_SECONDS),
                )
            )
            _drift_engine = AlertSuppressionEngine(
                rules=[
                    RepeatAlertRule(
                        name="dedup_drift_alerts",
                        window_seconds=window,
                        key_fields=[
                            "alert_type",
                            "feature_set",
                            "schema_signature",
                            "project_id",
                        ],
                    )
                ],
                storage_path=os.getenv(
                    "DRIFT_ALERT_SUPPRESSION_STORE_PATH",
                    "./data/drift_alert_suppression.json",
                ),
            )
    return _drift_engine


_drift_engine: Optional[AlertSuppressionEngine] = None


def reset_drift_suppression_engine() -> None:
    """Test/diagnostics hook: forget the cached suppression engine."""
    global _drift_engine
    _drift_engine = None


def _get_backend_client() -> BackendNotificationClient:
    global _backend_client
    if _backend_client is None:
        _backend_client = BackendNotificationClient()
    return _backend_client


_backend_client: Optional[BackendNotificationClient] = None


def _set_backend_client_for_testing(client: Optional[BackendNotificationClient]) -> None:
    global _backend_client
    _backend_client = client


def _suppression_signature(alert_type: str, payload: Dict[str, Any]) -> str:
    """
    Stable identity of a drift alert for dedup purposes.

    * feature drift → feature set + the set of drifted features + schema skew
    * metadata drift → project id + scope + field (or findings digest)
    """
    if alert_type == FEATURE_DRIFT_ALERT_TYPE:
        drifted = sorted(payload.get("drifted_features") or [])
        return "|".join(
            [
                str(payload.get("feature_set") or ""),
                ",".join(drifted),
                "schema" if payload.get("schema_mismatch") else "dist",
            ]
        )
    if alert_type == METADATA_DRIFT_ALERT_TYPE:
        parts = [
            str(payload.get("project_id") or payload.get("run_id") or ""),
            str(payload.get("scope") or ""),
            str(payload.get("field") or ""),
        ]
        findings = payload.get("findings")
        if findings:
            digest = ",".join(
                sorted(
                    f"{f.get('project_id')}:{f.get('scope')}:{f.get('field')}"
                    for f in findings
                    if isinstance(f, dict)
                )
            )
            parts.append(digest)
        return "|".join(parts)
    return ""


def dispatch_drift_alert(
    *,
    alert_type: str,
    title: str,
    message: str,
    severity: str,
    payload: Optional[Dict[str, Any]] = None,
) -> bool:
    """
    Route one drift alert into the backend notification system.

    Applies the drift suppression rules (dedup within the window), then
    delivers via the authenticated backend client. Returns True only when
    the alert passed suppression AND was accepted by the backend.
    """
    payload = dict(payload or {})
    payload.setdefault("alert_type", alert_type)
    # Identity used by the suppression rules for dedup (see the rule's
    # key_fields and _suppression_signature).
    payload.setdefault("schema_signature", _suppression_signature(alert_type, payload))

    engine = get_drift_suppression_engine()

    # Snapshot the suppression state BEFORE evaluation so a failed delivery
    # can roll the dedup record back: an undelivered alert must stay
    # re-attemptable (retry), not be silenced by the window that this very
    # attempt opened.
    store = getattr(engine, "_store", None)
    snapshot = {k: v.to_dict() for k, v in store.records.items()} if store else None

    decision = engine.evaluate(payload)
    if not decision.emit:
        ALERT_SUPPRESSIONS_TOTAL.labels(
            rule_name=decision.rule_name, reason=decision.reason
        ).inc()
        DRIFT_ALERTS_DELIVERED_TOTAL.labels(
            alert_type=alert_type, outcome="suppressed"
        ).inc()
        logger.info(
            "Drift alert suppressed by dedup engine: type=%s key=%s rule=%s "
            "reason=%s",
            alert_type,
            decision.dedup_key,
            decision.rule_name,
            decision.reason,
        )
        return False

    ALERT_EMISSIONS_TOTAL.labels(
        rule_name=decision.rule_name, reason=decision.reason
    ).inc()

    alert_id = str(uuid.uuid4())
    delivered = _get_backend_client().send_drift_alert(
        alert_type=alert_type,
        title=title,
        message=message,
        severity=severity,
        metadata=payload,
        alert_id=alert_id,
    )

    DRIFT_ALERTS_DELIVERED_TOTAL.labels(
        alert_type=alert_type,
        outcome="delivered" if delivered else "spooled",
    ).inc()

    if not delivered and snapshot is not None:
        try:
            store.replace_records(snapshot)
        except Exception:  # pragma: no cover - defensive
            logger.warning(
                "Could not roll back dedup record after failed delivery for "
                "type=%s; the spool still retains the alert",
                alert_type,
            )

    if not delivered:
        logger.error(
            "Drift alert NOT delivered to backend (retained in spool): "
            "type=%s title=%r",
            alert_type,
            title,
        )
    return delivered
