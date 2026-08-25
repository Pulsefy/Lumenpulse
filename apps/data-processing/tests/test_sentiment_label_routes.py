# -*- coding: utf-8 -*-
"""
Unit tests for src/api/sentiment_label_routes.py

Covers:
  - POST /api/sentiment-labels/submit — happy path and validation errors
  - PATCH /api/sentiment-labels/correct/{id} — happy path, 404, and validation errors
  - GET /api/sentiment-labels/examples — list, filter by split, filter by label
  - Pydantic schema validation for SubmitLabelRequest, CorrectLabelRequest

Uses FastAPI TestClient when available; skips gracefully in lightweight CI.
"""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Detect available dependencies
# ---------------------------------------------------------------------------
try:
    import fastapi
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    _FASTAPI_AVAILABLE = True
except ImportError:
    _FASTAPI_AVAILABLE = False

try:
    import src.api.sentiment_label_routes as _routes_module
    from src.api.sentiment_label_routes import router
    from src.db.label_store import LabelValidationError
    _ROUTER_AVAILABLE = True
except (ImportError, Exception):
    _ROUTER_AVAILABLE = False
    _routes_module = None  # type: ignore[assignment]

_CAN_RUN = _FASTAPI_AVAILABLE and _ROUTER_AVAILABLE

skip_if_unavailable = pytest.mark.skipif(
    not _CAN_RUN,
    reason="fastapi or route module dependencies not installed",
)

# ---------------------------------------------------------------------------
# Helper: build a fake DB row
# ---------------------------------------------------------------------------

def _fake_row(
    id: int = 1,
    text: str = "Bitcoin surges",
    label: str = "positive",
    labeller: str = "alice",
    split: str = "train",
    correction_note=None,
):
    row = MagicMock()
    row.id = id
    row.text = text
    row.label = label
    row.labeller = labeller
    row.split = split
    row.correction_note = correction_note
    row.labelled_at = datetime.now(timezone.utc)
    row.created_at = datetime.now(timezone.utc)
    return row


def _make_app():
    """Return a fresh FastAPI app with the label router mounted."""
    app = FastAPI()
    app.include_router(router)
    return app


def _make_session_mock():
    """Context-manager-compatible mock session."""
    s = MagicMock()
    s.__enter__ = lambda self: self
    s.__exit__ = MagicMock(return_value=False)
    return s


# ---------------------------------------------------------------------------
# POST /api/sentiment-labels/submit
# ---------------------------------------------------------------------------


@skip_if_unavailable
def test_submit_happy_path():
    """POST /submit with valid payload returns 201 and the new row id."""
    fake_row = _fake_row(id=42, label="negative", text="Bitcoin crashes")
    fake_session = _make_session_mock()
    store_instance = MagicMock()
    store_instance.add.return_value = fake_row

    with patch.object(_routes_module, "_get_session", return_value=fake_session), \
         patch.object(_routes_module, "LabelStore", return_value=store_instance):
        tc = TestClient(_make_app())
        resp = tc.post(
            "/api/sentiment-labels/submit",
            json={
                "text": "Bitcoin crashes",
                "label": "negative",
                "labeller": "alice",
                "split": "eval",
            },
        )

    assert resp.status_code == 201
    body = resp.json()
    assert body["success"] is True
    assert "id" in body
    assert body["id"] == 42


@skip_if_unavailable
def test_submit_invalid_label_returns_422():
    """POST /submit with an unknown label returns 422 before DB is touched."""
    with TestClient(_make_app()) as tc:
        resp = tc.post(
            "/api/sentiment-labels/submit",
            json={"text": "Some text", "label": "very_positive"},
        )
    assert resp.status_code == 422


@skip_if_unavailable
def test_submit_invalid_split_returns_422():
    """POST /submit with an unknown split returns 422."""
    with TestClient(_make_app()) as tc:
        resp = tc.post(
            "/api/sentiment-labels/submit",
            json={"text": "Some text", "label": "positive", "split": "holdout"},
        )
    assert resp.status_code == 422


@skip_if_unavailable
def test_submit_empty_text_returns_422():
    """POST /submit with an empty text returns 422."""
    with TestClient(_make_app()) as tc:
        resp = tc.post(
            "/api/sentiment-labels/submit",
            json={"text": "", "label": "positive"},
        )
    assert resp.status_code == 422


@skip_if_unavailable
def test_submit_missing_body_returns_422():
    """POST /submit with no body returns 422."""
    with TestClient(_make_app()) as tc:
        resp = tc.post("/api/sentiment-labels/submit", json={})
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# PATCH /api/sentiment-labels/correct/{id}
# ---------------------------------------------------------------------------


@skip_if_unavailable
def test_correct_happy_path():
    """PATCH /correct/{id} with valid payload returns 200 and updated id."""
    fake_row = _fake_row(id=7, label="negative")
    fake_session = _make_session_mock()
    store_instance = MagicMock()
    store_instance.correct.return_value = fake_row

    with patch.object(_routes_module, "_get_session", return_value=fake_session), \
         patch.object(_routes_module, "LabelStore", return_value=store_instance):
        tc = TestClient(_make_app())
        resp = tc.patch(
            "/api/sentiment-labels/correct/7",
            json={"new_label": "negative", "labeller": "bob"},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["id"] == 7


@skip_if_unavailable
def test_correct_not_found_returns_404():
    """PATCH /correct/{id} for a non-existent row returns 404."""
    fake_session = _make_session_mock()
    store_instance = MagicMock()
    store_instance.correct.side_effect = KeyError("not found")

    with patch.object(_routes_module, "_get_session", return_value=fake_session), \
         patch.object(_routes_module, "LabelStore", return_value=store_instance):
        tc = TestClient(_make_app())
        resp = tc.patch(
            "/api/sentiment-labels/correct/99999",
            json={"new_label": "positive", "labeller": "carol"},
        )

    assert resp.status_code == 404


@skip_if_unavailable
def test_correct_invalid_label_returns_422():
    """PATCH /correct/{id} with an unknown new_label returns 422."""
    with TestClient(_make_app()) as tc:
        resp = tc.patch(
            "/api/sentiment-labels/correct/1",
            json={"new_label": "meh", "labeller": "dave"},
        )
    assert resp.status_code == 422


@skip_if_unavailable
def test_correct_missing_labeller_returns_422():
    """PATCH /correct/{id} missing required 'labeller' field returns 422."""
    with TestClient(_make_app()) as tc:
        resp = tc.patch(
            "/api/sentiment-labels/correct/1",
            json={"new_label": "positive"},
        )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# GET /api/sentiment-labels/examples
# ---------------------------------------------------------------------------


@skip_if_unavailable
def test_list_examples_returns_all():
    """GET /examples without filters returns all rows from the store."""
    fake_rows = [
        _fake_row(id=1, label="positive", split="train"),
        _fake_row(id=2, label="negative", split="eval"),
    ]
    fake_session = _make_session_mock()
    store_instance = MagicMock()
    store_instance.list_all.return_value = fake_rows

    with patch.object(_routes_module, "_get_session", return_value=fake_session), \
         patch.object(_routes_module, "LabelStore", return_value=store_instance):
        tc = TestClient(_make_app())
        resp = tc.get("/api/sentiment-labels/examples")

    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) == 2


@skip_if_unavailable
def test_list_examples_filter_by_split_passes_to_store():
    """GET /examples?split=eval passes split='eval' to LabelStore.list_all."""
    eval_row = _fake_row(id=3, split="eval", label="neutral")
    fake_session = _make_session_mock()
    store_instance = MagicMock()
    store_instance.list_all.return_value = [eval_row]

    with patch.object(_routes_module, "_get_session", return_value=fake_session), \
         patch.object(_routes_module, "LabelStore", return_value=store_instance):
        tc = TestClient(_make_app())
        resp = tc.get("/api/sentiment-labels/examples?split=eval")

    assert resp.status_code == 200
    # Confirm the store was called with the right split
    call_kwargs = store_instance.list_all.call_args
    assert call_kwargs is not None
    assert call_kwargs.kwargs.get("split") == "eval"


@skip_if_unavailable
def test_list_examples_filter_by_label_passes_to_store():
    """GET /examples?label=positive passes label='positive' to LabelStore."""
    pos_row = _fake_row(id=5, label="positive")
    fake_session = _make_session_mock()
    store_instance = MagicMock()
    store_instance.list_all.return_value = [pos_row]

    with patch.object(_routes_module, "_get_session", return_value=fake_session), \
         patch.object(_routes_module, "LabelStore", return_value=store_instance):
        tc = TestClient(_make_app())
        resp = tc.get("/api/sentiment-labels/examples?label=positive")

    assert resp.status_code == 200
    call_kwargs = store_instance.list_all.call_args
    assert call_kwargs.kwargs.get("label") == "positive"


@skip_if_unavailable
def test_list_examples_empty_store():
    """GET /examples returns an empty list when the store is empty."""
    fake_session = _make_session_mock()
    store_instance = MagicMock()
    store_instance.list_all.return_value = []

    with patch.object(_routes_module, "_get_session", return_value=fake_session), \
         patch.object(_routes_module, "LabelStore", return_value=store_instance):
        tc = TestClient(_make_app())
        resp = tc.get("/api/sentiment-labels/examples")

    assert resp.status_code == 200
    assert resp.json() == []


@skip_if_unavailable
def test_list_examples_invalid_split_returns_422():
    """GET /examples?split=bad returns 422 without touching the DB."""
    with TestClient(_make_app()) as tc:
        resp = tc.get("/api/sentiment-labels/examples?split=test_holdout")
    assert resp.status_code == 422


@skip_if_unavailable
def test_list_examples_invalid_label_returns_422():
    """GET /examples?label=bad returns 422."""
    with TestClient(_make_app()) as tc:
        resp = tc.get("/api/sentiment-labels/examples?label=very_positive")
    assert resp.status_code == 422


@skip_if_unavailable
def test_list_examples_pagination():
    """GET /examples respects limit and offset query params."""
    rows = [_fake_row(id=i, label="neutral") for i in range(5)]
    fake_session = _make_session_mock()
    store_instance = MagicMock()
    store_instance.list_all.return_value = rows[:2]  # simulated slice

    with patch.object(_routes_module, "_get_session", return_value=fake_session), \
         patch.object(_routes_module, "LabelStore", return_value=store_instance):
        tc = TestClient(_make_app())
        resp = tc.get("/api/sentiment-labels/examples?limit=2&offset=0")

    assert resp.status_code == 200
    call_kwargs = store_instance.list_all.call_args
    assert call_kwargs.kwargs.get("limit") == 2
    assert call_kwargs.kwargs.get("offset") == 0


# ---------------------------------------------------------------------------
# Pydantic schema validation — no FastAPI server needed
# ---------------------------------------------------------------------------


def test_submit_schema_valid_label():
    """SubmitLabelRequest accepts all three valid labels."""
    if not _ROUTER_AVAILABLE:
        pytest.skip("router module not available")
    from src.api.sentiment_label_routes import SubmitLabelRequest

    for lbl in ("positive", "negative", "neutral"):
        req = SubmitLabelRequest(text="Text", label=lbl)
        assert req.label == lbl


def test_submit_schema_rejects_invalid_label():
    """SubmitLabelRequest rejects an unknown label."""
    if not _ROUTER_AVAILABLE:
        pytest.skip("router module not available")
    from src.api.sentiment_label_routes import SubmitLabelRequest

    with pytest.raises(Exception):
        SubmitLabelRequest(text="Something", label="very_positive")


def test_submit_schema_valid_splits():
    """SubmitLabelRequest accepts 'train' and 'eval'."""
    if not _ROUTER_AVAILABLE:
        pytest.skip("router module not available")
    from src.api.sentiment_label_routes import SubmitLabelRequest

    for split in ("train", "eval"):
        req = SubmitLabelRequest(text="x", label="positive", split=split)
        assert req.split == split


def test_submit_schema_rejects_invalid_split():
    """SubmitLabelRequest rejects an unknown split."""
    if not _ROUTER_AVAILABLE:
        pytest.skip("router module not available")
    from src.api.sentiment_label_routes import SubmitLabelRequest

    with pytest.raises(Exception):
        SubmitLabelRequest(text="x", label="neutral", split="badvalue")


def test_correct_schema_valid_label():
    """CorrectLabelRequest accepts all three valid new_label values."""
    if not _ROUTER_AVAILABLE:
        pytest.skip("router module not available")
    from src.api.sentiment_label_routes import CorrectLabelRequest

    for lbl in ("positive", "negative", "neutral"):
        req = CorrectLabelRequest(new_label=lbl, labeller="carol")
        assert req.new_label == lbl


def test_correct_schema_rejects_invalid_label():
    """CorrectLabelRequest rejects an unknown new_label."""
    if not _ROUTER_AVAILABLE:
        pytest.skip("router module not available")
    from src.api.sentiment_label_routes import CorrectLabelRequest

    with pytest.raises(Exception):
        CorrectLabelRequest(new_label="wrong", labeller="carol")
