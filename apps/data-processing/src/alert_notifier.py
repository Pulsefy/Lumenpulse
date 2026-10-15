import os
import time
import logging

import requests

from src.utils.http_client import RobustHTTPClient

logger = logging.getLogger(__name__)

class AlertNotifier:
    def __init__(self):
        self.telegram_bot_token = os.getenv("TELEGRAM_BOT_TOKEN")
        self.telegram_channel_id = os.getenv("TELEGRAM_CHANNEL_ID")
        self.webhook_urls = self._load_webhook_urls()
        self.max_retries = int(os.getenv("WEBHOOK_MAX_RETRIES", "3"))
        self.base_backoff_seconds = float(os.getenv("WEBHOOK_BACKOFF_SECONDS", "1"))
        self.session = RobustHTTPClient()

    def _load_webhook_urls(self):
        urls = []

        single_url = os.getenv("ALERT_WEBHOOK_URL")
        if single_url:
            urls.append(single_url)

        registry = os.getenv("ALERT_WEBHOOK_URLS", "")
        if registry:
            urls.extend([url.strip() for url in registry.split(",") if url.strip()])

        return list(dict.fromkeys(urls))

    def notify_anomaly(self, result):
        if not getattr(result, "is_anomaly", False):
            return

        payload = {
            "event": "high_priority_insight",
            "type": "anomaly",
            "metric_name": result.metric_name,
            "severity_score": result.severity_score,
            "current_value": result.current_value,
            "baseline_mean": result.baseline_mean,
            "baseline_std": result.baseline_std,
            "z_score": result.z_score,
            "timestamp": result.timestamp.isoformat() if result.timestamp else None,
        }

        # Add explanation metadata if available
        if hasattr(result, "reason") and result.reason:
            payload["reason"] = result.reason
        if hasattr(result, "contributing_signals") and result.contributing_signals:
            payload["contributing_signals"] = result.contributing_signals
        if hasattr(result, "confidence_level") and result.confidence_level:
            payload["confidence_level"] = result.confidence_level

        self._send_telegram(payload)
        self._send_webhooks(payload)

    def notify_feature_drift(self, report):
        """Raise a training-vs-serving feature drift alert (#1239).

        ``report`` is the dict produced by
        ``FeatureDriftReport.to_dict()``. Reuses the same Telegram + webhook
        fan-out as anomaly alerts so drift travels the existing alerting path.
        """
        payload = {
            "event": "high_priority_insight",
            "type": "feature_drift",
            "feature_set": report.get("feature_set"),
            "drifted_features": report.get("drifted_features", []),
            "schema_mismatch": report.get("schema_mismatch", False),
            "training_schema_version": report.get("training_schema_version"),
            "serving_schema_version": report.get("serving_schema_version"),
            "threshold": report.get("threshold"),
            "results": report.get("results", []),
            "run_id": report.get("run_id"),
        }

        drifted = payload["drifted_features"]
        lines = ["🚨 Feature Drift Detected", f"Feature set: {payload['feature_set']}"]
        if payload["schema_mismatch"]:
            lines.append(
                "Schema mismatch: model trained on "
                f"v{payload['training_schema_version']} vs serving "
                f"v{payload['serving_schema_version']}"
            )
        if drifted:
            lines.append(f"Drifted features (PSI ≥ {payload['threshold']}): "
                         f"{', '.join(drifted)}")

        self._send_telegram_text("\n".join(lines))
        self._send_webhooks(payload)

        # Route the drift alert into the backend notification system (#1447).
        self._notify_backend(
            alert_type="feature_drift",
            title=f"Feature drift detected: {payload['feature_set']}",
            message="\n".join(lines),
            severity=(
                "critical"
                if payload.get("schema_mismatch")
                else "warning"
            ),
            payload=payload,
        )

    def _send_telegram(self, payload):
        text = (
            "🚨 High-Priority Insight\n"
            f"Metric: {payload['metric_name']}\n"
            f"Severity: {payload['severity_score']}\n"
            f"Current: {payload['current_value']}\n"
            f"Z-Score: {payload['z_score']}"
        )

        # Add explanation metadata to Telegram message if available
        if "confidence_level" in payload:
            text += f"\nConfidence: {payload['confidence_level']}"
        if "reason" in payload:
            text += f"\n\nReason: {payload['reason']}"
        if "contributing_signals" in payload:
            text += f"\nSignals: {', '.join(payload['contributing_signals'])}"

        self._send_telegram_text(text)

    def _send_telegram_text(self, text):
        if not self.telegram_bot_token or not self.telegram_channel_id:
            return

        self.session.post(
            f"https://api.telegram.org/bot{self.telegram_bot_token}/sendMessage",
            json={
                "chat_id": self.telegram_channel_id,
                "text": text,
            },
            timeout=10,
        )

    def _send_webhooks(self, payload):
        for url in self.webhook_urls:
            self._post_with_retry(url, payload)

    def _notify_backend(self, alert_type, title, message, severity, payload):
        """Deliver an alert to the backend notification service (#1447).

        Uses the shared drift-alert dispatcher so suppression/dedup rules
        apply and delivery failures are retried and spooled, never silently
        dropped. Failures are logged; they never break the alerting path.
        """
        try:
            from src.notifications.drift_alert_dispatcher import dispatch_drift_alert

            delivered = dispatch_drift_alert(
                alert_type=alert_type,
                title=title,
                message=message,
                severity=severity,
                payload=payload,
            )
            if not delivered:
                logger.warning(
                    "Backend notification not delivered for %s alert "
                    "(suppressed or spooled)",
                    alert_type,
                )
        except Exception:
            logger.exception(
                "Backend notification dispatch failed for %s alert",
                alert_type,
            )

    def _post_with_retry(self, url, payload):
        for attempt in range(self.max_retries):
            try:
                response = self.session.post(url, json=payload, timeout=10)
                if response.status_code < 400:
                    return True
            except requests.RequestException:
                pass

            if attempt < self.max_retries - 1:
                time.sleep(self.base_backoff_seconds * (2**attempt))

        return False
