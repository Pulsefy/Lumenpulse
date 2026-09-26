# -*- coding: utf-8 -*-
"""
Job scheduler module - schedules and manages background jobs
"""

import os
from typing import Any, Dict, List, Optional
from src.utils.logger import setup_logger
from src.utils.metrics import JOBS_RUN_TOTAL
from src.utils.profiler import profile_stage
from datetime import datetime
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger
from apscheduler.job import Job

from fetchers import NewsFetcher
from sentiment import SentimentAnalyzer
from trends import TrendCalculator
from database import DatabaseService, AnalyticsRecord
from anomaly_detector import AnomalyDetector, AnomalyResult
from alertbot import AlertBot
from src.ml.retraining_pipeline import run_retraining, get_last_run_status
from src.ingestion.run_ingestion_quality_checks import main as run_ingestion_quality_checks
from src.analytics.project_verification_trend import (
    ProjectVerificationTrendAnalyzer,
    VerificationRecord,
)
from src.db.postgres_service import PostgresService
from src.ingestion.rpc_benchmark import RPCProviderBenchmark
from src.round_analyzer import _round_analyzer_job
from src.metadata_drift_detector import MetadataDriftDetector
from src.kpi_reconciliation import KPIReconciler



logger = setup_logger(__name__)

_STAGE_RUN_STATE: Dict[str, Dict[str, Any]] = {}
_GLOBAL_SCHEDULER: Optional["AnalyticsScheduler"] = None


def set_global_scheduler(scheduler: "AnalyticsScheduler") -> None:
    """Register the live scheduler instance for API inspection."""
    global _GLOBAL_SCHEDULER
    _GLOBAL_SCHEDULER = scheduler


def get_global_scheduler() -> Optional["AnalyticsScheduler"]:
    """Return the currently registered scheduler instance, if any."""
    return _GLOBAL_SCHEDULER


def _record_stage_run(stage_id: str, func):
    """Wrap a scheduled function so stage execution state is captured."""

    def wrapped(*args, **kwargs):
        started_at = datetime.utcnow()
        _STAGE_RUN_STATE[stage_id] = {
            "last_run": started_at.isoformat(),
            "duration_seconds": None,
            "outcome": "running",
            "error": None,
        }
        try:
            with profile_stage(stage_id):
                result = func(*args, **kwargs)
            duration = (datetime.utcnow() - started_at).total_seconds()
            _STAGE_RUN_STATE[stage_id] = {
                "last_run": started_at.isoformat(),
                "duration_seconds": round(duration, 3),
                "outcome": "success",
                "error": None,
            }
            return result
        except Exception as exc:  # pragma: no cover - scheduler-level failure tracking
            duration = (datetime.utcnow() - started_at).total_seconds()
            _STAGE_RUN_STATE[stage_id] = {
                "last_run": started_at.isoformat(),
                "duration_seconds": round(duration, 3),
                "outcome": "failed",
                "error": str(exc),
            }
            raise

    return wrapped


class MarketAnalyzer:
    """Main job that orchestrates the entire analysis pipeline"""

    def __init__(self):
        self.fetcher = NewsFetcher()
        self.sentiment_analyzer = SentimentAnalyzer()
        self.trend_calculator = TrendCalculator()
        self.db_service = DatabaseService()
        self.anomaly_detector = AnomalyDetector(window_size_hours=24, z_threshold=2.5)
        self.alert_bot = AlertBot()

    def run(self):
        """
        Execute the full analysis pipeline:
        1. Fetch News
        2. Analyze Sentiment
        3. Calculate Trend
        4. Save to DB
        """
        try:
            logger.info("=" * 60)
            logger.info("Starting MarketAnalyzer job")
            logger.info(f"Timestamp: {datetime.utcnow().isoformat()}")

            # Step 1: Fetch News
            logger.info("Step 1: Fetching news...")
            news_items = self.fetcher.fetch_all_news()

            if not news_items:
                logger.warning("No news items fetched")
                return

            # Step 2: Analyze Sentiment
            logger.info(
                f"Step 2: Analyzing sentiment for {len(news_items)} articles..."
            )
            news_texts = [f"{item.title} {item.content}" for item in news_items]
            sentiment_results = self.sentiment_analyzer.analyze_batch(news_texts)
            sentiment_summary = self.sentiment_analyzer.get_sentiment_summary(
                sentiment_results
            )

            # Step 3: Calculate Trends
            logger.info("Step 3: Calculating trends...")
            trends = self.trend_calculator.calculate_all_trends(sentiment_summary)
            trends_dict = [trend.to_dict() for trend in trends]

            # Step 4: Detect Anomalies
            logger.info("Step 4: Detecting market anomalies...")

            # Get volume data (mock for demo - in real implementation, fetch actual volume)
            current_volume = 1000.0  # This would come from Stellar fetcher
            current_sentiment = sentiment_summary.get("average_compound_score", 0)

            # Detect anomalies
            anomalies = self.anomaly_detector.detect_anomalies(
                volume=current_volume, sentiment_score=current_sentiment
            )

            # Log anomaly results
            anomaly_alerts = []
            for anomaly in anomalies:
                if anomaly.is_anomaly:
                    logger.warning(
                        f"🚨 ANOMALY DETECTED: {anomaly.metric_name} "
                        f"(Severity: {anomaly.severity_score:.2f}, "
                        f"Z-Score: {anomaly.z_score:.2f})"
                    )
                    anomaly_alerts.append(anomaly.to_dict())
                else:
                    logger.debug(
                        f"Normal {anomaly.metric_name} behavior "
                        f"(Z-Score: {anomaly.z_score:.2f})"
                    )

            # Step 5: Save to Database
            logger.info("Step 5: Saving analytics to database...")

            # Enhance record with anomaly data
            enhanced_sentiment_data = sentiment_summary.copy()
            enhanced_sentiment_data["anomalies_detected"] = len(
                [a for a in anomalies if a.is_anomaly]
            )
            enhanced_sentiment_data["anomaly_details"] = [
                a.to_dict() for a in anomalies
            ]

            # Step 5.5: Check for high sentiment alerts
            # Determine trend direction from calculated trends
            trend_direction = "Unknown"
            if trends:
                primary_trend = trends[0]
                trend_direction = getattr(primary_trend, "trend_direction", "Unknown")

            alert_sentiment_data = enhanced_sentiment_data.copy()
            alert_sentiment_data["trend_direction"] = trend_direction
            alert_sentiment_data["total_analyzed"] = len(news_items)

            self.alert_bot.check_and_alert(
                analyzer_score=current_sentiment,
                sentiment_data=alert_sentiment_data,
                timestamp=datetime.utcnow(),
            )

            record = AnalyticsRecord(
                timestamp=datetime.utcnow(),
                news_count=len(news_items),
                sentiment_data=enhanced_sentiment_data,
                trends=trends_dict,
            )

            success = self.db_service.save_analytics(record)

            if success:
                logger.info("✓ Analytics job completed successfully")
                logger.info(f"  - News items: {len(news_items)}")
                logger.info(
                    f"  - Average sentiment: {sentiment_summary.get('average_compound_score', 0):.4f}"
                )
                logger.info(
                    f"  - Positive: {sentiment_summary.get('sentiment_distribution', {}).get('positive', 0):.1%}"
                )
                logger.info(
                    f"  - Negative: {sentiment_summary.get('sentiment_distribution', {}).get('negative', 0):.1%}"
                )
                logger.info(f"  - Anomalies detected: {len(anomaly_alerts)}")
                JOBS_RUN_TOTAL.inc()
            else:
                logger.error("✗ Failed to save analytics to database")

            logger.info("=" * 60)
        except Exception as e:
            logger.error(f"Error in MarketAnalyzer job: {e}", exc_info=True)


def _retraining_job() -> None:
    """
    Scheduled retraining job wrapper.
    Runs the full retraining pipeline and logs the outcome.
    Errors are caught so a failed retrain never crashes the scheduler.
    """
    logger.info("Scheduled model retraining job triggered")
    try:
        result = run_retraining()
        if result.get("status") == "completed":
            logger.info(
                f"Scheduled retraining completed in "
                f"{result.get('duration_seconds', 0):.1f}s — "
                f"models: {list(result.get('models', {}).keys())}"
            )
        else:
            logger.warning(f"Scheduled retraining ended with status: {result.get('status')}")
    except Exception as exc:
        logger.error(f"Scheduled retraining job raised an exception: {exc}", exc_info=True)


def _ingestion_quality_checks_job() -> None:
    """Run Stellar testnet ingestion quality checks.

    Scheduled wrapper. Errors are caught so the scheduler keeps running.
    """
    try:
        run_ingestion_quality_checks(argv=None)
    except SystemExit:
        pass
    except Exception as exc:
        logger.error(f"Scheduled ingestion quality checks raised an exception: {exc}", exc_info=True)


def _prediction_logs_cleanup_job() -> None:
    """Clean up old prediction logs to enforce retention policy."""
    logger.info("Scheduled prediction logs cleanup job triggered")
    try:
        retention_days = int(os.getenv("PREDICTION_LOG_RETENTION_DAYS", "30"))
        db = PostgresService()
        deleted = db.cleanup_prediction_logs(retention_days=retention_days)
        logger.info(f"Cleaned up {deleted} old prediction logs.")
    except Exception as exc:
        logger.error(f"Scheduled prediction logs cleanup raised an exception: {exc}", exc_info=True)


def _ingestion_alerting_job() -> None:
    """Evaluate indexer lag metrics and emit log-based alerts (#745)."""
    try:
        from src.ingestion.ingestion_alerting import run_ingestion_alerting_cycle

        result = run_ingestion_alerting_cycle()
        suppressed = result.get("suppressed_alerts", [])
        engine_stats = result.get("suppression_engine_stats", {})
        logger.info(
            "Ingestion alerting cycle complete | healthy=%s | metrics=%d | "
            "lag_alerts=%d | suppressed=%d | rules=%d",
            result.get("healthy"),
            len(result.get("metrics", [])),
            len(result.get("lag_alerts", [])),
            len(suppressed),
            len(engine_stats.get("rules", [])),
        )
        if suppressed:
            logger.info(
                "ALERT_SUPPRESSION suppressed=%d aler-types=%s",
                len(suppressed),
                [s.get("alert_type") for s in suppressed[:5]],
            )
    except Exception as exc:
        logger.error("Ingestion alerting job failed: %s", exc, exc_info=True)


def _project_verification_trend_job() -> None:
    """Scheduled wrapper for ProjectVerificationTrendAnalyzer (#885).

    Runs analysis over any buffered verification records and logs the result.
    Errors are caught so the scheduler keeps running.
    """
    try:
        analyzer = ProjectVerificationTrendAnalyzer()
        result = analyzer.analyze()
        logger.info(
            "Project verification trend: direction=%s approval=%.1f%% total=%d",
            result.trend_direction,
            result.approval_rate * 100,
            result.total,
        )
    except Exception as exc:
        logger.error("Project verification trend job failed: %s", exc, exc_info=True)


def _rpc_provider_benchmark_job() -> None:
    """Scheduled wrapper for RPCProviderBenchmark (#884).

    Probes all configured Stellar RPC/Horizon providers and logs the winner.
    Errors are caught so the scheduler keeps running.
    """
    try:
        bench = RPCProviderBenchmark()
        report = bench.run()
        logger.info("RPC benchmark best provider: %s", report.best_provider)
    except Exception as exc:
        logger.error("RPC provider benchmark job failed: %s", exc, exc_info=True)

def _contributor_reputation_snapshot_job() -> None:
    """Scheduled wrapper for building contributor reputation snapshots.

    Builds top-N contributor snapshots for all known projects and persists
    them for downstream leaderboards and reputation queries.
    """
    try:
        service = PostgresService()
        saved_count = service.build_all_project_contributor_reputation_snapshots(
            top_n=int(os.getenv("REPUTATION_SNAPSHOT_TOP_N", "100")),
        )
        logger.info(
            "Contributor reputation snapshot job completed: %d snapshots persisted",
            saved_count,
        )
    except Exception as exc:
        logger.error(
            f"Contributor reputation snapshot job failed: {exc}",
            exc_info=True,
        )


def _metadata_drift_detector_job() -> None:
    """Scheduled wrapper for MetadataDriftDetector (#882).

    Recomputes chain-derived project/milestone state from the ContractEvent
    log and diffs it against ProjectView/ProjectMilestone. Read-only with
    respect to source data — findings are persisted separately for review.
    Errors are caught so the scheduler keeps running.
    """
    try:
        detector = MetadataDriftDetector()
        report = detector.run_and_persist(
            limit=int(os.getenv("METADATA_DRIFT_PROJECT_LIMIT", "500"))
        )
        logger.info(
            "Metadata drift detection: projects_checked=%d projects_with_drift=%d findings=%d",
            report.projects_checked,
            report.projects_with_drift,
            len(report.findings),
        )
    except Exception as exc:
        logger.error(f"Metadata drift detector job failed: {exc}", exc_info=True)


def _feature_drift_detection_job() -> None:
    """Scheduled wrapper for FeatureDriftDetector (#1239).

    Compares the current serving feature distribution against the training-time
    baseline recorded with the live price-predictor model and raises an alert
    through the existing alerting path when any feature drifts beyond the
    configured PSI threshold (or the feature schema version/fingerprint no
    longer matches). Read-only; errors are caught so the scheduler keeps running.
    """
    try:
        from src.ml.feature_drift_detector import FeatureDriftDetector

        detector = FeatureDriftDetector()
        report = detector.detect()
        logger.info(
            "Feature drift detection: status=%s drifted=%s schema_mismatch=%s alerted=%s",
            report.status,
            report.drifted_features,
            report.schema_mismatch,
            report.alerted,
        )
    except Exception as exc:
        logger.error(f"Feature drift detector job failed: {exc}", exc_info=True)


def _kpi_reconciliation_job() -> None:
    """Scheduled wrapper for KPIReconciler (#1054).

    Compares off-chain ProjectView KPIs against on-chain contract state via
    direct Soroban RPC queries. Safe for rate limits.
    """
    try:
        reconciler = KPIReconciler()
        reconciler.run_reconciliation(
            limit=int(os.getenv("KPI_RECONCILIATION_PROJECT_LIMIT", "10")),
            rate_limit_sleep=float(os.getenv("KPI_RECONCILIATION_RATE_LIMIT_SLEEP", "0.2")),
        )
    except Exception as exc:
        logger.error(f"KPI reconciliation job failed: {exc}", exc_info=True)


def _daily_onchain_kpi_snapshot_job() -> None:
    """Scheduled wrapper for DailyKPISnapshotGenerator (#877).

    Persists daily snapshots of core on-chain KPIs (TVL, volume, active rounds,
    contribution counts) to enable fast, consistent trend analysis and prevent duplicate entries.
    """
    try:
        from src.analytics.daily_kpi_snapshot import DailyKPISnapshotGenerator

        generator = DailyKPISnapshotGenerator()
        result = generator.run_snapshot()
        logger.info(
            "Daily on-chain KPI snapshot job complete | status=%s | date=%s | tvl=%.2f | volume=%.2f | active_rounds=%d | contributions=%d",
            result.get("status"),
            result.get("date"),
            result.get("tvl", 0.0),
            result.get("volume", 0.0),
            result.get("active_rounds", 0),
            result.get("contribution_count", 0),
        )
    except Exception as exc:
        logger.error(f"Daily on-chain KPI snapshot job failed: {exc}", exc_info=True)


def _contract_lag_metrics_job() -> None:
    """Scheduled wrapper for per-contract ingestion lag metrics.

    Measures lag for registry, vault, matching_pool, treasury, and vesting
    domains, publishes values to Prometheus, and emits structured log alerts
    when thresholds are exceeded.
    """
    try:
        from src.ingestion.contract_lag_metrics import run_contract_lag_cycle

        result = run_contract_lag_cycle()
        logger.info(
            "Contract lag cycle complete | healthy=%s | snapshots=%d | lag_alerts=%d",
            result.get("healthy"),
            len(result.get("snapshots", [])),
            len(result.get("lag_alerts", [])),
        )
    except Exception as exc:
        logger.error("Contract lag metrics job failed: %s", exc, exc_info=True)


class AnalyticsScheduler:

    """Manages the APScheduler scheduler for analytics jobs"""

    def __init__(self, pipeline_fn=None):
        self.scheduler = BackgroundScheduler()
        self.analyzer = MarketAnalyzer()
        # Allow injecting a custom pipeline function (used by main.py)
        self._pipeline_fn = pipeline_fn
        set_global_scheduler(self)

    def _get_stage_definitions(self) -> List[Dict[str, Any]]:
        """Return the canonical scheduler topology config used to register jobs."""
        run_fn = self._pipeline_fn if self._pipeline_fn else self.analyzer.run
        alerting_interval = int(os.getenv("INGESTION_ALERT_INTERVAL_MINUTES", "5"))
        feature_drift_interval = int(os.getenv("FEATURE_DRIFT_INTERVAL_HOURS", "6"))
        contract_lag_interval = int(os.getenv("CONTRACT_LAG_INTERVAL_MINUTES", "5"))

        return [
            {
                "id": "market_analyzer_hourly",
                "name": "Market Analyzer - Hourly Analytics",
                "func": run_fn,
                "schedule": "every 1 hour",
                "dependencies": [],
                "trigger": IntervalTrigger(hours=1),
            },
            {
                "id": "stellar_ingestion_quality_checks_hourly",
                "name": "Stellar Ingestion Quality Checks - Hourly",
                "func": _ingestion_quality_checks_job,
                "schedule": "every 1 hour",
                "dependencies": ["market_analyzer_hourly"],
                "trigger": IntervalTrigger(hours=1),
            },
            {
                "id": "ingestion_lag_alerting",
                "name": "Indexer Lag and Source Failure Alerting",
                "func": _ingestion_alerting_job,
                "schedule": f"every {alerting_interval} minutes",
                "dependencies": ["stellar_ingestion_quality_checks_hourly"],
                "trigger": IntervalTrigger(minutes=alerting_interval),
            },
            {
                "id": "model_retraining_daily",
                "name": "Automated Model Retraining - Daily",
                "func": _retraining_job,
                "schedule": "cron: 02:00 UTC",
                "dependencies": ["market_analyzer_hourly", "feature_drift_detection", "kpi_reconciliation"],
                "trigger": CronTrigger(hour=2, minute=0, timezone="UTC"),
            },
            {
                "id": "project_verification_trend",
                "name": "Project Verification Trend Analyzer",
                "func": _project_verification_trend_job,
                "schedule": "every 6 hours",
                "dependencies": ["market_analyzer_hourly"],
                "trigger": IntervalTrigger(hours=6),
            },
            {
                "id": "rpc_provider_benchmark",
                "name": "RPC Provider Benchmark",
                "func": _rpc_provider_benchmark_job,
                "schedule": "every 30 minutes",
                "dependencies": [],
                "trigger": IntervalTrigger(minutes=30),
            },
            {
                "id": "round_anomaly_detection",
                "name": "Round Anomaly Detection",
                "func": _round_analyzer_job,
                "schedule": "every 6 hours",
                "dependencies": ["market_analyzer_hourly"],
                "trigger": IntervalTrigger(hours=6),
            },
            {
                "id": "contributor_reputation_snapshot_daily",
                "name": "Contributor Reputation Snapshot Builder",
                "func": _contributor_reputation_snapshot_job,
                "schedule": "cron: 03:30 UTC",
                "dependencies": ["market_analyzer_hourly"],
                "trigger": CronTrigger(hour=3, minute=30, timezone="UTC"),
            },
            {
                "id": "metadata_drift_detection",
                "name": "Metadata Drift Detector (backend vs on-chain)",
                "func": _metadata_drift_detector_job,
                "schedule": "every 6 hours",
                "dependencies": ["market_analyzer_hourly"],
                "trigger": IntervalTrigger(hours=6),
            },
            {
                "id": "feature_drift_detection",
                "name": "Training-vs-Serving Feature Drift Detection",
                "func": _feature_drift_detection_job,
                "schedule": f"every {feature_drift_interval} hours",
                "dependencies": ["market_analyzer_hourly"],
                "trigger": IntervalTrigger(hours=feature_drift_interval),
            },
            {
                "id": "kpi_reconciliation",
                "name": "KPI Reconciler against Live Contract Reads",
                "func": _kpi_reconciliation_job,
                "schedule": "every 6 hours",
                "dependencies": ["market_analyzer_hourly"],
                "trigger": IntervalTrigger(hours=6),
            },
            {
                "id": "daily_onchain_kpi_snapshot",
                "name": "Daily On-Chain KPI Snapshot Scheduler",
                "func": _daily_onchain_kpi_snapshot_job,
                "schedule": "cron: 00:05 UTC",
                "dependencies": ["kpi_reconciliation"],
                "trigger": CronTrigger(hour=0, minute=5, timezone="UTC"),
            },
            {
                "id": "contract_ingestion_lag_metrics",
                "name": "Per-Contract Ingestion Lag Metrics",
                "func": _contract_lag_metrics_job,
                "schedule": f"every {contract_lag_interval} minutes",
                "dependencies": ["stellar_ingestion_quality_checks_hourly"],
                "trigger": IntervalTrigger(minutes=contract_lag_interval),
            },
            {
                "id": "prediction_logs_cleanup",
                "name": "Prediction Logs Cleanup Scheduler",
                "func": _prediction_logs_cleanup_job,
                "schedule": "cron: 02:00 UTC",
                "dependencies": ["model_retraining_daily"],
                "trigger": CronTrigger(hour=2, minute=0, timezone="UTC"),
            },
        ]

    def start(self):
        """Start the scheduler with all registered jobs."""
        try:
            stage_definitions = self._get_stage_definitions()
            added_jobs = {}
            for stage in stage_definitions:
                wrapped_fn = _record_stage_run(stage["id"], stage["func"])
                job = self.scheduler.add_job(
                    func=wrapped_fn,
                    trigger=stage["trigger"],
                    id=stage["id"],
                    name=stage["name"],
                    replace_existing=True,
                )
                added_jobs[stage["id"]] = job

            self.scheduler.start()
            logger.info("✓ Analytics scheduler started")
            logger.info(f"  - Job: {added_jobs['market_analyzer_hourly'].name} | Next: {added_jobs['market_analyzer_hourly'].next_run_time}")
            logger.info(f"  - Job: {added_jobs['model_retraining_daily'].name} | Next: {added_jobs['model_retraining_daily'].next_run_time}")
        except Exception as e:
            logger.error(f"Error starting scheduler: {e}")
            raise

    def run_immediately(self):
        """Run the analyzer job immediately (useful for testing)"""
        logger.info("Running MarketAnalyzer immediately...")
        if self._pipeline_fn:
            self._pipeline_fn()
        else:
            self.analyzer.run()

    def trigger_retraining(self, force: bool = False) -> dict:
        """Manually trigger a retraining run (e.g. from the API)."""
        logger.info(f"Manual retraining triggered (force={force})")
        return run_retraining(force=force)

    def stop(self):
        """Stop the scheduler"""
        try:
            self.scheduler.shutdown(wait=True)
            logger.info("✓ Analytics scheduler stopped")
        except Exception as e:
            logger.error(f"Error stopping scheduler: {e}")

    def get_pipeline_topology(self) -> List[Dict[str, Any]]:
        """Return the scheduler-derived stage topology with runtime metadata."""
        stage_definitions = self._get_stage_definitions()
        job_lookup = {job.id: job for job in self.scheduler.get_jobs()}
        topology: List[Dict[str, Any]] = []

        for stage in stage_definitions:
            job = job_lookup.get(stage["id"])
            run_state = _STAGE_RUN_STATE.get(stage["id"], {})
            last_run = run_state.get("last_run")
            duration_seconds = run_state.get("duration_seconds")
            outcome = run_state.get("outcome", "not_run")
            error = run_state.get("error")

            if job and getattr(job, "last_run_time", None) is not None and last_run is None:
                last_run = job.last_run_time.isoformat()

            topology.append(
                {
                    "id": stage["id"],
                    "name": stage["name"],
                    "dependencies": stage["dependencies"],
                    "schedule": stage["schedule"],
                    "last_run": last_run,
                    "duration_seconds": duration_seconds,
                    "outcome": outcome,
                    "error": error,
                }
            )

        return topology

    def get_jobs(self) -> list:
        """Get list of scheduled jobs"""
        return self.scheduler.get_jobs()

    def get_job_status(self, job_id: str) -> dict:
        """Get status of a specific job"""
        job = self.scheduler.get_job(job_id)
        if job:
            return {
                "id": job.id,
                "name": job.name,
                "next_run_time": str(job.next_run_time),
                "trigger": str(job.trigger),
            }
        return None

    def get_retraining_status(self) -> dict:
        """Return the last retraining run metadata."""
        return get_last_run_status()
