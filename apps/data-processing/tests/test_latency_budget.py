"""
Unit tests for the per-endpoint inference latency budget (#1251) and latency targets.
"""

from unittest.mock import MagicMock, patch
from prometheus_client import REGISTRY

from src.config.latency_budget import (
    DEFAULT_BUDGET_MS,
    get_budget_ms,
    get_budgets,
    get_target_ms,
    get_targets,
    record_latency,
)

_BREACH_METRIC_NAME = "lumenpulse_inference_latency_budget_breaches_total"


def _counter_value(endpoint: str, method: str, model_version: str = "unknown") -> float:
    """Read the current breach counter value for a labelled series."""
    value = REGISTRY.get_sample_value(
        _BREACH_METRIC_NAME,
        {"endpoint": endpoint, "method": method, "model_version": model_version},
    )
    return value if value is not None else 0.0


def test_documented_endpoint_budgets():
    budgets = get_budgets()
    assert budgets["/analyze"] == 500
    assert budgets["/analyze-batch"] == 2000
    assert budgets["/correlation/analyze"] == 1000
    assert budgets["/correlation/lag-analysis"] == 1000
    assert budgets["/analytics/forecast"] == 2000
    assert budgets["/retrain"] == 30000
    assert budgets["/search/similar"] == 300  # semantic news search (#1455)


def test_documented_endpoint_targets_p50_and_p95():
    targets = get_targets()
    assert targets["/analyze"] == {"p50": 150, "p95": 500}
    assert targets["/analyze-batch"] == {"p50": 800, "p95": 2000}
    assert targets["/correlation/analyze"] == {"p50": 350, "p95": 1000}
    assert targets["/correlation/lag-analysis"] == {"p50": 400, "p95": 1000}
    assert targets["/analytics/forecast"] == {"p50": 600, "p95": 2000}
    assert targets["/retrain"] == {"p50": 5000, "p95": 30000}
    assert targets["/search/similar"] == {"p50": 100, "p95": 300}


def test_search_similar_env_override(monkeypatch):
    monkeypatch.setenv("SEARCH_SIMILAR_LATENCY_BUDGET_MS", "150")
    assert get_budget_ms("/search/similar") == 150
    # Other endpoints are unaffected.
    assert get_budget_ms("/analyze") == 500


def test_p50_env_override(monkeypatch):
    monkeypatch.setenv("ANALYZE_LATENCY_P50_MS", "80")
    p50, p95 = get_target_ms("/analyze")
    assert p50 == 80
    assert p95 == 500


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


def test_record_latency_breaches_budget_and_labels_model_version():
    before = _counter_value("/analyze", "POST", model_version="v1.0")

    # 0.6s exceeds the 500ms /analyze budget -> breach.
    assert record_latency("/analyze", "POST", 0.6, model_version="v1.0") is True
    # 0.1s is within budget.
    assert record_latency("/analyze", "POST", 0.1, model_version="v1.0") is False

    after = _counter_value("/analyze", "POST", model_version="v1.0")
    assert after == before + 1


def test_record_latency_exports_histogram():
    # Should not raise; the histogram sample is observable via /metrics.
    record_latency("/analyze", "POST", 0.05, model_version="v1.0")


def test_record_latency_raises_alert_through_alert_engine():
    mock_engine = MagicMock()
    with patch("src.config.latency_budget.get_suppression_engine", return_value=mock_engine):
        # 0.7s breaches the 500ms budget
        record_latency("/analyze", "POST", 0.7, model_version="v1.0")
        assert mock_engine.evaluate.called
        call_arg = mock_engine.evaluate.call_args[0][0]
        assert call_arg["alert_type"] == "inference_latency_breach"
        assert call_arg["endpoint"] == "/analyze"
        assert call_arg["method"] == "POST"
        assert call_arg["model_version"] == "v1.0"
        assert call_arg["budget_ms"] == 500
        assert call_arg["duration_ms"] == 700.0

