"""
Unit tests for shadow-mode model deployment (Issue #1256).

Tests cover:
  - Shadow model registration, promotion, and unregistration
  - Shadow prediction with timeout enforcement
  - Comparison logging and report generation
  - API endpoint behaviour

Notes:
  - Uses the same ``src.ml.*`` module objects the API server imports, so
    fixture state (MODEL_REGISTRY_PATH, in-memory registry) is shared with
    the TestClient endpoints.
"""

import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

import pytest

# Ensure src is on sys.path so the same module objects the API server
# uses (src.ml.*) are importable by name.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from src.ml import model_registry as _mr  # noqa: E402
from src.ml.model_registry import (  # noqa: E402
    ComparisonEntry,
    _comparison_log_path,
    clear_comparison_log,
    flush_all_comparisons,
    generate_comparison_report,
    get_all_shadow_status,
    get_current_version,
    get_live_model,
    get_registry_status,
    get_shadow_model,
    get_shadow_status,
    get_shadow_version,
    log_comparison,
    promote_model,
    promote_shadow,
    read_comparison_log,
    register_shadow,
    save_model,
    unregister_shadow,
)
from src.ml.shadow_predictor import (  # noqa: E402
    ShadowPredictor,
    create_shadow_predictor,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class _FakeModel:
    def __init__(self, factor: float = 1.0):
        self.factor = factor

    def __call__(self, x):
        if isinstance(x, (int, float)):
            return x * self.factor
        raise ValueError("Expected numeric input")


class _SlowModel:
    def __init__(self, delay_sec: float = 10.0):
        self.delay_sec = delay_sec

    def __call__(self, x):
        time.sleep(self.delay_sec)
        return x * 2.0


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def temp_registry(monkeypatch):
    """Create a temporary model registry directory and reset in-memory state."""
    tmp = tempfile.mkdtemp()
    monkeypatch.setenv("MODEL_REGISTRY_PATH", tmp)
    # Override module-level constant so the new path takes effect
    monkeypatch.setattr(_mr, "_MODELS_ROOT", Path(tmp))

    _mr._live_models.clear()
    _mr._live_versions.clear()
    _mr._shadow_models.clear()
    _mr._shadow_versions.clear()
    _mr._comparison_buffer.clear()

    yield Path(tmp)

    shutil.rmtree(tmp, ignore_errors=True)
    _mr._live_models.clear()
    _mr._live_versions.clear()
    _mr._shadow_models.clear()
    _mr._shadow_versions.clear()
    _mr._comparison_buffer.clear()


@pytest.fixture
def saved_model(temp_registry):
    """Register and promote a live model so shadow tests operate on it."""
    v1 = save_model("test_type", _FakeModel(1.0), version="v1.0")
    promote_model("test_type", v1)
    save_model("test_type", _FakeModel(2.0), version="v2.0")
    return temp_registry


# ---------------------------------------------------------------------------
# Model registry shadow-mode tests
# ---------------------------------------------------------------------------


class TestShadowRegistry:
    def test_register_shadow_persists(self, saved_model):
        register_shadow("test_type", "v2.0")
        assert get_shadow_version("test_type") == "v2.0"
        shadow_model = get_shadow_model("test_type")
        assert shadow_model is not None
        assert shadow_model(5) == 10.0  # factor 2.0

    def test_register_shadow_missing_version_raises(self, saved_model):
        with pytest.raises(FileNotFoundError, match="v99.0"):
            register_shadow("test_type", "v99.0")

    def test_unregister_shadow_clears(self, saved_model):
        register_shadow("test_type", "v2.0")
        unregister_shadow("test_type")
        assert get_shadow_version("test_type") is None
        assert get_shadow_model("test_type") is None

    def test_unregister_shadow_noop_when_none(self, saved_model):
        unregister_shadow("test_type")  # Should not raise

    def test_promote_shadow_makes_live(self, saved_model):
        register_shadow("test_type", "v2.0")
        promote_shadow("test_type")
        assert get_current_version("test_type") == "v2.0"
        assert get_shadow_version("test_type") is None

    def test_promote_shadow_noop_when_no_shadow(self, saved_model):
        promote_shadow("test_type")  # should not raise
        # Live version unchanged
        assert get_current_version("test_type") == "v1.0"

    def test_get_shadow_status(self, saved_model):
        register_shadow("test_type", "v2.0")
        status = get_shadow_status("test_type")
        assert status is not None
        assert status["shadow_version"] == "v2.0"
        assert status["live_version"] == "v1.0"
        assert status["shadow_loaded"] is True

    def test_get_shadow_status_none(self, saved_model):
        assert get_shadow_status("test_type") is None

    def test_get_all_shadow_status(self, saved_model):
        register_shadow("test_type", "v2.0")
        all_status = get_all_shadow_status()
        assert "test_type" in all_status
        assert all_status["test_type"]["shadow_version"] == "v2.0"

    def test_registry_status_includes_shadow(self, saved_model):
        register_shadow("test_type", "v2.0")
        status = get_registry_status()
        assert "test_type" in status
        assert status["test_type"]["shadow"] is not None
        assert status["test_type"]["shadow"]["shadow_version"] == "v2.0"


# ---------------------------------------------------------------------------
# Shadow predictor tests
# ---------------------------------------------------------------------------


class TestShadowPredictor:
    def test_predict_returns_live_only(self, saved_model):
        register_shadow("test_type", "v2.0")
        live = get_live_model("test_type")
        shadow = get_shadow_model("test_type")

        predictor = ShadowPredictor(live, shadow, "test_type")
        result = predictor.predict(5)
        assert result == 5.0  # live: 5 * 1.0

    def test_predict_logs_comparison(self, saved_model):
        register_shadow("test_type", "v2.0")
        live = get_live_model("test_type")
        shadow = get_shadow_model("test_type")

        predictor = ShadowPredictor(live, shadow, "test_type")
        predictor.predict(5)
        flush_all_comparisons()

        entries = read_comparison_log("test_type", window_hours=24)
        assert len(entries) == 1
        entry = entries[0]
        assert entry["model_type"] == "test_type"
        assert entry["live_version"] == "v1.0"
        assert entry["shadow_version"] == "v2.0"
        assert entry["live_prediction"] == 5.0
        assert entry["shadow_prediction"] == 10.0
        assert entry["agreement"] is False
        assert entry["shadow_timed_out"] is False

    def test_predict_without_shadow_returns_live(self, saved_model):
        live = get_live_model("test_type")
        predictor = ShadowPredictor(live, None, "test_type")
        result = predictor.predict(5)
        assert result == 5.0
        assert predictor.has_shadow is False

    def test_predict_shadow_timeout(self, saved_model):
        # Directly set a slow shadow model in memory
        slow = _SlowModel(10.0)
        _mr._shadow_models["test_type"] = slow
        _mr._shadow_versions["test_type"] = "v_slow_3.0"

        live = get_live_model("test_type")
        shadow = get_shadow_model("test_type")

        predictor = ShadowPredictor(live, shadow, "test_type", timeout_sec=0.1)
        result = predictor.predict(5)
        flush_all_comparisons()

        assert result == 5.0  # live result returned despite timeout

        entries = read_comparison_log("test_type", window_hours=24)
        assert len(entries) == 1
        assert entries[0]["shadow_timed_out"] is True

    def test_compare_results_exact_match(self):
        agreement, dtype = ShadowPredictor._compare_results(5.0, 5.0, False)
        assert agreement is True
        assert dtype == "exact_match"

    def test_compare_results_direction_same(self):
        agreement, dtype = ShadowPredictor._compare_results(0.5, 0.8, False)
        assert agreement is False
        assert dtype == "direction_same"

    def test_compare_results_direction_opposite(self):
        agreement, dtype = ShadowPredictor._compare_results(0.5, -0.3, False)
        assert agreement is False
        assert dtype == "direction_opposite"

    def test_compare_results_timeout(self):
        agreement, dtype = ShadowPredictor._compare_results(5.0, None, True)
        assert agreement is False
        assert dtype == "shadow_timeout"

    def test_compare_results_shadow_error(self):
        agreement, dtype = ShadowPredictor._compare_results(5.0, None, False)
        assert agreement is False
        assert dtype == "shadow_error"

    def test_create_shadow_predictor_factory(self, saved_model):
        register_shadow("test_type", "v2.0")
        predictor = create_shadow_predictor("test_type")
        assert predictor.has_shadow is True
        assert predictor._model_type == "test_type"

    def test_documented_overhead(self, saved_model):
        p = ShadowPredictor(None, None, "dummy", timeout_sec=2.5)
        assert p.documented_overhead_ms == 2500.0


# ---------------------------------------------------------------------------
# Comparison log and report tests
# ---------------------------------------------------------------------------


class TestComparisonLogging:
    """Tests for comparison logging persistence and reporting."""

    def test_log_and_flush(self, saved_model):
        from datetime import datetime, timezone

        entry = ComparisonEntry(
            timestamp=datetime.now(timezone.utc).isoformat(),
            model_type="test_type",
            live_version="v1.0",
            shadow_version="v2.0",
            input_hash="abc123",
            live_prediction=0.85,
            shadow_prediction=0.90,
            agreement=False,
            divergence_type="direction_same",
            latency_live_ms=12.3,
            latency_shadow_ms=15.7,
            shadow_timed_out=False,
        )

        for _ in range(5):
            log_comparison(entry)

        flush_all_comparisons()
        entries = read_comparison_log("test_type", window_hours=24)
        assert len(entries) == 5

    def test_window_filtering(self, saved_model):
        """Entries outside the window are filtered out."""
        from datetime import datetime, timedelta, timezone

        old_entry = {
            "timestamp": (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat(),
            "model_type": "test_type",
            "live_version": "v1.0",
            "shadow_version": "v2.0",
            "input_hash": "old_hash",
            "live_prediction": 0.5,
            "shadow_prediction": 0.6,
            "agreement": False,
            "divergence_type": "direction_same",
            "latency_live_ms": 10.0,
            "latency_shadow_ms": 12.0,
            "shadow_timed_out": False,
        }

        log_path = _comparison_log_path("test_type")
        with open(log_path, "w") as fh:
            fh.write(json.dumps(old_entry) + "\n")

        fresh = ComparisonEntry(
            timestamp=datetime.now(timezone.utc).isoformat(),
            model_type="test_type",
            live_version="v1.0",
            shadow_version="v2.0",
            input_hash="fresh_hash",
            live_prediction=1.0,
            shadow_prediction=1.0,
            agreement=True,
            divergence_type="exact_match",
            latency_live_ms=8.0,
            latency_shadow_ms=9.0,
            shadow_timed_out=False,
        )
        log_comparison(fresh)
        flush_all_comparisons()

        recent = read_comparison_log("test_type", window_hours=1)
        assert len(recent) == 1
        assert recent[0]["input_hash"] == "fresh_hash"

    def test_generate_comparison_report(self, saved_model):
        from datetime import datetime, timezone

        for i in range(20):
            entry = ComparisonEntry(
                timestamp=datetime.now(timezone.utc).isoformat(),
                model_type="test_type",
                live_version="v1.0",
                shadow_version="v2.0",
                input_hash=f"hash_{i:03d}",
                live_prediction=float(i % 3),
                shadow_prediction=float(i % 3) if i % 5 != 0 else -float(i % 3),
                agreement=(i % 5 != 0),
                divergence_type=(
                    "exact_match" if i % 5 != 0 else "direction_opposite"
                ),
                latency_live_ms=10.0 + i,
                latency_shadow_ms=12.0 + i,
                shadow_timed_out=(i == 19),
            )
            log_comparison(entry)

        flush_all_comparisons()
        report = generate_comparison_report("test_type", window_hours=24)

        assert report is not None
        assert report["model_type"] == "test_type"
        assert report["total_comparisons"] == 20
        assert report["agreement_count"] == 16
        assert report["divergence_count"] == 4
        assert report["timeout_count"] == 1
        assert "divergence_breakdown" in report
        assert "latency_stats" in report
        assert "recommendation" in report

    def test_generate_report_no_data(self, saved_model):
        report = generate_comparison_report("test_type", window_hours=24)
        assert report is None

    def test_clear_comparison_log(self, saved_model):
        from datetime import datetime, timezone

        entry = ComparisonEntry(
            timestamp=datetime.now(timezone.utc).isoformat(),
            model_type="test_type",
            live_version="v1.0",
            shadow_version="v2.0",
            input_hash="abc",
            live_prediction=1.0,
            shadow_prediction=1.0,
            agreement=True,
            divergence_type="exact_match",
            latency_live_ms=5.0,
            latency_shadow_ms=6.0,
            shadow_timed_out=False,
        )
        log_comparison(entry)
        flush_all_comparisons()

        assert len(read_comparison_log("test_type")) > 0
        clear_comparison_log("test_type")
        assert len(read_comparison_log("test_type")) == 0


# ---------------------------------------------------------------------------
# API endpoint behaviours (unit-level)
# ---------------------------------------------------------------------------


class TestShadowEndpoints:
    """Smoke tests for shadow API endpoint response shape."""

    @pytest.fixture
    def api_client(self, saved_model, monkeypatch):
        """Return an authenticated FastAPI TestClient wired to the server app."""
        from fastapi.testclient import TestClient

        from src.security import security_config
        from src.api.server import app

        # The API security middleware requires a configured API key and a
        # matching X-API-Key header on every request (except /health etc.).
        monkeypatch.setattr(security_config, "api_key", "test-key")
        client = TestClient(app)
        client.headers.update({"X-API-Key": "test-key"})
        return client

    def test_shadow_register_endpoint(self, api_client):
        resp = api_client.post(
            "/model/shadow/register",
            json={"model_type": "test_type", "version": "v2.0"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "registered"
        assert data["model_type"] == "test_type"
        assert data["shadow_version"] == "v2.0"
        assert data["live_version"] == "v1.0"

    def test_shadow_register_same_version_rejected(self, api_client):
        resp = api_client.post(
            "/model/shadow/register",
            json={"model_type": "test_type", "version": "v1.0"},
        )
        assert resp.status_code == 400

    def test_shadow_register_bad_version_rejected(self, api_client):
        resp = api_client.post(
            "/model/shadow/register",
            json={"model_type": "test_type", "version": "v99.0"},
        )
        assert resp.status_code == 400

    def test_shadow_promote_endpoint(self, api_client):
        api_client.post(
            "/model/shadow/register",
            json={"model_type": "test_type", "version": "v2.0"},
        )
        resp = api_client.post(
            "/model/shadow/promote",
            json={"model_type": "test_type"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "promoted"
        assert data["new_live_version"] == "v2.0"

    def test_shadow_promote_no_shadow(self, api_client):
        resp = api_client.post(
            "/model/shadow/promote",
            json={"model_type": "test_type"},
        )
        assert resp.status_code == 400

    def test_shadow_unregister_endpoint(self, api_client):
        api_client.post(
            "/model/shadow/register",
            json={"model_type": "test_type", "version": "v2.0"},
        )
        resp = api_client.post(
            "/model/shadow/unregister",
            json={"model_type": "test_type"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "unregistered"

    def test_model_rollback_endpoint(self, api_client):
        # Promote shadow v2.0 to live first, so v1.0 becomes the
        # previous version and can be rolled back to.
        api_client.post(
            "/model/shadow/register",
            json={"model_type": "test_type", "version": "v2.0"},
        )
        api_client.post(
            "/model/shadow/promote",
            json={"model_type": "test_type"},
        )
        resp = api_client.post(
            "/model/rollback",
            json={"model_type": "test_type", "target_version": "v1.0"},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "rolled_back"

    def test_model_rollback_no_target(self, api_client):
        resp = api_client.post(
            "/model/rollback",
            json={"model_type": "test_type"},
        )
        assert resp.status_code in (200, 400)

    def test_shadow_status_endpoint(self, api_client):
        api_client.post(
            "/model/shadow/register",
            json={"model_type": "test_type", "version": "v2.0"},
        )
        resp = api_client.get("/model/shadow/status")
        assert resp.status_code == 200
        data = resp.json()
        assert "shadows" in data
        assert "test_type" in data["shadows"]

    def test_comparison_report_endpoint(self, api_client):
        resp = api_client.get(
            "/model/shadow/comparison-report",
            params={"model_type": "test_type", "window_hours": 24},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "report" in data

    def test_comparison_log_endpoint(self, api_client):
        resp = api_client.get(
            "/model/shadow/comparison-log",
            params={"model_type": "test_type", "window_hours": 24},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["model_type"] == "test_type"
        assert data["entries"] == []

    def test_clear_comparison_log_endpoint(self, api_client):
        resp = api_client.delete(
            "/model/shadow/comparison-log",
            params={"model_type": "test_type"},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "cleared"
