"""
Tests for serving-side compute cost attribution (Issue #1643).

Covers the acceptance criteria:
* cost attributed per model version and per endpoint,
* cost per thousand inferences reported for each model,
* cost delta of a newly promoted model against its predecessor,
* export as Prometheus metrics alongside the #1454 stage profiling,
* the three most expensive serving paths.
"""

import json
import os

os.environ.setdefault(
    "API_KEYS", '[{"id":"test","value":"test-key-123","scopes":["default"]}]'
)

import pytest
from fastapi.testclient import TestClient
from prometheus_client import REGISTRY

import src.ml.serving_cost as serving_cost
from src.ml.serving_cost import (
    get_cost_per_1k,
    get_cost_report,
    get_hourly_rate_usd,
    get_top_serving_paths,
    record_inference,
    record_promotion,
)

_INFERENCES_METRIC = "lumenpulse_serving_inferences_total"
_COST_METRIC = "lumenpulse_serving_compute_cost_usd_total"
_PER_1K_METRIC = "lumenpulse_serving_model_cost_per_1k_inferences_usd"
_PROMOTION_DELTA_METRIC = "lumenpulse_serving_promotion_cost_delta_usd_per_1k"


@pytest.fixture(autouse=True)
def isolated_state():
    """Give every test a clean attribution state, restoring the previous one."""

    def snapshot():
        return (
            {k: dict(v) for k, v in serving_cost._usage.items()},
            {k: dict(v) for k, v in serving_cost._paths.items()},
            {k: dict(v) for k, v in serving_cost._last_promotion.items()},
            dict(serving_cost._promotion_deltas),
        )

    saved = snapshot()
    with serving_cost._state_lock:
        serving_cost._usage.clear()
        serving_cost._paths.clear()
        serving_cost._last_promotion.clear()
        serving_cost._promotion_deltas.clear()
    yield
    usage, paths, promotions, deltas = saved
    with serving_cost._state_lock:
        serving_cost._usage.clear()
        serving_cost._usage.update(usage)
        serving_cost._paths.clear()
        serving_cost._paths.update(paths)
        serving_cost._last_promotion.clear()
        serving_cost._last_promotion.update(promotions)
        serving_cost._promotion_deltas.clear()
        serving_cost._promotion_deltas.update(deltas)


def _counter(name: str, labels: dict) -> float:
    value = REGISTRY.get_sample_value(name, labels)
    return 0.0 if value is None else value


def _model_entry(report: dict, model_type: str, model_version: str) -> dict:
    for entry in report["models"]:
        if (
            entry["model_type"] == model_type
            and entry["model_version"] == model_version
        ):
            return entry
    raise AssertionError(
        f"No cost entry for {model_type}@{model_version} in {report['models']}"
    )


def _endpoint_entry(report: dict, endpoint: str) -> dict:
    for entry in report["endpoints"]:
        if entry["endpoint"] == endpoint:
            return entry
    raise AssertionError(f"No cost entry for {endpoint} in {report['endpoints']}")


# ---------------------------------------------------------------------------
# Attribution per model version and per endpoint
# ---------------------------------------------------------------------------


def test_cost_attributed_per_model_version_and_endpoint(monkeypatch):
    # 3600 USD/hour == 1 USD per second of compute, which keeps the arithmetic
    # in these assertions trivial.
    monkeypatch.setenv("SERVING_COST_PER_HOUR_USD", "3600")

    record_inference("sentiment", "/analyze", 0.5, model_version="v1.1")
    record_inference("sentiment", "/analyze", 0.25, model_version="v1.1")
    record_inference("sentiment", "/analyze-batch", 1.0, model_version="v1.1", count=10)
    record_inference("embedding", "/search/similar", 2.0, model_version="3.7.1")

    report = get_cost_report()

    sentiment = _model_entry(report, "sentiment", "v1.1")
    assert sentiment["inferences"] == 12
    assert sentiment["compute_cost_usd"] == pytest.approx(1.75)

    embedding = _model_entry(report, "embedding", "3.7.1")
    assert embedding["inferences"] == 1
    assert embedding["compute_cost_usd"] == pytest.approx(2.0)

    analyze = _endpoint_entry(report, "/analyze")
    assert analyze["inferences"] == 2
    assert analyze["compute_cost_usd"] == pytest.approx(0.75)

    batch = _endpoint_entry(report, "/analyze-batch")
    assert batch["inferences"] == 10
    assert batch["compute_cost_usd"] == pytest.approx(1.0)


def test_prometheus_counters_export_attribution(monkeypatch):
    monkeypatch.setenv("SERVING_COST_PER_HOUR_USD", "3600")
    labels = {"model_type": "sentiment", "model_version": "v9", "endpoint": "/analyze"}
    before_inf = _counter(_INFERENCES_METRIC, labels)
    before_cost = _counter(_COST_METRIC, labels)

    record_inference("sentiment", "/analyze", 0.5, model_version="v9")
    record_inference("sentiment", "/analyze", 0.5, model_version="v9")

    assert _counter(_INFERENCES_METRIC, labels) == before_inf + 2
    assert _counter(_COST_METRIC, labels) == pytest.approx(before_cost + 1.0)


# ---------------------------------------------------------------------------
# Cost per thousand inferences
# ---------------------------------------------------------------------------


def test_cost_per_1k_inferences_reported_per_model(monkeypatch):
    monkeypatch.setenv("SERVING_COST_PER_HOUR_USD", "3600")

    # 2 x 0.5s == 1.0 USD over 2 inferences -> 500 USD per thousand.
    record_inference("sentiment", "/analyze", 0.5, model_version="v1.0")
    record_inference("sentiment", "/analyze", 0.5, model_version="v1.0")

    report = get_cost_report()
    entry = _model_entry(report, "sentiment", "v1.0")
    assert entry["cost_per_1k_inferences_usd"] == pytest.approx(500.0)
    assert get_cost_per_1k("sentiment", "v1.0") == pytest.approx(500.0)

    sample = REGISTRY.get_sample_value(
        _PER_1K_METRIC,
        {"model_type": "sentiment", "model_version": "v1.0"},
    )
    assert sample == pytest.approx(500.0)


def test_cost_per_1k_is_none_without_traffic():
    assert get_cost_per_1k("sentiment", "v0.0") is None
    report = get_cost_report()
    entry = _model_entry(report, "sentiment", "v0.0") if report["models"] else None
    assert entry is None


# ---------------------------------------------------------------------------
# Rate configuration
# ---------------------------------------------------------------------------


def test_rate_resolution_precedence(monkeypatch):
    monkeypatch.setenv("SERVING_COST_PER_HOUR_USD", "1.0")
    monkeypatch.setenv("SERVING_COST_PER_HOUR_USD_SENTIMENT", "2.0")
    monkeypatch.setenv(
        "SERVING_COST_RATES_JSON",
        json.dumps({"sentiment@v1.2": 4.0, "embedding": 3.0}),
    )

    # Version-specific rate wins.
    assert get_hourly_rate_usd("sentiment", "v1.2") == 4.0
    # Model-type rate wins over the global default.
    assert get_hourly_rate_usd("sentiment", "v1.1") == 2.0
    # A bare model-type key in the JSON also works.
    assert get_hourly_rate_usd("embedding", "3.7.1") == 3.0
    # Global rate for everything else.
    assert get_hourly_rate_usd("forecast", "1.0.0") == 1.0


def test_invalid_rates_fall_back(monkeypatch):
    monkeypatch.setenv("SERVING_COST_RATES_JSON", "{not json")
    monkeypatch.setenv("SERVING_COST_PER_HOUR_USD_SENTIMENT", "not-a-number")
    monkeypatch.setenv("SERVING_COST_PER_HOUR_USD", "-5")

    assert (
        get_hourly_rate_usd("sentiment", "v1.0") == serving_cost.DEFAULT_HOURLY_RATE_USD
    )
    assert (
        get_hourly_rate_usd("forecast", "1.0.0") == serving_cost.DEFAULT_HOURLY_RATE_USD
    )


# ---------------------------------------------------------------------------
# Promotion cost delta
# ---------------------------------------------------------------------------


def test_promotion_cost_delta_against_predecessor(monkeypatch):
    monkeypatch.setenv("SERVING_COST_PER_HOUR_USD", "3600")

    # Predecessor: 1 inference of 1.0s -> 1000 per 1k.
    record_inference("sentiment", "/analyze", 1.0, model_version="v1.0")
    # Promoted: 2 inferences of 0.5s -> 500 per 1k (cheaper).
    record_inference("sentiment", "/analyze", 0.5, model_version="v1.1")
    record_inference("sentiment", "/analyze", 0.5, model_version="v1.1")

    delta = record_promotion("sentiment", "v1.0", "v1.1")
    assert delta == pytest.approx(-500.0)

    sample = REGISTRY.get_sample_value(
        _PROMOTION_DELTA_METRIC,
        {"model_type": "sentiment", "from_version": "v1.0", "to_version": "v1.1"},
    )
    assert sample == pytest.approx(-500.0)

    promotions = get_cost_report()["promotions"]
    entry = next(p for p in promotions if p["model_type"] == "sentiment")
    assert entry["from_version"] == "v1.0"
    assert entry["to_version"] == "v1.1"
    assert entry["predecessor_cost_per_1k_inferences_usd"] == pytest.approx(1000.0)
    assert entry["promoted_cost_per_1k_inferences_usd"] == pytest.approx(500.0)
    assert entry["cost_delta_per_1k_inferences_usd"] == pytest.approx(-500.0)


def test_promotion_delta_waits_for_traffic_then_refreshes(monkeypatch):
    monkeypatch.setenv("SERVING_COST_PER_HOUR_USD", "3600")

    # Nothing has served yet -> delta is not measurable.
    assert record_promotion("sentiment", "v1.0", "v1.1") is None

    # The predecessor's traffic establishes the baseline.
    record_inference("sentiment", "/analyze", 1.0, model_version="v1.0")
    assert serving_cost._promotion_deltas["sentiment"] is None

    # Once the promoted version serves, the delta becomes measurable.
    record_inference("sentiment", "/analyze", 0.25, model_version="v1.1")
    assert serving_cost._promotion_deltas["sentiment"] == pytest.approx(-750.0)

    sample = REGISTRY.get_sample_value(
        _PROMOTION_DELTA_METRIC,
        {"model_type": "sentiment", "from_version": "v1.0", "to_version": "v1.1"},
    )
    assert sample == pytest.approx(-750.0)


def test_first_promotion_without_predecessor_has_no_delta():
    assert record_promotion("sentiment", None, "v1.0") is None
    assert record_promotion("sentiment", "v1.0", "v1.0") is None
    assert "sentiment" not in serving_cost._last_promotion


class _FakeModel:
    """Picklable stand-in for a registry model (module level so pickle works)."""

    def predict(self, features):  # pragma: no cover - never scored here
        return features


def test_registry_promotion_records_cost_delta(monkeypatch, tmp_path):
    import src.ml.model_registry as registry

    monkeypatch.setenv("SERVING_COST_PER_HOUR_USD", "3600")
    monkeypatch.setattr(registry, "_MODELS_ROOT", tmp_path)

    predecessor = registry.save_model("promo", _FakeModel())
    registry.promote_model("promo", predecessor)
    promoted = registry.save_model("promo", _FakeModel())

    record_inference("promo", "/analyze", 1.0, model_version=predecessor)
    record_inference("promo", "/analyze", 0.5, model_version=promoted)
    record_inference("promo", "/analyze", 1.0, model_version=predecessor)

    assert registry.promote_model("promo", promoted) is True

    assert serving_cost._last_promotion["promo"] == {
        "from_version": predecessor,
        "to_version": promoted,
    }
    # predecessor: 2.0 USD / 2 inferences = 1000 per 1k
    # promoted:     0.5 USD / 1 inference  = 500 per 1k
    assert serving_cost._promotion_deltas["promo"] == pytest.approx(-500.0)
    sample = REGISTRY.get_sample_value(
        _PROMOTION_DELTA_METRIC,
        {"model_type": "promo", "from_version": predecessor, "to_version": promoted},
    )
    assert sample == pytest.approx(-500.0)


# ---------------------------------------------------------------------------
# Most expensive serving paths
# ---------------------------------------------------------------------------


def test_three_most_expensive_serving_paths(monkeypatch):
    monkeypatch.setenv("SERVING_COST_PER_HOUR_USD", "3600")

    for endpoint, seconds in (
        ("/analyze", 4.0),
        ("/search/similar", 3.0),
        ("/analytics/forecast", 2.0),
        ("/analyze-batch", 1.0),
    ):
        record_inference("sentiment", endpoint, seconds, model_version="v1.0")

    top = get_top_serving_paths()
    assert len(top) == 3
    assert [entry["endpoint"] for entry in top] == [
        "/analyze",
        "/search/similar",
        "/analytics/forecast",
    ]
    assert [entry["rank"] for entry in top] == [1, 2, 3]
    # Shares are relative to the full 10 USD of attributed cost.
    assert [entry["share_of_total_cost_pct"] for entry in top] == [40.0, 30.0, 20.0]

    report = get_cost_report()
    assert report["top_serving_paths"] == top


def test_top_serving_paths_empty_without_traffic():
    assert get_top_serving_paths() == []
    assert get_cost_report()["top_serving_paths"] == []


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------


def test_zero_count_records_nothing(monkeypatch):
    monkeypatch.setenv("SERVING_COST_PER_HOUR_USD", "3600")
    assert (
        record_inference("sentiment", "/analyze", 1.0, model_version="v1.0", count=0)
        == 0.0
    )
    assert serving_cost._usage == {}


def test_negative_duration_clamped_to_zero_cost(monkeypatch):
    monkeypatch.setenv("SERVING_COST_PER_HOUR_USD", "3600")
    cost = record_inference("sentiment", "/analyze", -1.0, model_version="v1.0")
    assert cost == 0.0
    assert serving_cost._usage[("sentiment", "v1.0", "/analyze")]["inferences"] == 1


def test_model_version_defaults_to_live_registry_pointer(monkeypatch, tmp_path):
    import src.ml.model_registry as registry

    monkeypatch.setenv("SERVING_COST_PER_HOUR_USD", "3600")
    monkeypatch.setattr(registry, "_MODELS_ROOT", tmp_path)
    monkeypatch.setattr(registry, "_live_versions", {})

    # No live pointer yet -> the attribution falls back to 'unknown'.
    record_inference("sentiment", "/analyze", 1.0)
    assert {key[1] for key in serving_cost._usage} == {serving_cost.UNKNOWN_VERSION}

    # Once the registry points at a live version, that version is attributed.
    registry._write_current_version("sentiment", "v7.7")
    record_inference("sentiment", "/analyze", 1.0)
    assert {key[1] for key in serving_cost._usage} == {
        serving_cost.UNKNOWN_VERSION,
        "v7.7",
    }


# ---------------------------------------------------------------------------
# HTTP interfaces: /model/cost-report and /metrics
# ---------------------------------------------------------------------------


def test_cost_report_endpoint_returns_full_report(monkeypatch):
    monkeypatch.setenv("SERVING_COST_PER_HOUR_USD", "3600")
    from src.api.server import app

    record_inference("sentiment", "/analyze", 1.0, model_version="v1.0")
    record_inference("sentiment", "/analyze", 0.5, model_version="v1.1")
    record_promotion("sentiment", "v1.0", "v1.1")

    client = TestClient(app)
    resp = client.get("/model/cost-report", headers={"X-API-Key": "test-key-123"})
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) >= {
        "generated_at",
        "models",
        "endpoints",
        "top_serving_paths",
        "promotions",
    }
    assert _model_entry(body, "sentiment", "v1.0")["compute_cost_usd"] == pytest.approx(
        1.0
    )
    assert len(body["top_serving_paths"]) <= 3
    assert body["promotions"][0]["cost_delta_per_1k_inferences_usd"] == pytest.approx(
        -500.0
    )


def test_cost_report_endpoint_requires_api_key():
    from src.api.server import app

    client = TestClient(app)
    resp = client.get("/model/cost-report")
    assert resp.status_code == 401


def test_cost_metrics_are_exposed_on_metrics_endpoint(monkeypatch):
    monkeypatch.setenv("SERVING_COST_PER_HOUR_USD", "3600")
    from src.api.server import app

    record_inference("sentiment", "/analyze", 1.0, model_version="v1.0")
    record_inference("sentiment", "/analyze", 1.0, model_version="v1.0")
    record_promotion("sentiment", "v0.9", "v1.0")

    client = TestClient(app)
    resp = client.get("/metrics", headers={"X-API-Key": "test-key-123"})
    assert resp.status_code == 200
    text = resp.text
    # Exported alongside the stage-level profiling from #1454 (same registry).
    assert "lumenpulse_serving_inferences_total" in text
    assert "lumenpulse_serving_compute_cost_usd_total" in text
    assert "lumenpulse_serving_cost_per_1k_inferences_usd" in text
    assert "lumenpulse_serving_path_cost_usd_total" in text


def test_report_is_json_serialisable():
    report = get_cost_report()
    assert json.loads(json.dumps(report)) == report
