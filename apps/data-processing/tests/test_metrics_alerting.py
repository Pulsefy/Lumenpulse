"""
Tests for Indexer Lag Monitoring and Alerting System

Tests the metrics collection, alert rule evaluation, and alert dispatch.
"""

import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import Mock, MagicMock, patch

from src.metrics.indexer_lag import (
    IndexerLagMonitor,
    LagMetric,
    SourceFailure,
    LagSeverity,
)
from src.metrics.alerting_rules import (
    AlertRulesEngine,
    Alert,
    AlertSeverity,
    IndexerLagCriticalRule,
    IndexerLagWarningRule,
    DataSourceFailureRule,
    IngestionFallBehindRule,
)
from src.metrics.ingestion_monitoring import IngestionLagMonitoringJob


class TestIndexerLagMonitor:
    """Test cases for IndexerLagMonitor."""

    def test_lag_metric_creation(self):
        """Test creating a lag metric."""
        now = datetime.now(timezone.utc)
        metric = LagMetric(
            metric_name="test_lag",
            lag_seconds=100.0,
            threshold_warning_seconds=60.0,
            threshold_critical_seconds=300.0,
            last_update=now,
            data_source="test",
            severity=LagSeverity.HEALTHY,
            details={"test": "data"},
        )

        assert metric.metric_name == "test_lag"
        assert metric.lag_seconds == 100.0
        assert metric.is_healthy
        assert not metric.is_warning
        assert not metric.is_critical

    def test_lag_severity_calculation(self):
        """Test severity calculation based on lag."""
        monitor = IndexerLagMonitor()

        # Healthy
        severity = monitor._calculate_severity(30, "test_metric")
        assert severity == LagSeverity.HEALTHY

        # Warning
        severity = monitor._calculate_severity(90, "test_metric")
        assert severity == LagSeverity.WARNING

        # Critical
        severity = monitor._calculate_severity(900, "test_metric")
        assert severity == LagSeverity.CRITICAL

    def test_source_failure_recording(self):
        """Test recording data source failures."""
        monitor = IndexerLagMonitor()

        monitor.record_source_failure("news_fetcher", "timeout", "Request timeout")
        monitor.record_source_failure("news_fetcher", "timeout", "Request timeout")
        monitor.record_source_failure("news_fetcher", "timeout", "Request timeout")

        assert len(monitor.failures) == 3
        assert monitor.get_failure_count("news_fetcher") == 3
        assert monitor.get_consecutive_failures("news_fetcher") == 3

    def test_failure_count_within_window(self):
        """Test failure count filtering by time window."""
        monitor = IndexerLagMonitor()

        # Add old failure
        old_failure = SourceFailure(
            source_name="test",
            failure_type="error",
            error_message="old",
            timestamp=datetime.now(timezone.utc) - timedelta(minutes=10),
        )
        monitor.failures.append(old_failure)

        # Add recent failures
        monitor.record_source_failure("test", "error", "recent1")
        monitor.record_source_failure("test", "error", "recent2")

        # Should count only recent failures (5 minute window)
        assert monitor.get_failure_count("test", window_minutes=5) == 2

    def test_error_metric_creation(self):
        """Test creating error metrics when data is unavailable."""
        monitor = IndexerLagMonitor()

        metric = monitor._create_error_metric("test", "source", {"error": "test"})

        assert metric.severity == LagSeverity.CRITICAL
        assert metric.lag_seconds == float("inf")

    def test_monitor_summary(self):
        """Test generating monitoring summary."""
        monitor = IndexerLagMonitor()

        # Add a metric
        now = datetime.now(timezone.utc)
        metric = LagMetric(
            metric_name="test",
            lag_seconds=100,
            threshold_warning_seconds=60,
            threshold_critical_seconds=300,
            last_update=now,
            data_source="test",
            severity=LagSeverity.WARNING,
            details={},
        )
        monitor.metrics["test"] = metric

        # Add a failure
        monitor.record_source_failure("test_source", "error", "test")

        summary = monitor.get_summary()

        assert summary["summary"]["total_metrics"] == 1
        assert summary["summary"]["warning_count"] == 1
        assert summary["summary"]["recent_failures"] == 1


class TestAlertRules:
    """Test cases for alert rules."""

    def test_indexer_lag_critical_rule(self):
        """Test critical lag alert rule."""
        rule = IndexerLagCriticalRule(threshold_seconds=600)

        # Below threshold - no alert
        metric = LagMetric(
            metric_name="stellar_ledger_lag",
            lag_seconds=100,
            threshold_warning_seconds=60,
            threshold_critical_seconds=600,
            last_update=datetime.now(timezone.utc),
            data_source="stellar",
            severity=LagSeverity.HEALTHY,
            details={"latest_ledger_sequence": 12345},
        )

        metrics = {"stellar_ledger_lag": metric}
        alert = rule.evaluate(metrics)
        assert alert is None

        # Above threshold - alert
        metric.lag_seconds = 700
        alert = rule.evaluate(metrics)
        assert alert is not None
        assert alert.severity == AlertSeverity.CRITICAL
        assert "CRITICAL: Indexer Lag" in alert.title

    def test_data_source_failure_rule(self):
        """Test data source failure alert rule."""
        rule = DataSourceFailureRule(failure_threshold=3, time_window_minutes=5)

        now = datetime.now(timezone.utc)

        # Single failure - no alert
        failure = SourceFailure(
            source_name="news_fetcher",
            failure_type="timeout",
            error_message="Timeout",
            timestamp=now,
        )

        metrics = {
            "recent_failures": [failure],
            "failure_counts": {"news_fetcher": 1},
        }

        alert = rule.evaluate(metrics)
        assert alert is None

        # Three failures - alert
        failures = [
            SourceFailure(
                source_name="news_fetcher",
                failure_type="timeout",
                error_message="Timeout",
                timestamp=now,
            )
            for _ in range(3)
        ]

        metrics = {
            "recent_failures": failures,
            "failure_counts": {"news_fetcher": 3},
        }

        alert = rule.evaluate(metrics)
        assert alert is not None
        assert alert.severity == AlertSeverity.WARNING
        assert "news_fetcher" in alert.title

    def test_ingestion_fall_behind_rule(self):
        """Test ingestion fall behind alert rule."""
        rule = IngestionFallBehindRule(stale_data_threshold_seconds=3600)

        now = datetime.now(timezone.utc)

        # Single stale source - no alert
        metric = LagMetric(
            metric_name="articles_ingestion_lag",
            lag_seconds=7200,
            threshold_warning_seconds=3600,
            threshold_critical_seconds=7200,
            last_update=now,
            data_source="articles",
            severity=LagSeverity.CRITICAL,
            details={},
        )

        metrics = {
            "lag_metrics": {"articles_ingestion_lag": metric},
        }

        alert = rule.evaluate(metrics)
        assert alert is None

        # Multiple stale sources - alert
        metric2 = LagMetric(
            metric_name="social_posts_ingestion_lag",
            lag_seconds=7200,
            threshold_warning_seconds=1800,
            threshold_critical_seconds=3600,
            last_update=now,
            data_source="social_posts",
            severity=LagSeverity.CRITICAL,
            details={},
        )

        metrics = {
            "lag_metrics": {
                "articles_ingestion_lag": metric,
                "social_posts_ingestion_lag": metric2,
            },
        }

        alert = rule.evaluate(metrics)
        assert alert is not None
        assert alert.severity == AlertSeverity.CRITICAL
        assert "Ingestion Pipeline" in alert.title


class TestAlertRulesEngine:
    """Test cases for alert rules engine."""

    def test_engine_initialization(self):
        """Test engine initializes with default rules."""
        engine = AlertRulesEngine()

        assert len(engine.rules) == 4  # Default 4 rules
        assert isinstance(engine.rules[0], IndexerLagCriticalRule)

    def test_engine_evaluate_triggers_rule(self):
        """Test engine triggers rules when conditions are met."""
        engine = AlertRulesEngine()

        now = datetime.now(timezone.utc)
        metric = LagMetric(
            metric_name="stellar_ledger_lag",
            lag_seconds=700,  # Above critical threshold
            threshold_warning_seconds=120,
            threshold_critical_seconds=600,
            last_update=now,
            data_source="stellar",
            severity=LagSeverity.CRITICAL,
            details={"latest_ledger_sequence": 12345},
        )

        metrics = {
            "stellar_ledger_lag": metric,
            "lag_metrics": {"stellar_ledger_lag": metric},
            "recent_failures": [],
            "failure_counts": {},
        }

        alerts = engine.evaluate(metrics)

        # Should trigger at least 1 rule (critical lag)
        assert len(alerts) > 0
        assert any(a.severity == AlertSeverity.CRITICAL for a in alerts)

    def test_engine_alert_handlers(self):
        """Test alert handlers are called."""
        engine = AlertRulesEngine()

        handler_called = False

        def test_handler(alert):
            nonlocal handler_called
            handler_called = True

        engine.add_handler(test_handler)

        now = datetime.now(timezone.utc)
        metric = LagMetric(
            metric_name="stellar_ledger_lag",
            lag_seconds=700,
            threshold_warning_seconds=120,
            threshold_critical_seconds=600,
            last_update=now,
            data_source="stellar",
            severity=LagSeverity.CRITICAL,
            details={},
        )

        metrics = {
            "stellar_ledger_lag": metric,
            "lag_metrics": {"stellar_ledger_lag": metric},
            "recent_failures": [],
            "failure_counts": {},
        }

        engine.evaluate(metrics)

        assert handler_called

    def test_engine_active_alerts_filtering(self):
        """Test filtering active alerts by severity."""
        engine = AlertRulesEngine()

        alert1 = Alert(
            alert_id="1",
            severity=AlertSeverity.CRITICAL,
            title="Critical",
            message="Critical alert",
            rule_name="test",
            source="test",
            timestamp=datetime.now(timezone.utc),
            metric_data={},
            remediation_steps=[],
        )

        alert2 = Alert(
            alert_id="2",
            severity=AlertSeverity.WARNING,
            title="Warning",
            message="Warning alert",
            rule_name="test",
            source="test",
            timestamp=datetime.now(timezone.utc),
            metric_data={},
            remediation_steps=[],
        )

        engine.active_alerts = [alert1, alert2]

        critical_alerts = engine.get_active_alerts(severity=AlertSeverity.CRITICAL)
        assert len(critical_alerts) == 1
        assert critical_alerts[0].severity == AlertSeverity.CRITICAL


class TestIngestionLagMonitoringJob:
    """Test cases for IngestionLagMonitoringJob."""

    @patch("src.metrics.ingestion_monitoring.PostgresService")
    def test_job_initialization(self, mock_postgres_class):
        """Test job initialization."""
        mock_postgres = MagicMock()
        job = IngestionLagMonitoringJob(postgres_service=mock_postgres)

        assert job.lag_monitor is not None
        assert job.alert_engine is not None
        assert len(job.alert_engine.alert_handlers) >= 1

    @patch("src.metrics.ingestion_monitoring.PostgresService")
    def test_job_run_succeeds(self, mock_postgres_class):
        """Test job runs successfully."""
        mock_postgres = MagicMock()
        mock_session = MagicMock()
        mock_postgres.get_session.return_value.__enter__.return_value = mock_session
        mock_postgres.get_session.return_value.__exit__.return_value = None

        # Mock database query results
        mock_session.execute.return_value.fetchone.return_value = [
            datetime.now(timezone.utc) - timedelta(minutes=1)
        ]

        job = IngestionLagMonitoringJob(postgres_service=mock_postgres)

        # Should not raise exception
        job.run()

    @patch("src.metrics.ingestion_monitoring.PostgresService")
    def test_record_source_failure(self, mock_postgres_class):
        """Test recording source failures."""
        job = IngestionLagMonitoringJob(postgres_service=MagicMock())

        job.record_source_failure("test_source", "timeout", "Connection timeout")

        assert len(job.lag_monitor.failures) == 1
        failure = job.lag_monitor.failures[0]
        assert failure.source_name == "test_source"
        assert failure.failure_type == "timeout"

    @patch("src.metrics.ingestion_monitoring.PostgresService")
    def test_health_status(self, mock_postgres_class):
        """Test getting health status."""
        job = IngestionLagMonitoringJob(postgres_service=MagicMock())

        status = job.get_health_status()

        assert "status" in status
        assert "timestamp" in status
        assert "metrics" in status
        assert "active_alerts" in status


# Test fixtures

@pytest.fixture
def mock_postgres_service():
    """Create mock PostgreSQL service."""
    service = MagicMock()
    session = MagicMock()
    service.get_session.return_value.__enter__.return_value = session
    service.get_session.return_value.__exit__.return_value = None
    return service


@pytest.fixture
def mock_stellar_fetcher():
    """Create mock Stellar fetcher."""
    fetcher = MagicMock()
    fetcher.get_network_stats.return_value = {
        "latest_ledger": 12345,
        "ledger_close_time": datetime.now(timezone.utc).isoformat(),
    }
    return fetcher


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
