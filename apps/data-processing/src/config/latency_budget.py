"""
Inference latency budget configuration and metrics.

Every inference endpoint has documented latency targets expressed in
milliseconds at the 50th and 95th percentiles (see ``INFERENCE_LATENCY_BUDGET.md``).
The API middleware calls :func:`record_latency` after each request; observed
latency is exported as a histogram labelled by endpoint and model version.
Breaches raise an alert through ``src/alert_engine/`` and increment breach counters.

Targets can be tuned per endpoint through environment variables, e.g.
``ANALYZE_LATENCY_BUDGET_MS=500`` or ``ANALYZE_LATENCY_P95_MS=500``.
"""

import os
from typing import Any, Dict, Optional, Tuple

from prometheus_client import Counter, Histogram

INFERENCE_LATENCY_SECONDS = Histogram(
    "lumenpulse_inference_latency_seconds",
    "End-to-end request processing latency for API endpoints",
    ["endpoint", "method", "model_version"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0),
)

INFERENCE_LATENCY_BUDGET_BREACHES_TOTAL = Counter(
    "lumenpulse_inference_latency_budget_breaches_total",
    "Total number of requests that exceeded the configured latency budget",
    ["endpoint", "method", "model_version"],
)

# Default budget applied to endpoints without a specific entry.
DEFAULT_BUDGET_MS = int(os.getenv("LATENCY_BUDGET_MS", "1000"))

# Documented per-endpoint latency targets (p50, p95 in milliseconds).
# These mirror the table in INFERENCE_LATENCY_BUDGET.md.
# The p95 target serves as the maximum acceptable latency budget.
_ENDPOINT_TARGETS_MS: Dict[str, Tuple[int, int]] = {
    "/analyze": (150, 500),
    "/analyze-batch": (800, 2000),
    "/correlation/analyze": (350, 1000),
    "/correlation/lag-analysis": (400, 1000),
    "/analytics/forecast": (600, 2000),
    "/retrain": (5000, 30000),
    # Semantic news search (#1455). Excludes the fixed cost of vendored model
    # I/O (spaCy pipeline load happens once at import time); the budget applies
    # to the cosine ranking pass over the stored 300-dim article vectors.
    "/search/similar": (100, 300),
}

# Backward compatibility mapping: default budget is p95.
_ENDPOINT_DEFAULTS_MS: Dict[str, int] = {
    path: targets[1] for path, targets in _ENDPOINT_TARGETS_MS.items()
}

# Environment variable used to override each endpoint's default budget (p95).
_ENDPOINT_ENV_VARS: Dict[str, str] = {
    "/analyze": "ANALYZE_LATENCY_BUDGET_MS",
    "/analyze-batch": "ANALYZE_BATCH_LATENCY_BUDGET_MS",
    "/correlation/analyze": "CORRELATION_ANALYZE_LATENCY_BUDGET_MS",
    "/correlation/lag-analysis": "CORRELATION_LAG_LATENCY_BUDGET_MS",
    "/analytics/forecast": "FORECAST_LATENCY_BUDGET_MS",
    "/retrain": "RETRAIN_LATENCY_BUDGET_MS",
    "/search/similar": "SEARCH_SIMILAR_LATENCY_BUDGET_MS",
}

_ENDPOINT_P50_ENV_VARS: Dict[str, str] = {
    "/analyze": "ANALYZE_LATENCY_P50_MS",
    "/analyze-batch": "ANALYZE_BATCH_LATENCY_P50_MS",
    "/correlation/analyze": "CORRELATION_ANALYZE_LATENCY_P50_MS",
    "/correlation/lag-analysis": "CORRELATION_LAG_LATENCY_P50_MS",
    "/analytics/forecast": "FORECAST_LATENCY_P50_MS",
    "/retrain": "RETRAIN_LATENCY_P50_MS",
    "/search/similar": "SEARCH_SIMILAR_LATENCY_P50_MS",
}


def get_target_ms(path: str) -> Tuple[int, int]:
    """
    Return the (p50, p95) latency targets in milliseconds for ``path``.
    """
    defaults = _ENDPOINT_TARGETS_MS.get(path, (int(DEFAULT_BUDGET_MS * 0.5), DEFAULT_BUDGET_MS))
    p50_env = _ENDPOINT_P50_ENV_VARS.get(path)
    p50 = defaults[0]
    if p50_env:
        raw_p50 = os.getenv(p50_env)
        if raw_p50 and raw_p50.strip().isdigit():
            p50 = int(raw_p50.strip())

    p95 = get_budget_ms(path)
    return (p50, p95)


def get_budget_ms(path: str) -> int:
    """
    Return the effective latency budget (in milliseconds, p95) for ``path``.

    An endpoint-specific environment variable takes precedence, then the
    documented per-endpoint default, then the global ``LATENCY_BUDGET_MS``.
    """
    env_var = _ENDPOINT_ENV_VARS.get(path)
    if env_var:
        raw = os.getenv(env_var)
        if raw and raw.strip().isdigit():
            return int(raw.strip())
    return _ENDPOINT_DEFAULTS_MS.get(path, DEFAULT_BUDGET_MS)


def get_budgets() -> Dict[str, int]:
    """Return every documented endpoint and its effective budget (ms)."""
    return {path: get_budget_ms(path) for path in _ENDPOINT_DEFAULTS_MS}


def get_targets() -> Dict[str, Dict[str, int]]:
    """Return documented targets per endpoint at p50 and p95."""
    targets = {}
    for path in _ENDPOINT_TARGETS_MS:
        p50, p95 = get_target_ms(path)
        targets[path] = {"p50": p50, "p95": p95}
    return targets


_suppression_engine = None


def get_suppression_engine():
    global _suppression_engine
    if _suppression_engine is None:
        try:
            from src.alert_engine.engine import AlertSuppressionEngine

            _suppression_engine = AlertSuppressionEngine()
        except Exception:
            _suppression_engine = None
    return _suppression_engine


def reset_suppression_engine():
    global _suppression_engine
    _suppression_engine = None


def record_latency(
    path: str,
    method: str,
    duration_seconds: float,
    model_version: Optional[str] = None,
) -> bool:
    """
    Record request latency and flag breaches of the endpoint budget.

    Observes the Prometheus latency histogram labelled by endpoint, method,
    and model_version. Increments the breach counter and raises an alert through
    src/alert_engine/ when ``duration_seconds`` exceeds the configured budget.

    Args:
        path: Request path (e.g. ``/analyze``).
        method: HTTP method (e.g. ``POST``).
        duration_seconds: End-to-end request duration in seconds.
        model_version: Version of the active model, or "unknown".

    Returns:
        True when the request breached the latency budget, False otherwise.
    """
    version = model_version or "unknown"
    INFERENCE_LATENCY_SECONDS.labels(
        endpoint=path, method=method, model_version=version
    ).observe(duration_seconds)

    duration_ms = duration_seconds * 1000.0
    budget_ms = get_budget_ms(path)
    breached = duration_ms > budget_ms

    if breached:
        INFERENCE_LATENCY_BUDGET_BREACHES_TOTAL.labels(
            endpoint=path, method=method, model_version=version
        ).inc()

        engine = get_suppression_engine()
        if engine is not None:
            alert_payload: Dict[str, Any] = {
                "alert_type": "inference_latency_breach",
                "severity": "warning",
                "endpoint": path,
                "method": method,
                "model_version": version,
                "duration_ms": duration_ms,
                "budget_ms": budget_ms,
                "title": f"Latency budget breach: {method} {path}",
                "message": (
                    f"Request to {method} {path} took {duration_ms:.1f}ms, "
                    f"exceeding budget of {budget_ms}ms (model_version={version})"
                ),
            }
            try:
                engine.evaluate(alert_payload)
            except Exception:
                pass

    return breached
