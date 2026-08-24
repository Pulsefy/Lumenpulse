"""Indexer lag metrics and log-based alerts for the data-processing pipeline.

MVP goals (issue #745):
- Emit lag metrics for Horizon ledger freshness and pipeline analytics freshness.
- Log structured alerts when lag or external source failures exceed thresholds.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import TYPE_CHECKING, Any, Dict, List, Optional

from src.ingestion.dataset_sla import DatasetSLAMeasurement, evaluate_dataset_slas
from src.ingestion.stellar_fetcher import StellarDataFetcher
from src.alert_engine.engine import AlertSuppressionEngine
from src.utils.logger import setup_logger
from src.utils.metrics import (
    ALERT_SUPPRESSIONS_TOTAL,
    ALERT_EMISSIONS_TOTAL,
    INDEXER_LAG_SECONDS,
    SOURCE_FAILURES_TOTAL,
    SOURCE_HEALTH,
)

if TYPE_CHECKING:
    from src.db.postgres_service import PostgresService

_suppression_engine: AlertSuppressionEngine = None

alert_logger = setup_logger("lumenpulse.ingestion_alerts")

KNOWN_SOURCES = ("stellar_horizon", "news", "price_feed", "social")


class AlertSeverity(str, Enum):
    HEALTHY = "healthy"
    WARNING = "warning"
    CRITICAL = "critical"


def _parse_iso_datetime(s: str) -> Optional[datetime]:
    if not s:
        return None
    try:
        if s.endswith("Z"):
            return datetime.fromisoformat(s.replace("Z", "+00:00"))
        return datetime.fromisoformat(s)
    except Exception:
        return None


def _horizon_latest_ledger(fetcher: StellarDataFetcher) -> Dict[str, Any]:
    from src.ingestion.stellar_ingestion_checks import (
        _horizon_latest_ledger as quality_horizon_latest_ledger,
    )

    return quality_horizon_latest_ledger(fetcher)


@dataclass
class LagMetricSnapshot:
    metric_name: str
    source: str
    lag_seconds: float
    severity: AlertSeverity
    warning_threshold_seconds: float
    critical_threshold_seconds: float
    details: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "metric_name": self.metric_name,
            "source": self.source,
            "lag_seconds": self.lag_seconds,
            "severity": self.severity.value,
            "warning_threshold_seconds": self.warning_threshold_seconds,
            "critical_threshold_seconds": self.critical_threshold_seconds,
            "details": self.details,
        }


@dataclass
class SourceFailureEvent:
    source: str
    failure_type: str
    message: str
    timestamp: datetime

    def to_dict(self) -> Dict[str, Any]:
        return {
            "source": self.source,
            "failure_type": self.failure_type,
            "message": self.message,
            "timestamp": self.timestamp.isoformat(),
        }


def _thresholds(metric_name: str) -> Dict[str, float]:
    defaults = {
        "stellar_ledger_lag": {"warning": 60.0, "critical": 300.0},
        "pipeline_analytics_lag": {"warning": 3600.0, "critical": 7200.0},
    }
    base = defaults.get(metric_name, {"warning": 600.0, "critical": 1800.0})
    prefix = metric_name.upper()
    warning = float(os.getenv(f"{prefix}_WARNING_SECONDS", base["warning"]))
    critical = float(os.getenv(f"{prefix}_CRITICAL_SECONDS", base["critical"]))
    return {"warning": warning, "critical": critical}


def _severity_for_lag(lag_seconds: float, metric_name: str) -> AlertSeverity:
    thresholds = _thresholds(metric_name)
    if lag_seconds >= thresholds["critical"]:
        return AlertSeverity.CRITICAL
    if lag_seconds >= thresholds["warning"]:
        return AlertSeverity.WARNING
    return AlertSeverity.HEALTHY


def _publish_lag_metric(snapshot: LagMetricSnapshot) -> None:
    INDEXER_LAG_SECONDS.labels(
        metric_name=snapshot.metric_name,
        source=snapshot.source,
    ).set(snapshot.lag_seconds)


def _emit_log_alert(
    *,
    alert_type: str,
    severity: AlertSeverity,
    title: str,
    message: str,
    payload: Dict[str, Any],
) -> None:
    record = {
        "alert_type": alert_type,
        "severity": severity.value,
        "title": title,
        "message": message,
        **payload,
    }
    if severity == AlertSeverity.CRITICAL:
        alert_logger.error("INGESTION_ALERT %s", record)
    elif severity == AlertSeverity.WARNING:
        alert_logger.warning("INGESTION_ALERT %s", record)
    else:
        alert_logger.info("INGESTION_METRIC %s", record)


_recent_failures: List[SourceFailureEvent] = []
_last_cycle_result: Dict[str, Any] = {}
_suppressed_alerts: List[Dict[str, Any]] = []


def get_suppression_engine() -> AlertSuppressionEngine:
    global _suppression_engine
    if _suppression_engine is None:
        _suppression_engine = AlertSuppressionEngine()
    return _suppression_engine


def reset_suppression_engine() -> None:
    global _suppression_engine, _suppressed_alerts
    _suppression_engine = None
    _suppressed_alerts = []


def get_last_alerting_status() -> Dict[str, Any]:
    return dict(_last_cycle_result)


def record_source_failure(
    source: str,
    failure_type: str,
    message: str = "",
) -> None:
    event = SourceFailureEvent(
        source=source,
        failure_type=failure_type,
        message=message,
        timestamp=datetime.now(timezone.utc),
    )
    _recent_failures.append(event)
    if len(_recent_failures) > 100:
        del _recent_failures[:-100]

    SOURCE_FAILURES_TOTAL.labels(source=source, failure_type=failure_type).inc()
    SOURCE_HEALTH.labels(source=source).set(0)

    engine = get_suppression_engine()
    alert = {
        "alert_type": "source_failure",
        "severity": AlertSeverity.WARNING.value,
        "source": source,
        "failure_type": failure_type,
        "message": message,
    }
    decision = engine.evaluate(alert)
    if decision.emit:
        ALERT_EMISSIONS_TOTAL.labels(
            rule_name=decision.rule_name, reason=decision.reason
        ).inc()
        _emit_log_alert(
            alert_type="source_failure",
            severity=AlertSeverity.WARNING,
            title=f"External source failure: {source}",
            message=message or failure_type,
            payload=event.to_dict(),
        )
    else:
        _suppressed_alerts.append(alert)
        ALERT_SUPPRESSIONS_TOTAL.labels(
            rule_name=decision.rule_name, reason=decision.reason
        ).inc()


def record_source_success(source: str) -> None:
    SOURCE_HEALTH.labels(source=source).set(1)


def measure_stellar_ledger_lag(
    *,
    network: Optional[str] = None,
    fetcher: Optional[StellarDataFetcher] = None,
) -> LagMetricSnapshot:
    network = network or os.getenv("STELLAR_NETWORK", "testnet")
    fetcher = fetcher or StellarDataFetcher(network=network)
    thresholds = _thresholds("stellar_ledger_lag")

    latest = _horizon_latest_ledger(fetcher)
    closed_at = _parse_iso_datetime(latest.get("ledger_close_time") or "")
    now = datetime.now(timezone.utc)

    if closed_at is None:
        snapshot = LagMetricSnapshot(
            metric_name="stellar_ledger_lag",
            source="stellar_horizon",
            lag_seconds=float("inf"),
            severity=AlertSeverity.CRITICAL,
            warning_threshold_seconds=thresholds["warning"],
            critical_threshold_seconds=thresholds["critical"],
            details={
                "reason": "Could not parse Horizon ledger close time",
                "latest": latest,
            },
        )
        record_source_failure(
            "stellar_horizon",
            "invalid_response",
            "Horizon latest ledger close time unavailable",
        )
        return snapshot

    lag_seconds = max(0.0, (now - closed_at).total_seconds())
    severity = _severity_for_lag(lag_seconds, "stellar_ledger_lag")
    snapshot = LagMetricSnapshot(
        metric_name="stellar_ledger_lag",
        source="stellar_horizon",
        lag_seconds=lag_seconds,
        severity=severity,
        warning_threshold_seconds=thresholds["warning"],
        critical_threshold_seconds=thresholds["critical"],
        details={
            "latest_ledger_sequence": latest.get("latest_ledger_sequence"),
            "ledger_close_time": closed_at.isoformat(),
            "checked_at": now.isoformat(),
        },
    )
    record_source_success("stellar_horizon")
    return snapshot


def measure_pipeline_analytics_lag(
    postgres: Optional["PostgresService"] = None,
) -> Optional[LagMetricSnapshot]:
    from sqlalchemy import func, select

    from src.db.models import AnalyticsRecord
    from src.db.postgres_service import PostgresService

    thresholds = _thresholds("pipeline_analytics_lag")
    now = datetime.now(timezone.utc)

    service = postgres
    owns_service = False
    if service is None:
        try:
            service = PostgresService()
            owns_service = True
        except Exception:
            return None

    try:
        with service.get_session() as session:
            latest_ts = session.execute(
                select(func.max(AnalyticsRecord.created_at))
            ).scalar_one_or_none()
    except Exception as exc:
        alert_logger.debug("Skipping pipeline analytics lag: %s", exc)
        return None
    finally:
        if owns_service and service is not None:
            service.engine.dispose()

    if latest_ts is None:
        return LagMetricSnapshot(
            metric_name="pipeline_analytics_lag",
            source="analytics_records",
            lag_seconds=float("inf"),
            severity=AlertSeverity.WARNING,
            warning_threshold_seconds=thresholds["warning"],
            critical_threshold_seconds=thresholds["critical"],
            details={"reason": "No analytics_records rows found"},
        )

    if latest_ts.tzinfo is None:
        latest_ts = latest_ts.replace(tzinfo=timezone.utc)

    lag_seconds = max(0.0, (now - latest_ts).total_seconds())
    return LagMetricSnapshot(
        metric_name="pipeline_analytics_lag",
        source="analytics_records",
        lag_seconds=lag_seconds,
        severity=_severity_for_lag(lag_seconds, "pipeline_analytics_lag"),
        warning_threshold_seconds=thresholds["warning"],
        critical_threshold_seconds=thresholds["critical"],
        details={
            "latest_record_at": latest_ts.isoformat(),
            "checked_at": now.isoformat(),
        },
    )


def evaluate_lag_alerts(metrics: List[LagMetricSnapshot]) -> List[Dict[str, Any]]:
    alerts: List[Dict[str, Any]] = []
    engine = get_suppression_engine()
    for metric in metrics:
        _publish_lag_metric(metric)
        if metric.severity == AlertSeverity.HEALTHY:
            continue

        alert = {
            "alert_type": "indexer_lag",
            "severity": metric.severity.value,
            "metric_name": metric.metric_name,
            "source": metric.source,
            "metric": metric.to_dict(),
        }

        decision = engine.evaluate(alert)
        if decision.emit:
            alerts.append(alert)
            ALERT_EMISSIONS_TOTAL.labels(
                rule_name=decision.rule_name, reason=decision.reason
            ).inc()
            _emit_log_alert(
                alert_type="indexer_lag",
                severity=metric.severity,
                title=f"Indexer lag alert: {metric.metric_name}",
                message=(
                    f"{metric.source} lag {metric.lag_seconds:.0f}s exceeds "
                    f"{metric.severity.value} threshold"
                ),
                payload=alert,
            )
        else:
            _suppressed_alerts.append(alert)
            ALERT_SUPPRESSIONS_TOTAL.labels(
                rule_name=decision.rule_name, reason=decision.reason
            ).inc()

    return alerts


_DATASET_BY_LAG_METRIC = {
    "stellar_ledger_lag": "stellar_ledger_events",
    "pipeline_analytics_lag": "analytics_records",
}


def _dataset_measurements_from_lag_metrics(
    metrics: List[LagMetricSnapshot],
) -> List[DatasetSLAMeasurement]:
    measurements: List[DatasetSLAMeasurement] = []
    for metric in metrics:
        dataset = _DATASET_BY_LAG_METRIC.get(metric.metric_name)
        if dataset is None:
            continue
        completeness_ratio = 1.0 if metric.lag_seconds != float("inf") else 0.0
        measurements.append(
            DatasetSLAMeasurement(
                dataset=dataset,
                freshness_seconds=metric.lag_seconds,
                completeness_ratio=completeness_ratio,
                details={
                    "source_metric": metric.to_dict(),
                    "completeness_basis": "1 when the lag probe produced a finite value, 0 otherwise",
                },
            )
        )
    return measurements


def evaluate_dataset_sla_alerts(
    measurements: List[DatasetSLAMeasurement],
) -> Dict[str, List[Dict[str, Any]]]:
    """Evaluate dataset SLA breaches through the alert suppression engine."""

    emitted: List[Dict[str, Any]] = []
    suppressed: List[Dict[str, Any]] = []
    engine = get_suppression_engine()

    for breach in evaluate_dataset_slas(measurements):
        alert = {
            "alert_type": "dataset_sla_breach",
            "severity": breach.severity,
            "dataset": breach.dataset,
            "sla_type": breach.sla_type,
            "metric_name": f"dataset_{breach.sla_type}_sla",
            "source": breach.dataset,
            "breach": breach.to_dict(),
        }
        decision = engine.evaluate(alert)
        alert["_suppression"] = {
            "dedup_key": decision.dedup_key,
            "rule_name": decision.rule_name,
            "reason": decision.reason,
        }
        if decision.emit:
            emitted.append(alert)
            ALERT_EMISSIONS_TOTAL.labels(
                rule_name=decision.rule_name, reason=decision.reason
            ).inc()
            _emit_log_alert(
                alert_type="dataset_sla_breach",
                severity=AlertSeverity(breach.severity),
                title=f"Dataset SLA breach: {breach.dataset}",
                message=(
                    f"{breach.dataset} {breach.sla_type} current "
                    f"{breach.current_value} violates target {breach.target_value}"
                ),
                payload=alert,
            )
        else:
            suppressed.append(alert)
            ALERT_SUPPRESSIONS_TOTAL.labels(
                rule_name=decision.rule_name, reason=decision.reason
            ).inc()

    return {
        "emitted": emitted,
        "suppressed": suppressed,
    }


def run_ingestion_alerting_cycle(
    *,
    network: Optional[str] = None,
    postgres: Optional["PostgresService"] = None,
    fetcher: Optional[StellarDataFetcher] = None,
) -> Dict[str, Any]:
    """Collect lag metrics, update Prometheus, and emit log-based alerts."""
    global _last_cycle_result

    metrics: List[LagMetricSnapshot] = [
        measure_stellar_ledger_lag(network=network, fetcher=fetcher),
    ]

    analytics_lag = measure_pipeline_analytics_lag(postgres=postgres)
    if analytics_lag is not None:
        metrics.append(analytics_lag)

    recent_failures = [event.to_dict() for event in _recent_failures[-20:]]
    lag_alerts = evaluate_lag_alerts(metrics)
    dataset_measurements = _dataset_measurements_from_lag_metrics(metrics)
    dataset_sla_alerts = evaluate_dataset_sla_alerts(dataset_measurements)

    engine = get_suppression_engine()
    suppressed = list(_suppressed_alerts)
    suppressed.extend(dataset_sla_alerts["suppressed"])
    _suppressed_alerts.clear()

    result = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "metrics": [metric.to_dict() for metric in metrics],
        "dataset_sla_measurements": [
            measurement.to_dict() for measurement in dataset_measurements
        ],
        "dataset_sla_alerts": dataset_sla_alerts["emitted"],
        "lag_alerts": lag_alerts,
        "recent_source_failures": recent_failures,
        "healthy": not lag_alerts
        and not dataset_sla_alerts["emitted"]
        and not dataset_sla_alerts["suppressed"]
        and not recent_failures,
        "suppressed_alerts": suppressed,
        "suppression_engine_stats": engine.stats,
    }
    _last_cycle_result = result
    return result


def get_suppressed_alerts() -> List[Dict[str, Any]]:
    return list(_suppressed_alerts)
