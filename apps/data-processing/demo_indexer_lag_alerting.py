"""
Demo: Indexer Lag Monitoring and Alerting

This script demonstrates how to:
1. Initialize the monitoring system
2. Collect lag metrics
3. Simulate failures
4. Trigger alerts
5. View results

Run: python demo_indexer_lag_alerting.py
"""

import logging
from datetime import datetime, timezone, timedelta
from src.metrics.indexer_lag import IndexerLagMonitor, LagSeverity
from src.metrics.alerting_rules import (
    AlertRulesEngine,
    AlertSeverity,
    log_alert_handler,
)

# Configure logging to see structured logs
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)
alert_logger = logging.getLogger("lumenpulse.alerts")


def demo_basic_monitoring():
    """Demo 1: Basic monitoring without failures."""
    print("\n" + "="*70)
    print("DEMO 1: Basic Monitoring (Healthy State)")
    print("="*70)

    monitor = IndexerLagMonitor()

    # Simulate a healthy Stellar ledger (recent)
    from unittest.mock import MagicMock

    mock_fetcher = MagicMock()
    mock_fetcher.get_network_stats.return_value = {
        "latest_ledger": 12345,
        "ledger_close_time": datetime.now(timezone.utc).isoformat(),
    }
    monitor.stellar_fetcher = mock_fetcher

    # Measure Stellar lag
    ledger_lag = monitor.measure_stellar_ledger_lag()

    if ledger_lag:
        print(f"\n✓ Stellar Ledger Lag: {ledger_lag.lag_seconds:.1f} seconds")
        print(f"  Severity: {ledger_lag.severity.value}")
        print(f"  Status: HEALTHY")


def demo_critical_lag():
    """Demo 2: Detect critical lag."""
    print("\n" + "="*70)
    print("DEMO 2: Critical Lag Detection")
    print("="*70)

    from src.metrics.ingestion_monitoring import IngestionLagMonitoringJob
    from src.metrics.alerting_rules import IndexerLagCriticalRule

    # Create job with mock postgres
    from unittest.mock import MagicMock

    mock_postgres = MagicMock()
    job = IngestionLagMonitoringJob(postgres_service=mock_postgres)

    # Simulate critical lag
    rule = IndexerLagCriticalRule(threshold_seconds=600)

    from src.metrics.indexer_lag import LagMetric

    critical_metric = LagMetric(
        metric_name="stellar_ledger_lag",
        lag_seconds=800,  # 13+ minutes - above 10min threshold
        threshold_warning_seconds=120,
        threshold_critical_seconds=600,
        last_update=datetime.now(timezone.utc),
        data_source="stellar",
        severity=LagSeverity.CRITICAL,
        details={
            "latest_ledger_sequence": 12345,
            "ledger_close_time": (datetime.now(timezone.utc) - timedelta(seconds=800)).isoformat(),
        },
    )

    metrics = {"stellar_ledger_lag": critical_metric}
    alert = rule.evaluate(metrics)

    if alert:
        print(f"\n🚨 ALERT TRIGGERED!")
        print(f"  Title: {alert.title}")
        print(f"  Severity: {alert.severity.value}")
        print(f"  Message: {alert.message}")
        print(f"  Rule: {alert.rule_name}")

        print(f"\n  Remediation Steps:")
        for i, step in enumerate(alert.remediation_steps, 1):
            print(f"    {i}. {step}")


def demo_data_source_failures():
    """Demo 3: Detect repeated data source failures."""
    print("\n" + "="*70)
    print("DEMO 3: Data Source Failure Detection")
    print("="*70)

    monitor = IndexerLagMonitor()

    # Simulate repeated failures
    print("\nRecording news fetcher failures...")
    for i in range(3):
        monitor.record_source_failure(
            "news_fetcher",
            "timeout",
            f"API request timed out (attempt {i+1})",
        )
        print(f"  ✗ Failure {i+1}: timeout")

    print(f"\nFailure Summary:")
    print(f"  Total failures in 5 min window: {monitor.get_failure_count('news_fetcher')}")
    print(f"  Consecutive failures: {monitor.get_consecutive_failures('news_fetcher')}")

    # Evaluate failure rule
    from src.metrics.alerting_rules import DataSourceFailureRule

    rule = DataSourceFailureRule(failure_threshold=3, time_window_minutes=5)

    metrics = {
        "recent_failures": monitor.failures,
        "failure_counts": monitor.failure_counts,
    }

    alert = rule.evaluate(metrics)

    if alert:
        print(f"\n⚠️ ALERT: Data Source Failure")
        print(f"  Title: {alert.title}")
        print(f"  Message: {alert.message}")


def demo_multiple_stale_sources():
    """Demo 4: Detect ingestion pipeline falling behind."""
    print("\n" + "="*70)
    print("DEMO 4: Ingestion Pipeline Falling Behind")
    print("="*70)

    from src.metrics.indexer_lag import LagMetric
    from src.metrics.alerting_rules import IngestionFallBehindRule

    # Create stale metrics for multiple sources
    old_time = datetime.now(timezone.utc) - timedelta(hours=2)

    article_lag = LagMetric(
        metric_name="articles_ingestion_lag",
        lag_seconds=7200,  # 2 hours
        threshold_warning_seconds=3600,
        threshold_critical_seconds=7200,
        last_update=datetime.now(timezone.utc),
        data_source="articles",
        severity=LagSeverity.CRITICAL,
        details={"latest_record_timestamp": old_time.isoformat()},
    )

    social_lag = LagMetric(
        metric_name="social_posts_ingestion_lag",
        lag_seconds=7200,  # 2 hours
        threshold_warning_seconds=1800,
        threshold_critical_seconds=3600,
        last_update=datetime.now(timezone.utc),
        data_source="social_posts",
        severity=LagSeverity.CRITICAL,
        details={"latest_record_timestamp": old_time.isoformat()},
    )

    print(f"\n📊 Detected Stale Sources:")
    print(f"  articles: 2 hours behind (CRITICAL)")
    print(f"  social_posts: 2 hours behind (CRITICAL)")

    # Evaluate rule
    rule = IngestionFallBehindRule(stale_data_threshold_seconds=3600)

    metrics = {
        "lag_metrics": {
            "articles_ingestion_lag": article_lag,
            "social_posts_ingestion_lag": social_lag,
        },
    }

    alert = rule.evaluate(metrics)

    if alert:
        print(f"\n🚨 ALERT: Ingestion Pipeline Critical")
        print(f"  Title: {alert.title}")
        print(f"  Message: {alert.message}")
        print(f"  Stale Sources: {', '.join(s['source'] for s in alert.metric_data['stale_sources'])}")


def demo_alert_rules_engine():
    """Demo 5: Full alert rules engine evaluation."""
    print("\n" + "="*70)
    print("DEMO 5: Alert Rules Engine")
    print("="*70)

    engine = AlertRulesEngine()

    # Add log handler to see alerts
    engine.add_handler(log_alert_handler)

    print(f"\nInitialized with {len(engine.rules)} alert rules:")
    for rule in engine.rules:
        print(f"  - {rule.rule_name}: {rule.description}")

    # Create a scenario with multiple alerts
    from src.metrics.indexer_lag import LagMetric

    now = datetime.now(timezone.utc)

    # Critical ledger lag
    ledger_metric = LagMetric(
        metric_name="stellar_ledger_lag",
        lag_seconds=700,
        threshold_warning_seconds=120,
        threshold_critical_seconds=600,
        last_update=now,
        data_source="stellar",
        severity=LagSeverity.CRITICAL,
        details={"latest_ledger_sequence": 12345},
    )

    metrics = {
        "stellar_ledger_lag": ledger_metric,
        "lag_metrics": {"stellar_ledger_lag": ledger_metric},
        "recent_failures": [],
        "failure_counts": {},
    }

    print(f"\nEvaluating alert rules...")
    alerts = engine.evaluate(metrics)

    print(f"\n✓ Evaluation Complete")
    print(f"  Triggered Alerts: {len(alerts)}")
    for alert in alerts:
        print(f"    - {alert.title} ({alert.severity.value})")


def demo_monitoring_job():
    """Demo 6: Full monitoring job."""
    print("\n" + "="*70)
    print("DEMO 6: Full Monitoring Job")
    print("="*70)

    try:
        from src.metrics.ingestion_monitoring import IngestionLagMonitoringJob

        print("\nInitializing monitoring job...")
        job = IngestionLagMonitoringJob()

        print("Monitoring job initialized successfully!")

        print("\nNote: In production, this job would:")
        print("  1. Measure Stellar ledger lag")
        print("  2. Check ingestion lag for all tables")
        print("  3. Evaluate alerting rules")
        print("  4. Dispatch alerts to log, Telegram, webhooks")
        print("  5. Generate health summary")

        print("\nTo run the actual job:")
        print("  job.run()")

    except Exception as e:
        print(f"Error initializing monitoring job: {e}")
        print("(This may be expected if database is not configured)")


def main():
    """Run all demos."""
    print("\n" + "="*70)
    print("INDEXER LAG & FAILED SOURCES ALERTING DEMO")
    print("="*70)

    demo_basic_monitoring()
    demo_critical_lag()
    demo_data_source_failures()
    demo_multiple_stale_sources()
    demo_alert_rules_engine()
    demo_monitoring_job()

    print("\n" + "="*70)
    print("DEMO COMPLETE")
    print("="*70)
    print("\nNext steps:")
    print("  1. Review ALERTING_RUNBOOK.md for complete documentation")
    print("  2. Configure environment variables (DATABASE_URL, etc.)")
    print("  3. Run tests: pytest tests/test_metrics_alerting.py -v")
    print("  4. Integrate into scheduler: src/scheduler.py")
    print("  5. Deploy to production\n")


if __name__ == "__main__":
    main()
