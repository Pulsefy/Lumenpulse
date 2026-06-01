"""
Metrics and Alerting Module

Provides:
- Indexer lag monitoring (indexer_lag.py)
- Alerting rules engine (alerting_rules.py)
- Ingestion monitoring job (ingestion_monitoring.py)
"""

from .indexer_lag import IndexerLagMonitor, LagMetric, SourceFailure, LagSeverity
from .alerting_rules import (
    AlertRulesEngine,
    Alert,
    AlertRule,
    AlertSeverity,
    IndexerLagCriticalRule,
    IndexerLagWarningRule,
    DataSourceFailureRule,
    IngestionFallBehindRule,
    log_alert_handler,
    telegram_alert_handler,
    webhook_alert_handler,
)
from .ingestion_monitoring import (
    IngestionLagMonitoringJob,
    initialize_monitoring_job,
    get_monitoring_job,
    record_fetcher_failure,
)

__all__ = [
    "IndexerLagMonitor",
    "LagMetric",
    "SourceFailure",
    "LagSeverity",
    "AlertRulesEngine",
    "Alert",
    "AlertRule",
    "AlertSeverity",
    "IndexerLagCriticalRule",
    "IndexerLagWarningRule",
    "DataSourceFailureRule",
    "IngestionFallBehindRule",
    "log_alert_handler",
    "telegram_alert_handler",
    "webhook_alert_handler",
    "IngestionLagMonitoringJob",
    "initialize_monitoring_job",
    "get_monitoring_job",
    "record_fetcher_failure",
]
