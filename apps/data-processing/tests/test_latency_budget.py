"""
Unit tests for the per-endpoint inference latency budget (#1251).
"""

from prometheus_client import REGISTRY

from src.config.latency_budget import (
    DEFAULT_BUDGET_MS,
    get_budget_ms,
    get_budgets,
    record_latency,
)

_BREACH_METRIC_NAME = "lumenpulse_inference_latency_budget_breaches_total"


def _counter_value(endpoint: str, method: str) -> float:
    """Read the current breach counter value for a labelled series."""
    value = REGISTRY.get_sample_value(
        _BREACH_METRIC_NAME, {"endpoint": endpoint, "method": method}
    )
    return value if value is not None else 0.0


def test_documented_endpoint_budgets():
    budgets = get_budgets()
    assert budgets["/analyze"] == 500
    assert budgets["/analyze-batch"] == 2000
    assert budgets["/correlation/analyze"] == 1000
    assert budgets["/analytics/forecast"] == 2000
    assert budgets["/retrain"] == 30000


def test_unknown_endpoint_uses_global_fallback():
    assert get_budget_ms("/some/other/endpoint") == DEFAULT_BUDGET_MS


def test_env_override_takes_precedence(monkeypatch):
    monkeypatch.setenv("ANALYZE_LATENCY_BUDGET_MS", "250")
    assert get_budget_ms("/analyze") == 250
    # Other endpoints are unaffected.
    assert get_budget_ms("/analytics/forecast") == 2000


def test_invalid_env_override_falls_back_to_default(monkeypatch):
    monkeypatch.setenv("ANALYZE_LATENCY_BUDGET_MS", "not-a-number")
    assert get_budget_ms("/analyze") == 500


def test_record_latency_breaches_budget():
    before = _counter_value("/analyze", "POST")

    # 0.6s exceeds the 500ms /analyze budget -> breach.
    assert record_latency("/analyze", "POST", 0.6) is True
    # 0.1s is within budget.
    assert record_latency("/analyze", "POST", 0.1) is False

    after = _counter_value("/analyze", "POST")
    assert after == before + 1


def test_record_latency_exports_histogram():
    # Should not raise; the histogram sample is observable via /metrics.
    record_latency("/analyze", "POST", 0.05)
