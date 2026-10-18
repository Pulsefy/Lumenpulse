"""
Tests for GET /api/lineage and GET /api/lineage/{feature_id} (issue #1254).

Route-level tests go through the full app (matches the convention used by
test_daily_kpi_snapshot.py / test_shadow_model_deployment.py); pure logic
for the graph engine itself is covered without the app in
test_lineage_graph.py.

The app's global security middleware (src/security.py) requires an
X-API-Key header on every route except a small health/docs allowlist —
lineage isn't special-cased out of that, so tests authenticate the same
way test_analyze_batch_backpressure.py does.
"""

import os

os.environ.setdefault("API_KEYS", '[{"id":"test","value":"test-key-123","scopes":["default"]}]')

from fastapi.testclient import TestClient

from src.api.server import app

client = TestClient(app)
_AUTH_HEADERS = {"X-API-Key": "test-key-123"}


def test_list_lineage_entries():
    resp = client.get("/api/lineage", headers=_AUTH_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] == len(body["entries"])
    ids = {e["id"] for e in body["entries"]}
    assert "market_health_score" in ids
    assert "price_predictor_features" in ids


def test_get_lineage_for_known_kpi():
    resp = client.get("/api/lineage/market_health_score", headers=_AUTH_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["feature_id"] == "market_health_score"
    assert body["node"]["id"] == "market_health_score"
    assert body["node"]["kind"] == "kpi_dataset"
    assert body["node"]["owner"]
    assert body["node"]["owning_module"] == "data-processing"

    upstream_ids = {n["id"] for n in body["upstream"]}
    assert "price_predictor_features" in upstream_ids
    assert "sentiment_compound" in upstream_ids
    for node in body["upstream"]:
        assert node["distance"] >= 1


def test_get_lineage_for_known_ml_feature_set():
    resp = client.get("/api/lineage/price_predictor_features", headers=_AUTH_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["node"]["kind"] == "ml_feature_set"
    assert "asset_sentiment_view" in body["node"]["source_system"]


def test_get_lineage_404_for_unknown_id():
    resp = client.get("/api/lineage/this_id_does_not_exist", headers=_AUTH_HEADERS)
    assert resp.status_code == 404
    assert "this_id_does_not_exist" in resp.json()["detail"]


def test_get_lineage_requires_api_key():
    resp = client.get("/api/lineage/market_health_score")
    assert resp.status_code == 401


def test_pipeline_dataset_registry_endpoint():
    resp = client.get("/api/pipeline/datasets", headers=_AUTH_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] == len(body["datasets"])

    by_id = {dataset["id"]: dataset for dataset in body["datasets"]}
    assert {
        "news_articles",
        "price_ticks",
        "social_posts",
        "stellar_ledger_events",
        "contract_events",
        "analytics_records",
        "price_predictor_features",
        "sentiment_model_features",
        "market_health_score",
        "sentiment_compound",
        "cohort_metrics",
        "attribution_score",
        "round_anomaly_signals",
        "project_verification_trend",
        "correlation_result",
        "market_forecast",
        "anomaly_detection_result",
    }.issubset(by_id)
    price_ticks = by_id["price_ticks"]
    assert price_ticks["owner"]
    assert price_ticks["schema"]
    assert price_ticks["update_cadence"]
    assert price_ticks["retention"]
    assert "price_predictor" in price_ticks["model_consumers"]
    assert "model_retraining_daily" in price_ticks["pipeline_stages"]


def test_pipeline_topology_response_does_not_change():
    resp = client.get("/api/pipeline/topology", headers=_AUTH_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["stages"]
    assert "dataset_ids" not in body["stages"][0]
