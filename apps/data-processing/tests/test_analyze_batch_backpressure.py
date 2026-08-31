"""
Unit tests for the batch inference endpoint with backpressure (Issue #1240).

Uses import-level mocking to avoid requiring heavy dependencies (vaderSentiment,
slowapi, stellar_sdk, etc.) that are unavailable in the lightweight test env.
"""

import asyncio
import os
import sys
import types
from unittest.mock import MagicMock, patch

# ---------------------------------------------------------------------------
# Pre-import stubs: mock heavy deps before importing server
# ---------------------------------------------------------------------------
_SENTINEL = types.ModuleType("_test_stub")

# Stub modules that server.py imports transitively
_STUBBED = {}
for _name in [
    "vaderSentiment", "vaderSentiment.vaderSentiment",
    "slowapi", "slowapi.errors", "slowapi.util",
    "stellar_sdk", "stellar_sdk.exceptions",
    "sqlalchemy", "sqlalchemy.orm",
    "redis",
    "apscheduler", "apscheduler.schedulers",
]:
    if _name not in sys.modules:
        mod = types.ModuleType(_name)
        sys.modules[_name] = mod
        _STUBBED[_name] = mod

# slowapi stubs need specific attributes
if "slowapi" in sys.modules:
    sys.modules["slowapi"].Limiter = type("Limiter", (), {"__init__": lambda self, **kw: None})
    sys.modules["slowapi"]._rate_limit_exceeded_handler = lambda *a, **kw: None
if "slowapi.errors" in sys.modules:
    sys.modules["slowapi.errors"].RateLimitExceeded = type("RateLimitExceeded", (Exception,), {})
if "slowapi.util" in sys.modules:
    sys.modules["slowapi.util"].get_remote_address = lambda *a, **kw: "127.0.0.1"

# vaderSentiment stubs
if "vaderSentiment.vaderSentiment" in sys.modules:
    sys.modules["vaderSentiment.vaderSentiment"].SentimentIntensityAnalyzer = type(
        "SentimentIntensityAnalyzer", (), {"polarity_scores": lambda self, t: {"neg": 0, "neu": 1, "pos": 0, "compound": 0}}
    )

# stellar_sdk exception stubs
if "stellar_sdk.exceptions" in sys.modules:
    for exc_name in ("BadRequestError", "ConnectionError", "NotFoundError", "TimeoutError"):
        setattr(sys.modules["stellar_sdk.exceptions"], exc_name, type(exc_name, (Exception,), {}))

# jose stub
if "jose" not in sys.modules:
    sys.modules["jose"] = types.ModuleType("jose")
    sys.modules["jose"].JWTError = type("JWTError", (Exception,), {})
    sys.modules["jose"].jwt = MagicMock()

# pydantic stub - ensure it has BaseModel with ConfigDict
if "pydantic" not in sys.modules:
    pyd = types.ModuleType("pydantic")
    class _BaseModel:
        def __init__(self, **data):
            for k, v in data.items():
                setattr(self, k, v)
    pyd.BaseModel = _BaseModel
    pyd.ConfigDict = lambda **kw: None
    pyd.ValidationError = type("ValidationError", (Exception,), {})
    sys.modules["pydantic"] = pyd

os.environ.setdefault("SENTIMENT_DISABLE_TRANSFORMER", "1")
os.environ.setdefault("RATE_LIMIT_ENABLED", "0")
os.environ.setdefault("API_KEYS", '[{"id":"test","value":"test-key-123","scopes":["default"]}]')

# Now import the server
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient  # noqa: E402

import src.api.server as srv  # noqa: E402

_AUTH_HEADERS = {"X-API-Key": "test-key-123"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class _FakeResult:
    def __init__(self, text="ok", compound=0.0, label="neutral"):
        self.text = text
        self.compound_score = compound
        self.positive = 0.0
        self.negative = 0.0
        self.neutral = 1.0
        self.sentiment_label = label
        self.asset_codes = []

    def to_dict(self):
        return {
            "text": self.text,
            "compound_score": self.compound_score,
            "positive": self.positive,
            "negative": self.negative,
            "neutral": self.neutral,
            "sentiment_label": self.sentiment_label,
            "asset_codes": self.asset_codes,
        }


def _make_texts(n):
    return [f"Test text {i}" for i in range(n)]


def _make_summary(n=0):
    return {
        "total_items": n,
        "average_compound_score": 0.0,
        "positive_count": 0,
        "negative_count": 0,
        "neutral_count": n,
        "sentiment_distribution": {"positive": 0, "negative": 0, "neutral": n},
        "asset_distribution": {},
    }


def _patch_analyzer(results=None, summary=None):
    if results is None:
        results = [_FakeResult() for _ in range(5)]
    if summary is None:
        summary = _make_summary(len(results))
    mock = MagicMock()
    mock.analyze_batch.return_value = results
    mock.get_sentiment_summary.return_value = summary
    import contextlib
    @contextlib.contextmanager
    def _patch():
        with patch.object(srv, "sentiment_analyzer", mock), \
             patch.object(srv, "get_current_version", return_value="1.0.0"), \
             patch.object(srv, "_log_prediction"):
            yield
    return _patch()


# ---------------------------------------------------------------------------
# Tests — Max batch size
# ---------------------------------------------------------------------------

class TestMaxBatchSize:
    def test_empty_list_returns_400(self):
        client = TestClient(srv.app, raise_server_exceptions=False)
        resp = client.post("/analyze-batch", json=[], headers=_AUTH_HEADERS)
        assert resp.status_code == 400
        assert "empty" in resp.json()["detail"].lower()

    def test_oversized_batch_returns_413(self):
        client = TestClient(srv.app, raise_server_exceptions=False)
        with _patch_analyzer():
            resp = client.post("/analyze-batch", json=_make_texts(250), headers=_AUTH_HEADERS)
            assert resp.status_code == 413
            assert "exceeds maximum" in resp.json()["detail"]

    def test_batch_within_limit_succeeds(self):
        client = TestClient(srv.app, raise_server_exceptions=False)
        with _patch_analyzer(results=[_FakeResult() for _ in range(5)]):
            resp = client.post("/analyze-batch", json=_make_texts(5), headers=_AUTH_HEADERS)
            assert resp.status_code == 200
            assert resp.json()["count"] == 5


# ---------------------------------------------------------------------------
# Tests — Concurrency backpressure
# ---------------------------------------------------------------------------

class TestConcurrencyBackpressure:
    def test_returns_429_when_semaphore_full(self):
        original = srv._batch_semaphore
        srv._batch_semaphore = asyncio.Semaphore(0)
        try:
            client = TestClient(srv.app, raise_server_exceptions=False)
            resp = client.post("/analyze-batch", json=_make_texts(3), headers=_AUTH_HEADERS)
            assert resp.status_code == 429
            assert "Retry-After" in resp.headers
        finally:
            srv._batch_semaphore = original

    def test_semaphore_releases_after_request(self):
        original = srv._batch_semaphore
        srv._batch_semaphore = asyncio.Semaphore(1)
        try:
            client = TestClient(srv.app, raise_server_exceptions=False)
            with _patch_analyzer():
                resp = client.post("/analyze-batch", json=_make_texts(2), headers=_AUTH_HEADERS)
                assert resp.status_code == 200
                assert srv._batch_semaphore._value == 1
        finally:
            srv._batch_semaphore = original


# ---------------------------------------------------------------------------
# Tests — Per-item error isolation
# ---------------------------------------------------------------------------

class TestPerItemErrorIsolation:
    def test_mixed_results_include_error_entries(self):
        mixed = [
            _FakeResult(text="ok", compound=0.1, label="positive"),
            None,
            _FakeResult(text="also ok", compound=-0.2, label="negative"),
        ]
        client = TestClient(srv.app, raise_server_exceptions=False)
        with _patch_analyzer(results=mixed, summary=_make_summary(2)):
            resp = client.post("/analyze-batch", json=["good", "bad", "good"], headers=_AUTH_HEADERS)
            assert resp.status_code == 200
            body = resp.json()
            assert body["count"] == 3


# ---------------------------------------------------------------------------
# Tests — Response shape
# ---------------------------------------------------------------------------

class TestResponseShape:
    def test_response_contains_backpressure_fields(self):
        client = TestClient(srv.app, raise_server_exceptions=False)
        with _patch_analyzer(results=[_FakeResult() for _ in range(3)], summary=_make_summary(3)):
            resp = client.post("/analyze-batch", json=_make_texts(3), headers=_AUTH_HEADERS)
            assert resp.status_code == 200
            body = resp.json()
            assert "results" in body
            assert "summary" in body
            assert "count" in body
            assert "errors" in body
            assert "latency_ms" in body
            assert "concurrency_slots_remaining" in body
            assert body["count"] == 3
            assert body["errors"] == 0
            assert body["latency_ms"] >= 0


# ---------------------------------------------------------------------------
# Tests — Health and metrics responsiveness
# ---------------------------------------------------------------------------

class TestHealthAndMetricsResponsiveness:
    def test_health_endpoint_unaffected_by_semaphore(self):
        original = srv._batch_semaphore
        srv._batch_semaphore = asyncio.Semaphore(0)
        try:
            client = TestClient(srv.app)
            resp = client.get("/health", headers=_AUTH_HEADERS)
            assert resp.status_code == 200
        finally:
            srv._batch_semaphore = original

    def test_metrics_endpoint_unaffected_by_semaphore(self):
        original = srv._batch_semaphore
        srv._batch_semaphore = asyncio.Semaphore(0)
        try:
            client = TestClient(srv.app)
            resp = client.get("/metrics", headers=_AUTH_HEADERS)
            assert resp.status_code == 200
        finally:
            srv._batch_semaphore = original


# ---------------------------------------------------------------------------
# Tests — Environment configuration
# ---------------------------------------------------------------------------

class TestBatchConfig:
    def test_default_max_batch_size(self):
        assert srv.MAX_BATCH_SIZE == 200

    def test_default_max_concurrent_batches(self):
        assert srv.MAX_CONCURRENT_BATCHES == 4

    def test_semaphore_exists(self):
        assert isinstance(srv._batch_semaphore, asyncio.Semaphore)
