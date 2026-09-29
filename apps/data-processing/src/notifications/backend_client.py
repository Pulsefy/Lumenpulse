# -*- coding: utf-8 -*-
"""
Authenticated delivery of drift alerts to the backend notification system (#1447).

The data-processing service raises drift alerts locally (feature drift,
metadata drift) but until now they were only visible in this service's logs.
This module routes them into the backend notification system over an
authenticated HTTP call:

    POST {BACKEND_URL}/notifications/drift-alerts
    x-drift-alert-signature: hex hmac-sha256("<timestamp>.<body>")
    x-drift-alert-timestamp: epoch milliseconds
    x-drift-alert-id:        alert UUID (dedup key from the alert engine)
    Content-Type: application/json

The signature scheme matches the backend's ``DriftAlertIngestionGuard``
(shared ``DRIFT_ALERT_INGEST_SECRET``). Severity is mapped onto the backend
notification priority model (low | medium | high | critical) via
:func:`map_severity_to_backend_priority`.

Delivery guarantees (acceptance criteria):

* **Authenticated** — every request is HMAC-signed; nothing is sent unsigned.
* **Never silently dropped** — after retries are exhausted the alert is
  persisted to a local dead-letter spool on disk so it can be replayed later
  (see :meth:`BackendNotificationClient.replay_spooled`). The function
  returns ``False`` and the caller logs an error; the alert itself is not lost.
* **Retried** — transient failures (network errors, 429/5xx) are retried with
  exponential backoff.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

import requests

from src.utils.logger import setup_logger

logger = setup_logger(__name__)

# ── Backend notification priority model ──────────────────────────────────────
# apps/backend/src/notification/notification.entity.ts: NotificationSeverity
BACKEND_SEVERITIES = ("low", "medium", "high", "critical")


def map_severity_to_backend_priority(severity: Any) -> str:
    """
    Map a data-processing severity string onto the backend notification
    priority model (``NotificationSeverity``: low | medium | high | critical).

    Data-processing uses healthy/info/warning/critical; the backend only has
    low/medium/high/critical. Unknown or missing severities degrade to
    ``medium`` so an alert is never rejected by enum validation.
    """
    normalized = str(severity or "").strip().lower()
    if normalized in ("critical",):
        return "critical"
    if normalized in ("warning",):
        return "high"
    if normalized in ("info",):
        return "medium"
    if normalized in ("healthy",):
        return "low"
    return "medium"


class BackendNotificationClient:
    """
    Sends notifications to the backend notification service over an
    authenticated (HMAC-signed) HTTP call, with retry and a disk spool for
    alerts that could not be delivered.
    """

    def __init__(
        self,
        base_url: Optional[str] = None,
        ingest_secret: Optional[str] = None,
        max_retries: Optional[int] = None,
        backoff_seconds: Optional[float] = None,
        spool_path: Optional[str] = None,
        timeout_seconds: float = 10.0,
        session: Optional[requests.Session] = None,
    ):
        self.base_url = (
            base_url
            or os.getenv("BACKEND_NOTIFICATION_URL")
            or os.getenv("BACKEND_URL")
            or ""
        ).rstrip("/")
        self.ingest_secret = ingest_secret or os.getenv(
            "DRIFT_ALERT_INGEST_SECRET", ""
        )
        self.max_retries = int(
            max_retries
            if max_retries is not None
            else os.getenv("BACKEND_NOTIFICATION_MAX_RETRIES", "5")
        )
        self.backoff_seconds = float(
            backoff_seconds
            if backoff_seconds is not None
            else os.getenv("BACKEND_NOTIFICATION_BACKOFF_SECONDS", "1")
        )
        self.timeout_seconds = timeout_seconds
        self.spool_path = Path(
            spool_path
            if spool_path is not None
            else os.getenv(
                "BACKEND_NOTIFICATION_SPOOL_PATH",
                "./data/undelivered_notifications.jsonl",
            )
        )
        self.session = session or requests.Session()

    # -- configuration -------------------------------------------------------

    @property
    def is_configured(self) -> bool:
        """True when both the backend URL and shared secret are present."""
        return bool(self.base_url and self.ingest_secret)

    @property
    def endpoint_url(self) -> str:
        return f"{self.base_url}/notifications/drift-alerts"

    # -- signing -------------------------------------------------------------

    def _sign(self, timestamp_ms: int, body: str) -> str:
        """HMAC-SHA256 of ``<timestamp>.<body>`` with the shared secret."""
        payload = f"{timestamp_ms}.{body}"
        return hmac.new(
            self.ingest_secret.encode("utf-8"),
            payload.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

    # -- public API ----------------------------------------------------------

    def send_drift_alert(
        self,
        *,
        alert_type: str,
        title: str,
        message: str,
        severity: str,
        metadata: Optional[Dict[str, Any]] = None,
        alert_id: Optional[str] = None,
        target_user_ids: Optional[list] = None,
    ) -> bool:
        """
        Deliver one drift alert to the backend notification service.

        Returns ``True`` when the backend accepted the alert (2xx). On
        terminal failure the alert is spooled to disk and ``False`` is
        returned — the alert is logged and retained, never silently dropped.
        """
        if not self.is_configured:
            logger.error(
                "Backend notification delivery is not configured: set "
                "BACKEND_NOTIFICATION_URL and DRIFT_ALERT_INGEST_SECRET. "
                "Spooling alert so it is not lost."
            )
            self._spool(
                {
                    "alert_type": alert_type,
                    "title": title,
                    "message": message,
                    "severity": severity,
                    "metadata": metadata,
                    "alert_id": alert_id,
                    "target_user_ids": target_user_ids,
                }
            )
            return False

        alert_id = alert_id or str(uuid.uuid4())
        backend_severity = map_severity_to_backend_priority(severity)

        payload: Dict[str, Any] = {
            "type": "drift",
            "title": title,
            "message": message,
            "severity": backend_severity,
            "eventCategory": "system",
            "alertId": alert_id,
            "metadata": {
                "alertType": alert_type,
                "originalSeverity": severity,
                "detectedAt": datetime.now(timezone.utc).isoformat(),
                **(metadata or {}),
            },
        }
        if target_user_ids:
            payload["targetUserIds"] = target_user_ids

        body = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        delivered = self._post_signed(body)

        if delivered:
            logger.info(
                "Drift alert delivered to backend notifications: "
                "alert_id=%s type=%s severity=%s",
                alert_id,
                alert_type,
                backend_severity,
            )
            return True

        logger.error(
            "Drift alert could not be delivered after %d attempts; spooled "
            "for replay: alert_id=%s type=%s",
            self.max_retries,
            alert_id,
            alert_type,
        )
        self._spool(payload)
        return False

    def replay_spooled(self, limit: int = 100) -> int:
        """
        Attempt to redeliver spooled alerts (e.g. after backend recovery).

        Returns the number of alerts successfully replayed. Successfully
        delivered entries are removed from the spool; failed ones stay.
        """
        if not self.spool_path.exists() or not self.is_configured:
            return 0

        replayed = 0
        remaining_lines = []
        with open(self.spool_path, "r", encoding="utf-8") as f:
            lines = f.readlines()

        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue
            try:
                payload = json.loads(stripped)
            except json.JSONDecodeError:
                logger.error("Discarding corrupt spool entry: %r", stripped[:120])
                continue

            body = json.dumps(payload, sort_keys=True, separators=(",", ":"))
            if self._post_signed(body):
                replayed += 1
                if replayed >= limit:
                    continue
            else:
                remaining_lines.append(stripped)

        if replayed:
            with open(self.spool_path, "w", encoding="utf-8") as f:
                for line in remaining_lines:
                    f.write(line + "\n")
            logger.info("Replayed %d spooled drift alert(s) to backend", replayed)
        return replayed

    # -- internals -----------------------------------------------------------

    def _post_signed(self, body: str) -> bool:
        """
        POST the JSON body with HMAC auth headers, retrying transient
        failures with exponential backoff. Returns True on 2xx.
        """
        last_error: Optional[str] = None
        for attempt in range(self.max_retries):
            timestamp_ms = int(time.time() * 1000)
            headers = {
                "Content-Type": "application/json",
                "x-drift-alert-signature": self._sign(timestamp_ms, body),
                "x-drift-alert-timestamp": str(timestamp_ms),
            }
            try:
                response = self.session.post(
                    self.endpoint_url,
                    data=body,
                    headers=headers,
                    timeout=self.timeout_seconds,
                )
                if 200 <= response.status_code < 300:
                    return True

                last_error = f"HTTP {response.status_code}: {response.text[:200]}"
                # 4xx (other than rate limiting) means the backend rejected
                # the request — retrying will not help, but the alert still
                # must not be silently dropped, so fall through to the spool.
                if 400 <= response.status_code < 500 and response.status_code != 429:
                    logger.error(
                        "Backend rejected drift alert (%s) — will not retry",
                        last_error,
                    )
                    return False
            except requests.RequestException as exc:
                last_error = str(exc)

            if attempt < self.max_retries - 1:
                sleep_for = self.backoff_seconds * (2**attempt)
                logger.warning(
                    "Backend notification delivery failed (%s); retrying in "
                    "%.1fs (attempt %d/%d)",
                    last_error,
                    sleep_for,
                    attempt + 1,
                    self.max_retries,
                )
                time.sleep(sleep_for)

        logger.error("Backend notification delivery failed: %s", last_error)
        return False

    def _spool(self, payload: Dict[str, Any]) -> None:
        """Persist an undelivered alert to disk so it is never lost."""
        try:
            self.spool_path.parent.mkdir(parents=True, exist_ok=True)
            with open(self.spool_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(payload, sort_keys=True) + "\n")
        except OSError:
            # The spool write itself failed — at minimum make the loss loud.
            logger.exception(
                "CRITICAL: failed to spool undelivered drift alert: %s",
                json.dumps(payload)[:500],
            )
