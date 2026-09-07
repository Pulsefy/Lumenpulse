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

import pytest
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
