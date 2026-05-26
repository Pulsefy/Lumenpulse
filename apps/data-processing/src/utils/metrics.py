from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST
from prometheus_client import start_http_server

# Define simple Prometheus counters
JOBS_RUN_TOTAL = Counter(
    "jobs_run",
    "Total number of jobs run in the pipeline",
)

API_FAILURES_TOTAL = Counter(
    "api_failures",
    "Total number of API request failures",
    ["method", "endpoint"],
)

ANOMALIES_DETECTED_TOTAL = Counter(
    "anomalies_detected",
    "Total number of anomalies detected",
    ["metric_name"],
)

MODEL_RETRAINING_TOTAL = Counter(
    "model_retraining_total",
    "Total number of model retraining runs",
    ["model_type", "status"],  # status: success | failed | skipped
)

MODEL_RETRAINING_DURATION = Histogram(
    "model_retraining_duration_seconds",
    "Duration of model retraining runs in seconds",
    ["model_type"],
    buckets=[1, 5, 10, 30, 60, 120, 300, 600],
)

# Ingestion monitoring
# - ingestion_lag_seconds is the primary signal for "ingestion falls behind"
# - ingestion_quality_check_passed is 1/0 per check (set each run)
# - ingestion_quality_reports_total counts runs (and failures via exit_code)
INGESTION_LAG_SECONDS = Gauge(
    "ingestion_lag_seconds",
    "Ingestion lag in seconds (heuristic based on Horizon latest ledger closed_at freshness)",
    ["asset", "network"],
)

INGESTION_QUALITY_CHECK_PASSED = Gauge(
    "ingestion_quality_check_passed",
    "Whether an ingestion quality check passed (1) or failed (0)",
    ["check_id", "network", "asset"],
)

INGESTION_QUALITY_REPORTS_TOTAL = Counter(
    "ingestion_quality_reports_total",
    "Total number of ingestion quality check runs",
    ["network", "asset", "exit_code"],
)



def start_metrics_server(port: int = 9090):
    """Start standalone prometheus metrics server (for background workers)"""
    try:
        start_http_server(port)
    except Exception as e:
        # Ignore if server is already running
        import logging
        logging.getLogger(__name__).warning("Metrics server could not start: %s", e)
