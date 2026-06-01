"""
Indexer Lag Metrics Module

Tracks and measures ingestion lag and data freshness across multiple sources.
Provides metrics for:
- Ingestion lag (time since last successful ingestion)
- Ledger lag (how far behind the latest ledger we are)
- Data source staleness (news, social, Stellar)
- Pipeline health indicators

Output: Metrics are logged and can be exported for alerting.
"""

import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional, List
from dataclasses import dataclass, asdict
from enum import Enum

logger = logging.getLogger(__name__)


class LagSeverity(Enum):
    """Severity levels for lag conditions."""
    HEALTHY = "healthy"
    WARNING = "warning"
    CRITICAL = "critical"


@dataclass
class LagMetric:
    """Represents a single lag metric."""
    metric_name: str
    lag_seconds: float
    threshold_warning_seconds: float
    threshold_critical_seconds: float
    last_update: datetime
    data_source: str
    severity: LagSeverity
    details: Dict[str, Any]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "metric_name": self.metric_name,
            "lag_seconds": self.lag_seconds,
            "threshold_warning_seconds": self.threshold_warning_seconds,
            "threshold_critical_seconds": self.threshold_critical_seconds,
            "last_update": self.last_update.isoformat(),
            "data_source": self.data_source,
            "severity": self.severity.value,
            "details": self.details,
        }

    @property
    def is_healthy(self) -> bool:
        return self.severity == LagSeverity.HEALTHY

    @property
    def is_warning(self) -> bool:
        return self.severity == LagSeverity.WARNING

    @property
    def is_critical(self) -> bool:
        return self.severity == LagSeverity.CRITICAL


@dataclass
class SourceFailure:
    """Represents a data source failure."""
    source_name: str
    failure_type: str  # connection_error, timeout, auth_error, rate_limited, empty_response
    error_message: str
    timestamp: datetime
    retry_count: int = 0
    last_retry: Optional[datetime] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "source_name": self.source_name,
            "failure_type": self.failure_type,
            "error_message": self.error_message,
            "timestamp": self.timestamp.isoformat(),
            "retry_count": self.retry_count,
            "last_retry": self.last_retry.isoformat() if self.last_retry else None,
        }


class IndexerLagMonitor:
    """
    Monitors indexer lag and data source health.

    Tracks metrics for:
    - Stellar ledger ingestion lag
    - News article freshness
    - Social media post freshness
    - Asset price data freshness
    - Pipeline execution lag
    """

    # Default thresholds (in seconds)
    DEFAULT_THRESHOLDS = {
        "stellar_ledger_lag": {"warning": 60, "critical": 300},           # 1 min / 5 min
        "stellar_ingestion_lag": {"warning": 120, "critical": 600},       # 2 min / 10 min
        "news_article_lag": {"warning": 3600, "critical": 7200},          # 1 hour / 2 hours
        "social_post_lag": {"warning": 1800, "critical": 3600},           # 30 min / 1 hour
        "price_data_lag": {"warning": 300, "critical": 900},              # 5 min / 15 min
        "analytics_records_lag": {"warning": 600, "critical": 1800},      # 10 min / 30 min
        "pipeline_execution_lag": {"warning": 120, "critical": 600},      # 2 min / 10 min
    }

    def __init__(self, postgres_service=None, stellar_fetcher=None):
        """
        Initialize the lag monitor.

        Args:
            postgres_service: PostgreSQL service for database queries
            stellar_fetcher: StellarDataFetcher for blockchain data
        """
        self.postgres = postgres_service
        self.stellar_fetcher = stellar_fetcher
        self.metrics: Dict[str, LagMetric] = {}
        self.failures: List[SourceFailure] = []
        self.failure_counts: Dict[str, int] = {}
        self.last_check: Optional[datetime] = None

    def _calculate_severity(self, lag_seconds: float, metric_name: str) -> LagSeverity:
        """Determine severity based on lag and thresholds."""
        thresholds = self.DEFAULT_THRESHOLDS.get(
            metric_name,
            {"warning": 600, "critical": 1800}  # Default: 10 min / 30 min
        )

        if lag_seconds > thresholds["critical"]:
            return LagSeverity.CRITICAL
        elif lag_seconds > thresholds["warning"]:
            return LagSeverity.WARNING
        else:
            return LagSeverity.HEALTHY

    def measure_stellar_ledger_lag(self) -> Optional[LagMetric]:
        """
        Measure lag from Stellar ledger.

        Compares latest Horizon ledger close time to current time.
        """
        if not self.stellar_fetcher:
            logger.warning("stellar_fetcher not configured; skipping ledger lag measurement")
            return None

        try:
            stats = self.stellar_fetcher.get_network_stats() or {}
            closed_at_str = stats.get("ledger_close_time") or stats.get("closed_at")

            if not closed_at_str:
                logger.error("Could not retrieve ledger close time from Horizon")
                return self._create_error_metric(
                    "stellar_ledger_lag",
                    "stellar",
                    {"error": "No ledger close time from Horizon"}
                )

            # Parse ISO datetime
            if isinstance(closed_at_str, str):
                if closed_at_str.endswith("Z"):
                    closed_at = datetime.fromisoformat(closed_at_str.replace("Z", "+00:00"))
                else:
                    closed_at = datetime.fromisoformat(closed_at_str)
            else:
                closed_at = closed_at_str

            now = datetime.now(timezone.utc)
            lag_seconds = (now - closed_at).total_seconds()

            thresholds = self.DEFAULT_THRESHOLDS["stellar_ledger_lag"]
            severity = self._calculate_severity(lag_seconds, "stellar_ledger_lag")

            metric = LagMetric(
                metric_name="stellar_ledger_lag",
                lag_seconds=lag_seconds,
                threshold_warning_seconds=thresholds["warning"],
                threshold_critical_seconds=thresholds["critical"],
                last_update=now,
                data_source="stellar",
                severity=severity,
                details={
                    "latest_ledger_sequence": stats.get("latest_ledger"),
                    "ledger_close_time": closed_at.isoformat(),
                    "current_time": now.isoformat(),
                }
            )

            self.metrics["stellar_ledger_lag"] = metric
            return metric

        except Exception as e:
            logger.error(f"Error measuring stellar ledger lag: {e}")
            return self._create_error_metric(
                "stellar_ledger_lag",
                "stellar",
                {"error": str(e)}
            )

    def measure_ingestion_lag(self, table_name: str, timestamp_column: str) -> Optional[LagMetric]:
        """
        Measure lag for a specific table in the database.

        Args:
            table_name: Name of the table (articles, social_posts, analytics_records)
            timestamp_column: Name of the timestamp column (created_at, posted_at, timestamp)
        """
        if not self.postgres:
            logger.warning("postgres_service not configured; skipping ingestion lag measurement")
            return None

        try:
            with self.postgres.get_session() as session:
                from sqlalchemy import text, func

                # Get the latest timestamp from the table
                query = f"""
                    SELECT MAX({timestamp_column}) as latest_timestamp
                    FROM {table_name}
                    WHERE {timestamp_column} IS NOT NULL
                """
                result = session.execute(text(query)).fetchone()

                if not result or result[0] is None:
                    logger.warning(f"No records found in {table_name}")
                    return self._create_error_metric(
                        f"{table_name}_ingestion_lag",
                        table_name,
                        {"error": f"No records in {table_name}"}
                    )

                latest_timestamp = result[0]
                if hasattr(latest_timestamp, 'replace'):
                    # Ensure timezone-aware
                    if latest_timestamp.tzinfo is None:
                        latest_timestamp = latest_timestamp.replace(tzinfo=timezone.utc)
                else:
                    latest_timestamp = datetime.fromisoformat(str(latest_timestamp))

                now = datetime.now(timezone.utc)
                lag_seconds = (now - latest_timestamp).total_seconds()

                metric_name = f"{table_name}_ingestion_lag"
                thresholds = self.DEFAULT_THRESHOLDS.get(
                    metric_name,
                    {"warning": 600, "critical": 1800}
                )
                severity = self._calculate_severity(lag_seconds, metric_name)

                metric = LagMetric(
                    metric_name=metric_name,
                    lag_seconds=lag_seconds,
                    threshold_warning_seconds=thresholds["warning"],
                    threshold_critical_seconds=thresholds["critical"],
                    last_update=now,
                    data_source=table_name,
                    severity=severity,
                    details={
                        "latest_record_timestamp": latest_timestamp.isoformat(),
                        "current_time": now.isoformat(),
                    }
                )

                self.metrics[metric_name] = metric
                return metric

        except Exception as e:
            logger.error(f"Error measuring ingestion lag for {table_name}: {e}")
            return self._create_error_metric(
                f"{table_name}_ingestion_lag",
                table_name,
                {"error": str(e)}
            )

    def record_source_failure(
        self,
        source_name: str,
        failure_type: str,
        error_message: str
    ):
        """
        Record a data source failure.

        Args:
            source_name: Name of the failed source (e.g., 'news_fetcher', 'stellar_fetcher')
            failure_type: Type of failure (connection_error, timeout, auth_error, etc.)
            error_message: Error details
        """
        failure = SourceFailure(
            source_name=source_name,
            failure_type=failure_type,
            error_message=error_message,
            timestamp=datetime.now(timezone.utc)
        )

        self.failures.append(failure)
        self.failure_counts[source_name] = self.failure_counts.get(source_name, 0) + 1

        logger.error(
            f"Data source failure recorded: {source_name} - "
            f"Type: {failure_type}, Message: {error_message}"
        )

    def get_failure_count(self, source_name: str, window_minutes: int = 5) -> int:
        """
        Get failure count for a source within a time window.

        Args:
            source_name: Name of the source
            window_minutes: Time window in minutes

        Returns:
            Number of failures in the window
        """
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=window_minutes)
        count = sum(
            1 for f in self.failures
            if f.source_name == source_name and f.timestamp > cutoff
        )
        return count

    def get_consecutive_failures(self, source_name: str) -> int:
        """Get count of consecutive failures for a source."""
        return self.failure_counts.get(source_name, 0)

    def _create_error_metric(
        self,
        metric_name: str,
        data_source: str,
        details: Dict[str, Any]
    ) -> LagMetric:
        """Create a metric representing an error condition."""
        now = datetime.now(timezone.utc)
        thresholds = self.DEFAULT_THRESHOLDS.get(
            metric_name,
            {"warning": 600, "critical": 1800}
        )

        return LagMetric(
            metric_name=metric_name,
            lag_seconds=float('inf'),  # Unknown lag; treat as critical
            threshold_warning_seconds=thresholds["warning"],
            threshold_critical_seconds=thresholds["critical"],
            last_update=now,
            data_source=data_source,
            severity=LagSeverity.CRITICAL,
            details=details
        )

    def get_all_metrics(self) -> List[LagMetric]:
        """Return all currently collected metrics."""
        return list(self.metrics.values())

    def get_critical_metrics(self) -> List[LagMetric]:
        """Return only critical metrics."""
        return [m for m in self.metrics.values() if m.is_critical]

    def get_warning_metrics(self) -> List[LagMetric]:
        """Return metrics with warning severity."""
        return [m for m in self.metrics.values() if m.is_warning]

    def get_recent_failures(self, minutes: int = 10) -> List[SourceFailure]:
        """Get failures from the last N minutes."""
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=minutes)
        return [f for f in self.failures if f.timestamp > cutoff]

    def get_summary(self) -> Dict[str, Any]:
        """Get a summary of all metrics and failures."""
        now = datetime.now(timezone.utc)
        self.last_check = now

        critical_metrics = self.get_critical_metrics()
        warning_metrics = self.get_warning_metrics()
        recent_failures = self.get_recent_failures(minutes=10)

        return {
            "timestamp": now.isoformat(),
            "summary": {
                "total_metrics": len(self.metrics),
                "critical_count": len(critical_metrics),
                "warning_count": len(warning_metrics),
                "healthy_count": len(self.metrics) - len(critical_metrics) - len(warning_metrics),
                "recent_failures": len(recent_failures),
                "total_sources_with_failures": len(self.failure_counts),
            },
            "metrics": {m.metric_name: m.to_dict() for m in self.metrics.values()},
            "recent_failures": [f.to_dict() for f in recent_failures],
            "failure_counts": self.failure_counts,
        }
