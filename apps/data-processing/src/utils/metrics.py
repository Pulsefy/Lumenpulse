from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST
from prometheus_client import start_http_server

CONTRACT_INGESTION_LAG_SECONDS = Gauge(
    "lumenpulse_contract_ingestion_lag_seconds",
    "Seconds of lag between the latest on-chain event timestamp and the latest "
    "processed event timestamp for each contract domain",
    ["domain"],
)

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

ALERT_SUPPRESSIONS_TOTAL = Counter(
    "lumenpulse_alert_suppressions_total",
    "Total number of alerts suppressed by the dedup engine",
    ["rule_name", "reason"],
)

ALERT_EMISSIONS_TOTAL = Counter(
    "lumenpulse_alert_emissions_total",
    "Total number of alerts emitted by the dedup engine",
    ["rule_name", "reason"],
)

DATASET_FRESHNESS_SECONDS = Gauge(
    "lumenpulse_ingestion_dataset_freshness_seconds",
    "Current age in seconds of the latest ingested record for each dataset",
    ["dataset"],
)

DATASET_COMPLETENESS_RATIO = Gauge(
    "lumenpulse_ingestion_dataset_completeness_ratio",
    "Current completeness ratio for each ingested dataset, or -1 when unknown",
    ["dataset"],
)

DATASET_FRESHNESS_TARGET_SECONDS = Gauge(
    "lumenpulse_ingestion_dataset_freshness_target_seconds",
    "Freshness SLA target in seconds for each ingested dataset",
    ["dataset"],
)

DATASET_COMPLETENESS_TARGET_RATIO = Gauge(
    "lumenpulse_ingestion_dataset_completeness_target_ratio",
    "Completeness SLA target ratio for each ingested dataset",
    ["dataset"],
)

DATASET_SLA_BREACH = Gauge(
    "lumenpulse_ingestion_dataset_sla_breach",
    "1 when an ingested dataset is breaching freshness or completeness SLA",
    ["dataset", "sla_type", "severity"],
)

# Cache metrics for repeated inference analyses (#1251). Defined here so that
# every import style of cache_manager reuses the same registered collectors.
CACHE_OPERATIONS_TOTAL = Counter(
    "lumenpulse_cache_operations_total",
    "Total number of cache lookup operations by outcome",
    ["namespace", "outcome"],
)

CACHE_HIT_RATE = Gauge(
    "lumenpulse_cache_hit_rate",
    "Ratio of cache hits to total cache lookups, per namespace",
    ["namespace"],
)

# ── Feature-store schema versioning & drift (#1239) ─────────────────────────
FEATURE_DRIFT_PSI = Gauge(
    "lumenpulse_feature_drift_psi",
    "Population Stability Index between the training-time baseline and the "
    "current serving distribution, per feature",
    ["feature_set", "feature"],
)

FEATURE_DRIFT_ALERTS_TOTAL = Counter(
    "lumenpulse_feature_drift_alerts_total",
    "Total number of training-vs-serving feature drift alerts raised",
    ["feature_set", "reason"],  # reason: distribution | schema_version | schema_fingerprint
)

FEATURE_SCHEMA_MISMATCH_TOTAL = Counter(
    "lumenpulse_feature_schema_mismatch_total",
    "Total number of times serving detected a feature schema version mismatch "
    "against the version a model was trained on",
    ["feature_set"],
)


def start_metrics_server(port: int = 9090):
    """Start standalone prometheus metrics server (for background workers)"""
    try:
        start_http_server(port)
    except Exception as e:
        # Ignore if server is already running
        import logging
        logging.getLogger(__name__).warning("Metrics server could not start: %s", e)
