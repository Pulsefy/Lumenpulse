from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST
from prometheus_client import start_http_server

# Define simple Prometheus counters
JOBS_RUN_TOTAL = Counter(
    "jobs_run", 
    "Total number of jobs run in the pipeline"
)

API_FAILURES_TOTAL = Counter(
    "api_failures", 
    "Total number of API request failures",
    ["method", "endpoint"]
)

ANOMALIES_DETECTED_TOTAL = Counter(
    "anomalies_detected", 
    "Total number of anomalies detected",
    ["metric_name"]
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

INDEXER_LAG_SECONDS = Gauge(
    "lumenpulse_indexer_lag_seconds",
    "Seconds of lag between now and the latest indexed or ingested data",
    ["metric_name", "source"],
)

SOURCE_FAILURES_TOTAL = Counter(
    "lumenpulse_source_failures_total",
    "Total failures from external ingestion sources",
    ["source", "failure_type"],
)

SOURCE_HEALTH = Gauge(
    "lumenpulse_source_health",
    "1 when the source last fetch succeeded, 0 when unhealthy",
    ["source"],
)

def start_metrics_server(port: int = 9090):
    """Start standalone prometheus metrics server (for background workers)"""
    try:
        start_http_server(port)
    except Exception as e:
        # Ignore if server is already running
        import logging
        logging.getLogger(__name__).warning("Metrics server could not start: %s", e)
