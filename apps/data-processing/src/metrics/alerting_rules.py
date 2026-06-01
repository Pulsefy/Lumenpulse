"""
Alerting Rules for Indexer Lag and Failed Sources

Defines alerting rules and triggers log-based alerts when:
- Indexer lag exceeds thresholds
- Data sources fail repeatedly
- Ingestion falls significantly behind

Alert types:
- Log-based (MVP): Logs structured alert messages
- Telegram: Sends alerts to configured Telegram channel
- Webhook: Sends alerts to configured webhook endpoints

The rules engine evaluates metrics and fires alerts based on severity.
"""

import logging
import json
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional, Callable
from enum import Enum
from dataclasses import dataclass, asdict

logger = logging.getLogger(__name__)
# Separate logger for alerts (can be configured independently)
alert_logger = logging.getLogger("lumenpulse.alerts")


class AlertSeverity(Enum):
    """Alert severity levels."""
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


@dataclass
class Alert:
    """Represents an alert event."""
    alert_id: str
    severity: AlertSeverity
    title: str
    message: str
    rule_name: str
    source: str
    timestamp: datetime
    metric_data: Dict[str, Any]
    remediation_steps: List[str]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "alert_id": self.alert_id,
            "severity": self.severity.value,
            "title": self.title,
            "message": self.message,
            "rule_name": self.rule_name,
            "source": self.source,
            "timestamp": self.timestamp.isoformat(),
            "metric_data": self.metric_data,
            "remediation_steps": self.remediation_steps,
        }

    def to_json_log(self) -> str:
        """Format alert as JSON for structured logging."""
        return json.dumps(self.to_dict())


class AlertRule:
    """Base class for alert rules."""

    def __init__(
        self,
        rule_name: str,
        description: str,
        severity: AlertSeverity,
        remediation_steps: List[str]
    ):
        self.rule_name = rule_name
        self.description = description
        self.severity = severity
        self.remediation_steps = remediation_steps
        self.last_triggered: Optional[datetime] = None
        self.trigger_count = 0

    def evaluate(self, metrics: Dict[str, Any]) -> Optional[Alert]:
        """
        Evaluate the rule against metrics.

        Returns:
            Alert if rule is triggered, None otherwise
        """
        raise NotImplementedError

    def should_fire(self) -> bool:
        """Check if rule should fire (can implement cooldown logic)."""
        return True


class IndexerLagCriticalRule(AlertRule):
    """Alert when indexer lag exceeds critical threshold."""

    def __init__(self, threshold_seconds: float = 600):
        super().__init__(
            rule_name="indexer_lag_critical",
            description="Indexer lag exceeds critical threshold",
            severity=AlertSeverity.CRITICAL,
            remediation_steps=[
                "Check Stellar Horizon connectivity",
                "Verify ingestion process is running",
                "Review ingestion logs for errors",
                "Check database connection and performance",
                "Restart ingestion process if needed",
            ]
        )
        self.threshold_seconds = threshold_seconds

    def evaluate(self, metrics: Dict[str, Any]) -> Optional[Alert]:
        """Check for critical lag conditions."""
        lag_metric = metrics.get("stellar_ledger_lag")

        if not lag_metric or lag_metric.lag_seconds <= self.threshold_seconds:
            return None

        return Alert(
            alert_id=f"{self.rule_name}_{int(datetime.now(timezone.utc).timestamp())}",
            severity=self.severity,
            title="🚨 CRITICAL: Indexer Lag Detected",
            message=(
                f"Stellar ledger ingestion lag has reached {lag_metric.lag_seconds:.0f} seconds "
                f"(threshold: {self.threshold_seconds}s). The ingestion process is significantly "
                f"behind the latest ledger close time."
            ),
            rule_name=self.rule_name,
            source="indexer_lag_monitor",
            timestamp=datetime.now(timezone.utc),
            metric_data={
                "lag_seconds": lag_metric.lag_seconds,
                "threshold_seconds": self.threshold_seconds,
                "latest_ledger_sequence": lag_metric.details.get("latest_ledger_sequence"),
                "ledger_close_time": lag_metric.details.get("ledger_close_time"),
            },
            remediation_steps=self.remediation_steps
        )


class IndexerLagWarningRule(AlertRule):
    """Alert when indexer lag exceeds warning threshold."""

    def __init__(self, threshold_seconds: float = 120):
        super().__init__(
            rule_name="indexer_lag_warning",
            description="Indexer lag exceeds warning threshold",
            severity=AlertSeverity.WARNING,
            remediation_steps=[
                "Monitor Stellar Horizon latency",
                "Check ingestion process health",
                "Review recent database operations",
                "Consider horizontal scaling if persistent",
            ]
        )
        self.threshold_seconds = threshold_seconds

    def evaluate(self, metrics: Dict[str, Any]) -> Optional[Alert]:
        """Check for warning-level lag conditions."""
        lag_metric = metrics.get("stellar_ledger_lag")

        if not lag_metric:
            return None

        # Only alert if above warning but below critical
        if lag_metric.lag_seconds <= self.threshold_seconds:
            return None

        return Alert(
            alert_id=f"{self.rule_name}_{int(datetime.now(timezone.utc).timestamp())}",
            severity=self.severity,
            title="⚠️ WARNING: Elevated Indexer Lag",
            message=(
                f"Stellar ledger ingestion lag is at {lag_metric.lag_seconds:.0f} seconds "
                f"(threshold: {self.threshold_seconds}s). Performance is degraded but stable."
            ),
            rule_name=self.rule_name,
            source="indexer_lag_monitor",
            timestamp=datetime.now(timezone.utc),
            metric_data={
                "lag_seconds": lag_metric.lag_seconds,
                "threshold_seconds": self.threshold_seconds,
            },
            remediation_steps=self.remediation_steps
        )


class DataSourceFailureRule(AlertRule):
    """Alert when a data source experiences repeated failures."""

    def __init__(self, failure_threshold: int = 3, time_window_minutes: int = 5):
        super().__init__(
            rule_name="data_source_failure",
            description="Data source has experienced repeated failures",
            severity=AlertSeverity.WARNING,
            remediation_steps=[
                "Check data source API status",
                "Verify authentication credentials",
                "Check rate limiting status",
                "Review network connectivity",
                "Check firewall/proxy rules",
            ]
        )
        self.failure_threshold = failure_threshold
        self.time_window_minutes = time_window_minutes

    def evaluate(self, metrics: Dict[str, Any]) -> Optional[Alert]:
        """Check for repeated data source failures."""
        failures = metrics.get("recent_failures", [])
        failure_counts = metrics.get("failure_counts", {})

        if not failures or not failure_counts:
            return None

        # Check for sources exceeding failure threshold
        alerts = []
        for source_name, failure_count in failure_counts.items():
            if failure_count >= self.failure_threshold:
                # Get recent failures for this source
                source_failures = [f for f in failures if f.source_name == source_name]
                latest_failure = source_failures[-1] if source_failures else None

                if latest_failure:
                    alerts.append(Alert(
                        alert_id=f"{self.rule_name}_{source_name}_{int(datetime.now(timezone.utc).timestamp())}",
                        severity=self.severity,
                        title=f"⚠️ WARNING: {source_name} Failing",
                        message=(
                            f"Data source '{source_name}' has failed {failure_count} times "
                            f"in the last {self.time_window_minutes} minutes. "
                            f"Latest failure: {latest_failure.failure_type} - {latest_failure.error_message}"
                        ),
                        rule_name=self.rule_name,
                        source="data_source_monitor",
                        timestamp=datetime.now(timezone.utc),
                        metric_data={
                            "source_name": source_name,
                            "failure_count": failure_count,
                            "time_window_minutes": self.time_window_minutes,
                            "latest_failure_type": latest_failure.failure_type,
                            "latest_error_message": latest_failure.error_message,
                        },
                        remediation_steps=self.remediation_steps
                    ))

        # Return the first alert or None
        return alerts[0] if alerts else None


class IngestionFallBehindRule(AlertRule):
    """Alert when ingestion falls significantly behind across multiple sources."""

    def __init__(self, stale_data_threshold_seconds: float = 3600):
        super().__init__(
            rule_name="ingestion_fall_behind",
            description="Multiple ingestion sources falling behind",
            severity=AlertSeverity.CRITICAL,
            remediation_steps=[
                "Check ingestion pipeline status",
                "Verify all data sources are accessible",
                "Review ingestion process logs",
                "Check database performance and disk space",
                "Restart ingestion pipeline if necessary",
                "Escalate if issue persists after restart",
            ]
        )
        self.stale_data_threshold_seconds = stale_data_threshold_seconds

    def evaluate(self, metrics: Dict[str, Any]) -> Optional[Alert]:
        """Check if ingestion is falling behind across multiple sources."""
        lag_metrics = metrics.get("lag_metrics", {})

        # Find all ingestion lag metrics exceeding threshold
        stale_sources = []
        for metric_name, metric in lag_metrics.items():
            if "ingestion_lag" in metric_name and metric.lag_seconds > self.stale_data_threshold_seconds:
                stale_sources.append({
                    "source": metric.data_source,
                    "lag_seconds": metric.lag_seconds,
                })

        # Alert only if multiple sources are stale
        if len(stale_sources) >= 2:
            return Alert(
                alert_id=f"{self.rule_name}_{int(datetime.now(timezone.utc).timestamp())}",
                severity=self.severity,
                title="🚨 CRITICAL: Ingestion Pipeline Falling Behind",
                message=(
                    f"Multiple data sources are significantly stale ({len(stale_sources)} sources). "
                    f"Stale sources: {', '.join(s['source'] for s in stale_sources)}. "
                    f"Investigate ingestion pipeline performance immediately."
                ),
                rule_name=self.rule_name,
                source="ingestion_pipeline_monitor",
                timestamp=datetime.now(timezone.utc),
                metric_data={
                    "stale_sources": stale_sources,
                    "threshold_seconds": self.stale_data_threshold_seconds,
                },
                remediation_steps=self.remediation_steps
            )

        return None


class AlertRulesEngine:
    """Engine for evaluating alert rules and dispatching alerts."""

    def __init__(self):
        self.rules: List[AlertRule] = []
        self.active_alerts: List[Alert] = []
        self.alert_handlers: List[Callable[[Alert], None]] = []
        self._initialize_default_rules()

    def _initialize_default_rules(self):
        """Initialize default alert rules."""
        self.add_rule(IndexerLagCriticalRule(threshold_seconds=600))  # 10 minutes
        self.add_rule(IndexerLagWarningRule(threshold_seconds=120))   # 2 minutes
        self.add_rule(DataSourceFailureRule(failure_threshold=3, time_window_minutes=5))
        self.add_rule(IngestionFallBehindRule(stale_data_threshold_seconds=3600))  # 1 hour

    def add_rule(self, rule: AlertRule):
        """Register an alert rule."""
        self.rules.append(rule)
        logger.info(f"Alert rule registered: {rule.rule_name}")

    def add_handler(self, handler: Callable[[Alert], None]):
        """Register an alert handler (e.g., log, notify, webhook)."""
        self.alert_handlers.append(handler)

    def evaluate(self, metrics: Dict[str, Any]) -> List[Alert]:
        """
        Evaluate all rules against metrics and fire alerts.

        Args:
            metrics: Dictionary of collected metrics

        Returns:
            List of alerts that were triggered
        """
        triggered_alerts = []

        for rule in self.rules:
            if not rule.should_fire():
                continue

            try:
                alert = rule.evaluate(metrics)
                if alert:
                    triggered_alerts.append(alert)
                    self._dispatch_alert(alert)
            except Exception as e:
                logger.error(f"Error evaluating rule {rule.rule_name}: {e}", exc_info=True)

        return triggered_alerts

    def _dispatch_alert(self, alert: Alert):
        """Dispatch alert to all registered handlers."""
        self.active_alerts.append(alert)

        for handler in self.alert_handlers:
            try:
                handler(alert)
            except Exception as e:
                logger.error(f"Error in alert handler: {e}", exc_info=True)

    def get_active_alerts(self, severity: Optional[AlertSeverity] = None) -> List[Alert]:
        """Get currently active alerts, optionally filtered by severity."""
        if severity is None:
            return self.active_alerts

        return [a for a in self.active_alerts if a.severity == severity]

    def clear_alerts(self):
        """Clear active alerts."""
        self.active_alerts.clear()


# Alert handlers

def log_alert_handler(alert: Alert):
    """Handler that logs alerts using structured logging."""
    alert_logger.log(
        level=logging.WARNING if alert.severity == AlertSeverity.WARNING else logging.ERROR,
        msg=alert.title,
        extra={
            "alert_data": alert.to_dict(),
        }
    )
    # Also log as JSON for structured log parsing
    alert_logger.info(f"ALERT_JSON: {alert.to_json_log()}")


def telegram_alert_handler(alert: Alert, telegram_notifier=None):
    """Handler that sends alerts via Telegram."""
    if not telegram_notifier:
        logger.warning("Telegram notifier not configured; alert not sent")
        return

    message = (
        f"{alert.title}\n"
        f"{alert.message}\n\n"
        f"🔧 Remediation:\n"
        + "\n".join(f"• {step}" for step in alert.remediation_steps[:3])
    )

    try:
        telegram_notifier.send_message(message)
        logger.info(f"Telegram alert sent for {alert.rule_name}")
    except Exception as e:
        logger.error(f"Failed to send Telegram alert: {e}")


def webhook_alert_handler(alert: Alert, webhook_urls: List[str] = None):
    """Handler that sends alerts to webhooks."""
    if not webhook_urls:
        logger.warning("No webhook URLs configured; alert not sent")
        return

    import requests
    from concurrent.futures import ThreadPoolExecutor

    def post_webhook(url: str):
        try:
            response = requests.post(
                url,
                json=alert.to_dict(),
                timeout=10,
                headers={"Content-Type": "application/json"}
            )
            if response.status_code >= 400:
                logger.warning(f"Webhook returned status {response.status_code}: {url}")
            else:
                logger.info(f"Webhook alert sent to {url}")
        except Exception as e:
            logger.error(f"Failed to send webhook alert to {url}: {e}")

    # Send to all webhooks concurrently
    with ThreadPoolExecutor(max_workers=len(webhook_urls)) as executor:
        executor.map(post_webhook, webhook_urls)
