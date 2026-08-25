"""
Inference latency budget configuration and metrics.

Every inference endpoint has a documented latency budget expressed in
milliseconds (see ``INFERENCE_LATENCY_BUDGET.md``). The API middleware calls
:func:`record_latency` after each request; requests that exceed the budget are
counted as breaches and exported through Prometheus so they can be alerted on.

Budgets can be tuned per endpoint through environment variables, e.g.
``ANALYZE_LATENCY_BUDGET_MS=250`` for ``POST /analyze``.
"""

import os
from typing import Dict

from prometheus_client import Counter, Histogram

INFERENCE_LATENCY_SECONDS = Histogram(
    "lumenpulse_inference_latency_seconds",
    "End-to-end request processing latency for API endpoints",
    ["endpoint", "method"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0),
)

INFERENCE_LATENCY_BUDGET_BREACHES_TOTAL = Counter(
    "lumenpulse_inference_latency_budget_breaches_total",
    "Total number of requests that exceeded the configured latency budget",
    ["endpoint", "method"],
)

# Default budget applied to endpoints without a specific entry.
DEFAULT_BUDGET_MS = int(os.getenv("LATENCY_BUDGET_MS", "1000"))

# Documented per-endpoint latency budgets (milliseconds). These mirror the
# table in INFERENCE_LATENCY_BUDGET.md and are the defaults used when the
# corresponding environment variable is not set.
_ENDPOINT_DEFAULTS_MS: Dict[str, int] = {
    "/analyze": 500,
    "/analyze-batch": 2000,
    "/correlation/analyze": 1000,
    "/correlation/lag-analysis": 1000,
    "/analytics/forecast": 2000,
    "/retrain": 30000,
}

# Environment variable used to override each endpoint's default budget.
_ENDPOINT_ENV_VARS: Dict[str, str] = {
    "/analyze": "ANALYZE_LATENCY_BUDGET_MS",
    "/analyze-batch": "ANALYZE_BATCH_LATENCY_BUDGET_MS",
    "/correlation/analyze": "CORRELATION_ANALYZE_LATENCY_BUDGET_MS",
    "/correlation/lag-analysis": "CORRELATION_LAG_LATENCY_BUDGET_MS",
    "/analytics/forecast": "FORECAST_LATENCY_BUDGET_MS",
    "/retrain": "RETRAIN_LATENCY_BUDGET_MS",
}


def get_budget_ms(path: str) -> int:
    """
    Return the effective latency budget (in milliseconds) for ``path``.

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


def record_latency(path: str, method: str, duration_seconds: float) -> bool:
    """
    Record request latency and flag breaches of the endpoint budget.

    Observes the Prometheus latency histogram and increments the breach
    counter when ``duration_seconds`` exceeds the configured budget.

    Args:
        path: Request path (e.g. ``/analyze``).
        method: HTTP method (e.g. ``POST``).
        duration_seconds: End-to-end request duration in seconds.

    Returns:
        True when the request breached the latency budget, False otherwise.
    """
    INFERENCE_LATENCY_SECONDS.labels(endpoint=path, method=method).observe(
        duration_seconds
    )
    breached = (duration_seconds * 1000.0) > get_budget_ms(path)
    if breached:
        INFERENCE_LATENCY_BUDGET_BREACHES_TOTAL.labels(
            endpoint=path, method=method
        ).inc()
    return breached
