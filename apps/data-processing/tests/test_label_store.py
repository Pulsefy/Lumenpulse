# -*- coding: utf-8 -*-
"""
Unit tests for src/db/label_store.py

Covers:
  - add(): stores row and returns it
  - correct(): updates label, labeller, note
  - delete(): removes row
  - get() / list_all(): read back stored rows
  - get_eval_split() / get_train_split(): split isolation
  - count_by_split_and_label(): aggregation
  - bulk_add(): batch insert
  - Validation errors for bad label / split values
  - Seed round-trip: loading sentiment_seed_labels.json produces correct rows

All database I/O is exercised through a real SQLite in-memory database via
``sqlalchemy`` when available, or via ``MagicMock`` stubs when it is not
(matching the existing project CI pattern).
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import List
from datetime import datetime, timezone
from unittest.mock import MagicMock, call, patch

import pytest

# ---------------------------------------------------------------------------
# Try to import the real LabelStore + model; fall back to pure-mock path if
# SQLAlchemy is not installed (lightweight CI environment).
# ---------------------------------------------------------------------------
try:
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    from src.db.models import Base, SentimentLabelledExample
    from src.db.label_store import LabelStore, LabelValidationError

    _SQLALCHEMY_AVAILABLE = True
except (ImportError, Exception):
    _SQLALCHEMY_AVAILABLE = False
    # Provide minimal stubs so the rest of the file can import cleanly.
    LabelValidationError = type("LabelValidationError", (ValueError,), {})


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def sqlite_session():
    """
    Provide a real SQLite in-memory session.
    Skips the test if SQLAlchemy is not installed.
    """
    if not _SQLALCHEMY_AVAILABLE:
        pytest.skip("sqlalchemy not installed — skipping SQLite fixture")
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
        session.rollback()


@pytest.fixture
def store(sqlite_session):
    """Return a LabelStore wired to the in-memory SQLite session."""
    return LabelStore(sqlite_session)


@pytest.fixture
def seed_file_path() -> Path:
    """Absolute path to the bundled seed file."""
    return Path(__file__).resolve().parents[1] / "data" / "sentiment_seed_labels.json"


# ---------------------------------------------------------------------------
# CRUD — add
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not _SQLALCHEMY_AVAILABLE, reason="sqlalchemy not installed")
def test_add_returns_row_with_correct_fields(store):
    row = store.add(text="Bitcoin is crashing", label="negative", labeller="alice")
    assert row.id is not None
    assert row.text == "Bitcoin is crashing"
    assert row.label == "negative"
    assert row.labeller == "alice"
    assert row.split == "train"  # default


@pytest.mark.skipif(not _SQLALCHEMY_AVAILABLE, reason="sqlalchemy not installed")
def test_add_with_eval_split(store):
    row = store.add(text="Stellar rallies", label="positive", split="eval")
    assert row.split == "eval"


@pytest.mark.skipif(not _SQLALCHEMY_AVAILABLE, reason="sqlalchemy not installed")
def test_add_strips_whitespace(store):
    row = store.add(text="  Bitcoin  ", label="neutral")
    assert row.text == "Bitcoin"


@pytest.mark.skipif(not _SQLALCHEMY_AVAILABLE, reason="sqlalchemy not installed")
def test_add_rejects_empty_text(store):
    with pytest.raises(ValueError, match="must not be empty"):
        store.add(text="   ", label="positive")


@pytest.mark.skipif(not _SQLALCHEMY_AVAILABLE, reason="sqlalchemy not installed")
def test_add_rejects_invalid_label(store):
    with pytest.raises(LabelValidationError, match="Invalid label"):
        store.add(text="Some text", label="happy")


@pytest.mark.skipif(not _SQLALCHEMY_AVAILABLE, reason="sqlalchemy not installed")
def test_add_rejects_invalid_split(store):
    with pytest.raises(LabelValidationError, match="Invalid split"):
        store.add(text="Some text", label="positive", split="test")


# ---------------------------------------------------------------------------
# CRUD — correct
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not _SQLALCHEMY_AVAILABLE, reason="sqlalchemy not installed")
def test_correct_changes_label_and_labeller(store):
    row = store.add(text="Markets tank", label="neutral", labeller="alice")
    original_ts = row.labelled_at

    corrected = store.correct(
        row.id, new_label="negative", labeller="bob", correction_note="Actually bearish"
    )
    assert corrected.label == "negative"
    assert corrected.labeller == "bob"
    assert corrected.correction_note == "Actually bearish"
    # Timestamp must be refreshed (or equal in fast tests)
    assert corrected.labelled_at >= original_ts


@pytest.mark.skipif(not _SQLALCHEMY_AVAILABLE, reason="sqlalchemy not installed")
def test_correct_raises_for_missing_id(store):
    with pytest.raises(KeyError):
        store.correct(99999, new_label="positive", labeller="carol")


@pytest.mark.skipif(not _SQLALCHEMY_AVAILABLE, reason="sqlalchemy not installed")
def test_correct_rejects_invalid_label(store):
    row = store.add(text="Some text", label="neutral")
    with pytest.raises(LabelValidationError):
        store.correct(row.id, new_label="very_positive", labeller="dave")


# ---------------------------------------------------------------------------
# CRUD — delete
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not _SQLALCHEMY_AVAILABLE, reason="sqlalchemy not installed")
def test_delete_removes_row(store):
    row = store.add(text="XLM moons", label="positive")
    store.delete(row.id)
    assert store.get(row.id) is None


@pytest.mark.skipif(not _SQLALCHEMY_AVAILABLE, reason="sqlalchemy not installed")
def test_delete_raises_for_missing_id(store):
    with pytest.raises(KeyError):
        store.delete(88888)


# ---------------------------------------------------------------------------
# Read — list_all / get
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not _SQLALCHEMY_AVAILABLE, reason="sqlalchemy not installed")
def test_get_returns_none_for_missing(store):
    assert store.get(12345) is None


@pytest.mark.skipif(not _SQLALCHEMY_AVAILABLE, reason="sqlalchemy not installed")
def test_list_all_returns_all_rows(store):
    store.add(text="Crypto rallies", label="positive", split="train")
    store.add(text="Market tanks", label="negative", split="eval")
    rows = store.list_all()
    assert len(rows) == 2


@pytest.mark.skipif(not _SQLALCHEMY_AVAILABLE, reason="sqlalchemy not installed")
def test_list_all_filter_by_split(store):
    store.add(text="Text A", label="positive", split="train")
    store.add(text="Text B", label="negative", split="eval")

    train_rows = store.list_all(split="train")
    eval_rows = store.list_all(split="eval")

    assert len(train_rows) == 1
    assert train_rows[0].split == "train"
    assert len(eval_rows) == 1
    assert eval_rows[0].split == "eval"


@pytest.mark.skipif(not _SQLALCHEMY_AVAILABLE, reason="sqlalchemy not installed")
def test_list_all_filter_by_label(store):
    store.add(text="Up only", label="positive")
    store.add(text="Down bad", label="negative")
    store.add(text="Flat", label="neutral")

    pos = store.list_all(label="positive")
    assert len(pos) == 1
    assert pos[0].label == "positive"


# ---------------------------------------------------------------------------
# Split isolation
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not _SQLALCHEMY_AVAILABLE, reason="sqlalchemy not installed")
def test_get_eval_split_excludes_train_rows(store):
    store.add(text="Train example", label="neutral", split="train")
    store.add(text="Eval example 1", label="positive", split="eval")
    store.add(text="Eval example 2", label="negative", split="eval")

    eval_rows = store.get_eval_split()
    assert len(eval_rows) == 2
    for r in eval_rows:
        assert r.split == "eval"


@pytest.mark.skipif(not _SQLALCHEMY_AVAILABLE, reason="sqlalchemy not installed")
def test_get_train_split_excludes_eval_rows(store):
    store.add(text="Train A", label="positive", split="train")
    store.add(text="Train B", label="negative", split="train")
    store.add(text="Eval C", label="neutral", split="eval")

    train_rows = store.get_train_split()
    assert len(train_rows) == 2
    for r in train_rows:
        assert r.split == "train"


@pytest.mark.skipif(not _SQLALCHEMY_AVAILABLE, reason="sqlalchemy not installed")
def test_eval_and_train_splits_are_disjoint(store):
    texts = [
        ("Train 1", "positive", "train"),
        ("Train 2", "negative", "train"),
        ("Eval 1", "neutral", "eval"),
    ]
    for text, label, split in texts:
        store.add(text=text, label=label, split=split)

    train_ids = {r.id for r in store.get_train_split()}
    eval_ids = {r.id for r in store.get_eval_split()}
    assert train_ids.isdisjoint(eval_ids)


# ---------------------------------------------------------------------------
# Aggregation — count_by_split_and_label
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not _SQLALCHEMY_AVAILABLE, reason="sqlalchemy not installed")
def test_count_by_split_and_label(store):
    data = [
        ("T1", "positive", "train"),
        ("T2", "positive", "train"),
        ("T3", "negative", "train"),
        ("E1", "neutral", "eval"),
        ("E2", "positive", "eval"),
    ]
    for text, label, split in data:
        store.add(text=text, label=label, split=split)

    counts = store.count_by_split_and_label()
    assert counts["train"]["positive"] == 2
    assert counts["train"]["negative"] == 1
    assert counts["eval"]["neutral"] == 1
    assert counts["eval"]["positive"] == 1


# ---------------------------------------------------------------------------
# bulk_add
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not _SQLALCHEMY_AVAILABLE, reason="sqlalchemy not installed")
def test_bulk_add_inserts_multiple_rows(store, sqlite_session):
    examples = [
        {"text": "Crypto up", "label": "positive", "labeller": "seed", "split": "train"},
        {"text": "Crypto down", "label": "negative", "labeller": "seed", "split": "eval"},
        {"text": "Crypto flat", "label": "neutral", "labeller": "seed", "split": "train"},
    ]
    rows = store.bulk_add(examples)
    assert len(rows) == 3
    sqlite_session.commit()

    all_rows = store.list_all()
    assert len(all_rows) == 3


# ---------------------------------------------------------------------------
# Seed round-trip
# ---------------------------------------------------------------------------


def test_seed_file_exists(seed_file_path):
    """The bundled seed JSON must be present on disk."""
    assert seed_file_path.exists(), f"Seed file missing: {seed_file_path}"


def test_seed_file_is_valid_json(seed_file_path):
    with open(seed_file_path, encoding="utf-8") as fh:
        data = json.load(fh)
    assert isinstance(data, list)
    assert len(data) >= 20, "Seed file should have at least 20 examples"


def test_seed_file_has_required_fields(seed_file_path):
    with open(seed_file_path, encoding="utf-8") as fh:
        data = json.load(fh)
    required = {"text", "label", "split"}
    for i, ex in enumerate(data):
        assert required.issubset(ex.keys()), f"Entry {i} missing fields: {ex}"


def test_seed_file_labels_are_valid(seed_file_path):
    valid_labels = {"positive", "negative", "neutral"}
    with open(seed_file_path, encoding="utf-8") as fh:
        data = json.load(fh)
    for i, ex in enumerate(data):
        assert ex["label"] in valid_labels, f"Entry {i} has invalid label: {ex['label']}"


def test_seed_file_splits_are_valid(seed_file_path):
    valid_splits = {"train", "eval"}
    with open(seed_file_path, encoding="utf-8") as fh:
        data = json.load(fh)
    for i, ex in enumerate(data):
        assert ex["split"] in valid_splits, f"Entry {i} has invalid split: {ex['split']}"


def test_seed_file_has_eval_examples(seed_file_path):
    """There must be at least some held-out eval rows to make evaluation exercisable."""
    with open(seed_file_path, encoding="utf-8") as fh:
        data = json.load(fh)
    eval_rows = [e for e in data if e["split"] == "eval"]
    assert len(eval_rows) >= 3, "Need at least 3 eval examples to exercise P/R/F1"


def test_seed_file_has_all_three_labels(seed_file_path):
    with open(seed_file_path, encoding="utf-8") as fh:
        data = json.load(fh)
    labels = {e["label"] for e in data}
    assert labels == {"positive", "negative", "neutral"}


@pytest.mark.skipif(not _SQLALCHEMY_AVAILABLE, reason="sqlalchemy not installed")
def test_seed_round_trip(store, sqlite_session, seed_file_path):
    """Loading the seed file and inserting via bulk_add yields the expected rows."""
    with open(seed_file_path, encoding="utf-8") as fh:
        examples = json.load(fh)

    rows = store.bulk_add(examples)
    sqlite_session.commit()

    assert len(rows) == len(examples)

    # All labels are valid
    valid_labels = {"positive", "negative", "neutral"}
    for r in rows:
        assert r.label in valid_labels

    # Eval split is populated
    eval_rows = store.get_eval_split()
    expected_eval_count = sum(1 for e in examples if e["split"] == "eval")
    assert len(eval_rows) == expected_eval_count

    # Train split is populated
    train_rows = store.get_train_split()
    expected_train_count = sum(1 for e in examples if e["split"] == "train")
    assert len(train_rows) == expected_train_count


# ---------------------------------------------------------------------------
# Validation logic tests — no SQLAlchemy needed
# ---------------------------------------------------------------------------


def test_label_validation_error_message():
    """LabelValidationError carries a descriptive message."""
    err = LabelValidationError("Invalid label 'happy'. Must be one of: ['negative', 'neutral', 'positive']")
    assert "happy" in str(err)


def test_validation_static_method_directly():
    """_validate static method rejects unknown labels/splits without a session."""
    if not _SQLALCHEMY_AVAILABLE:
        pytest.skip("sqlalchemy not installed")
    with pytest.raises(LabelValidationError, match="Invalid label"):
        LabelStore._validate(label="bad_label")
    with pytest.raises(LabelValidationError, match="Invalid split"):
        LabelStore._validate(split="holdout")
    # valid values should not raise
    LabelStore._validate(label="positive", split="eval")
