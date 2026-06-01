"""
Ingestion Lag Monitoring Job

Scheduled job that:
1. Collects indexer lag metrics
2. Tracks data source failures
3. Evaluates alerting rules
4. Dispatches alerts

This job runs periodically and is integrated with the main scheduler.
"""

import logging
import os
from datetime import datetime, timezone
from typing import Optional, List

from src.metrics.indexer_lag import IndexerLagMonitor
from src.metrics.alerting_rules import AlertRulesEngine, log_alert_handler
from src.db.postgres_service import PostgresService

logger = logging.getLogger(__name__)
alert_logger = logging.getLogger("lumenpulse.alerts")


class IngestionLagMonitoringJob:
    """
    Main job for ingestion lag monitoring and alerting.

    Responsibilities:
    - Measure indexer lag from multiple sources
    - Track data source failures
    - Evaluate alerting rules
    - Dispatch alerts
    """

    def __init__(self, postgres_service: Optional[PostgresService] = None):
        """
        Initialize the monitoring job.

        Args:
            postgres_service: Database service for queries (optional for testing)
        """
        self.postgres = postgres_service or self._initialize_postgres()
        self.lag_monitor = IndexerLagMonitor(postgres_service=self.postgres)
        self.alert_engine = AlertRulesEngine()

        # Configure default alert handlers (log-based for MVP)
        self.alert_engine.add_handler(log_alert_handler)

        # Optionally add Telegram alerts
        self._setup_telegram_alerts()
        self._setup_webhook_alerts()

    def _initialize_postgres(self) -> PostgresService:
        """Initialize PostgreSQL service from environment."""
        database_url = os.getenv(
            "DATABASE_URL",
            "postgresql://postgres:postgres@localhost:5432/lumenpulse"
        )
        return PostgresService(database_url=database_url)

    def _setup_telegram_alerts(self):
        """Configure Telegram alert handler if credentials exist."""
        if os.getenv("TELEGRAM_BOT_TOKEN") and os.getenv("TELEGRAM_CHANNEL_ID"):
            from src.alertbot import AlertBot
            from src.metrics.alerting_rules import telegram_alert_handler

            alert_bot = AlertBot()

            def telegram_handler(alert):
                telegram_alert_handler(alert, telegram_notifier=alert_bot)

            self.alert_engine.add_handler(telegram_handler)
            logger.info("Telegram alert handler configured")

    def _setup_webhook_alerts(self):
        """Configure webhook alert handler if URLs exist."""
        webhook_urls = os.getenv("ALERT_WEBHOOK_URLS", "").split(",")
        webhook_urls = [url.strip() for url in webhook_urls if url.strip()]

        if webhook_urls:
            from src.metrics.alerting_rules import webhook_alert_handler

            def webhook_handler(alert):
                webhook_alert_handler(alert, webhook_urls=webhook_urls)

            self.alert_engine.add_handler(webhook_handler)
            logger.info(f"Webhook alert handler configured with {len(webhook_urls)} URLs")

    def run(self):
        """
        Execute the monitoring job.

        Collects metrics, evaluates rules, and dispatches alerts.
        """
        try:
            logger.info("=" * 60)
            logger.info("Starting Ingestion Lag Monitoring Job")
            logger.info(f"Timestamp: {datetime.now(timezone.utc).isoformat()}")

            # Step 1: Collect lag metrics
            logger.info("Step 1: Collecting lag metrics...")
            self._collect_metrics()

            # Step 2: Evaluate alerting rules
            logger.info("Step 2: Evaluating alerting rules...")
            self._evaluate_alerts()

            # Step 3: Generate summary report
            logger.info("Step 3: Generating summary report...")
            self._log_summary()

            logger.info("✓ Ingestion Lag Monitoring Job completed successfully")

        except Exception as e:
            logger.error(f"Ingestion Lag Monitoring Job failed: {e}", exc_info=True)
            alert_logger.error(f"Monitoring job failed: {e}")

    def _collect_metrics(self):
        """Collect all lag metrics."""
        try:
            # Measure Stellar ledger lag
            logger.debug("Measuring Stellar ledger lag...")
            self.lag_monitor.measure_stellar_ledger_lag()

            # Measure ingestion lag for key tables
            tables = [
                ("articles", "created_at"),
                ("social_posts", "created_at"),
                ("analytics_records", "timestamp"),
                ("contract_events", "created_at"),
            ]

            for table_name, timestamp_column in tables:
                try:
                    logger.debug(f"Measuring ingestion lag for {table_name}...")
                    self.lag_monitor.measure_ingestion_lag(table_name, timestamp_column)
                except Exception as e:
                    logger.warning(f"Could not measure lag for {table_name}: {e}")

        except Exception as e:
            logger.error(f"Error collecting metrics: {e}", exc_info=True)

    def _evaluate_alerts(self):
        """Evaluate alerting rules and dispatch alerts."""
        try:
            # Prepare metrics for evaluation
            metrics = {
                "stellar_ledger_lag": self.lag_monitor.metrics.get("stellar_ledger_lag"),
                "lag_metrics": self.lag_monitor.metrics,
                "recent_failures": self.lag_monitor.get_recent_failures(minutes=10),
                "failure_counts": self.lag_monitor.failure_counts,
            }

            # Evaluate all rules
            triggered_alerts = self.alert_engine.evaluate(metrics)

            if triggered_alerts:
                logger.warning(f"🚨 {len(triggered_alerts)} alert(s) triggered")
                for alert in triggered_alerts:
                    logger.warning(f"  - {alert.title}")
            else:
                logger.info("✓ No alerts triggered")

        except Exception as e:
            logger.error(f"Error evaluating alerts: {e}", exc_info=True)

    def _log_summary(self):
        """Log summary of monitoring results."""
        try:
            summary = self.lag_monitor.get_summary()

            logger.info("Monitoring Summary:")
            logger.info(f"  Total metrics: {summary['summary']['total_metrics']}")
            logger.info(f"  Critical: {summary['summary']['critical_count']}")
            logger.info(f"  Warning: {summary['summary']['warning_count']}")
            logger.info(f"  Healthy: {summary['summary']['healthy_count']}")
            logger.info(f"  Recent failures: {summary['summary']['recent_failures']}")

            # Log individual metrics
            for metric_name, metric_data in summary["metrics"].items():
                severity = metric_data["severity"]
                lag = metric_data["lag_seconds"]
                logger.info(f"  {metric_name}: {lag:.0f}s ({severity})")

            # Log failures if any
            if summary["recent_failures"]:
                logger.warning("Recent failures:")
                for failure in summary["recent_failures"][-5:]:  # Last 5
                    logger.warning(
                        f"  {failure['source_name']}: {failure['failure_type']} - {failure['error_message']}"
                    )

        except Exception as e:
            logger.error(f"Error generating summary: {e}", exc_info=True)

    def record_source_failure(self, source_name: str, failure_type: str, error_message: str):
        """
        Record a data source failure.

        Called from fetcher modules when errors occur.

        Args:
            source_name: Name of the failed source (e.g., 'news_fetcher', 'stellar_fetcher')
            failure_type: Type of failure (connection_error, timeout, auth_error, etc.)
            error_message: Error details
        """
        self.lag_monitor.record_source_failure(source_name, failure_type, error_message)

    def get_health_status(self) -> dict:
        """
        Get current health status for API or dashboard.

        Returns:
            Dictionary with health information
        """
        summary = self.lag_monitor.get_summary()
        critical_alerts = self.alert_engine.get_active_alerts()

        return {
            "status": "degraded" if summary["summary"]["critical_count"] > 0 else "healthy",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "metrics": summary["metrics"],
            "active_alerts": [a.to_dict() for a in critical_alerts],
        }


# Global instance (can be initialized by scheduler)
_monitoring_job: Optional[IngestionLagMonitoringJob] = None


def initialize_monitoring_job(postgres_service: Optional[PostgresService] = None) -> IngestionLagMonitoringJob:
    """
    Initialize the global monitoring job instance.

    Should be called once during application startup.
    """
    global _monitoring_job
    _monitoring_job = IngestionLagMonitoringJob(postgres_service=postgres_service)
    return _monitoring_job


def get_monitoring_job() -> Optional[IngestionLagMonitoringJob]:
    """Get the global monitoring job instance."""
    return _monitoring_job


def record_fetcher_failure(source_name: str, failure_type: str, error_message: str):
    """
    Record a data source failure from a fetcher module.

    Can be called from any fetcher to record errors.

    Args:
        source_name: Name of the failed source
        failure_type: Type of failure
        error_message: Error details
    """
    job = get_monitoring_job()
    if job:
        job.record_source_failure(source_name, failure_type, error_message)
    else:
        logger.warning(f"Monitoring job not initialized; failure not recorded for {source_name}")
