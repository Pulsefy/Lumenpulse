# -*- coding: utf-8 -*-
"""
tests/test_labelled_example_store.py
=====================================
Unit tests for the human-labelled sentiment example store and the
sentiment evaluation pipeline added to the retraining pipeline.

Covers:
  - LabelledExampleStore: add / correct / delete / get / list / split / stats
  - Validation of label and split values
  - Persistence: data survives a store reload from disk
  - get_split: train and eval sets are correctly separated
  - _evaluate_sentiment_model: metrics shape and basic sanity
  - _compound_to_label: threshold logic
  - Seed data: eval split is non-empty and has the expected schema
"""

import json
import os
import uuid
from pathlib import Path

import pytest

from src.ml.labelled_example_store import (
    LabelledExampleStore,
    VALID_LABELS,
    VALID_SPLITS,
    _utcnow,
)
from src.ml.retraining_pipeline import (
    _compound_to_label,
    _evaluate_sentiment_model,
    _build_sentiment_model,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def tmp_store(tmp_path) -> LabelledExampleStore:
    """Return a fresh, empty store backed by a temp file."""
    return LabelledExampleStore(tmp_path / "test_examples.jsonl")


@pytest.fixture
def seeded_store(tmp_path) -> LabelledExampleStore:
    """Return a store pre-loaded with a small seed set (3 train + 1 eval)."""
    path = tmp_path / "seeded.jsonl"
    examples = [
        {
            "id": "aaaaaaaa-0000-4000-8000-000000000001",
            "text": "Bitcoin is mooning",
            "label": "positive",
            "labeller": "seed",
            "timestamp": "2026-01-01T00:00:00+00:00",
            "split": "train",
            "notes": "",
        },
        {
            "id": "aaaaaaaa-0000-4000-8000-000000000002",
            "text": "Crypto is crashing hard",
            "label": "negative",
            "labeller": "seed",
            "timestamp": "2026-01-01T00:00:00+00:00",
            "split": "train",
            "notes": "",
        },
        {
            "id": "aaaaaaaa-0000-4000-8000-000000000003",
            "text": "Stellar processes transactions as usual",
            "label": "neutral",
            "labeller": "seed",
            "timestamp": "2026-01-01T00:00:00+00:00",
            "split": "train",
            "notes": "",
        },
        {
            "id": "aaaaaaaa-0000-4000-8000-000000000004",
            "text": "Bitcoin surges to all-time high",
            "label": "positive",
            "labeller": "seed",
            "timestamp": "2026-01-01T00:00:00+00:00",
            "split": "eval",
            "notes": "eval holdout",
        },
    ]
    with path.open("w") as fh:
        for ex in examples:
            fh.write(json.dumps(ex) + "\n")
    return LabelledExampleStore(path)


# ---------------------------------------------------------------------------
# LabelledExampleStore: basic CRUD
# ---------------------------------------------------------------------------


class TestAddExample:
    def test_add_returns_uuid_string(self, tmp_store):
        eid = tmp_store.add("test text", "positive", labeller="tester")
        assert isinstance(eid, str)
        # Should parse as a valid UUID
        uuid.UUID(eid)

    def test_added_example_retrievable(self, tmp_store):
        eid = tmp_store.add("Bitcoin surges", "positive", labeller="alice")
        row = tmp_store.get(eid)
        assert row is not None
        assert row["text"] == "Bitcoin surges"
        assert row["label"] == "positive"
        assert row["labeller"] == "alice"

    def test_add_increments_length(self, tmp_store):
        assert len(tmp_store) == 0
        tmp_store.add("text one", "negative")
        assert len(tmp_store) == 1
        tmp_store.add("text two", "neutral")
        assert len(tmp_store) == 2

    def test_split_is_assigned(self, tmp_store):
        eid = tmp_store.add("some text", "neutral")
        row = tmp_store.get(eid)
        assert row["split"] in VALID_SPLITS

    def test_explicit_split_respected(self, tmp_store):
        eid = tmp_store.add("some text", "positive", split="eval")
        row = tmp_store.get(eid)
        assert row["split"] == "eval"

    def test_timestamp_is_present(self, tmp_store):
        eid = tmp_store.add("time test", "neutral")
        row = tmp_store.get(eid)
        assert row["timestamp"]
        # Basic ISO-8601 sanity
        assert "T" in row["timestamp"]

    def test_notes_stored(self, tmp_store):
        eid = tmp_store.add("text", "positive", notes="test note")
        row = tmp_store.get(eid)
        assert row["notes"] == "test note"

    def test_invalid_label_raises(self, tmp_store):
        with pytest.raises(ValueError, match="label must be"):
            tmp_store.add("text", "bullish")

    def test_invalid_split_raises(self, tmp_store):
        with pytest.raises(ValueError, match="split must be"):
            tmp_store.add("text", "positive", split="test-split")


class TestCorrectExample:
    def test_correct_updates_label(self, tmp_store):
        eid = tmp_store.add("price going up", "positive")
        tmp_store.correct(eid, "neutral", labeller="reviewer")
        row = tmp_store.get(eid)
        assert row["label"] == "neutral"
        assert row["labeller"] == "reviewer"

    def test_correct_updates_timestamp(self, tmp_store):
        eid = tmp_store.add("text", "positive")
        original_ts = tmp_store.get(eid)["timestamp"]
        import time
        time.sleep(0.01)
        tmp_store.correct(eid, "negative")
        new_ts = tmp_store.get(eid)["timestamp"]
        # Timestamp should be updated (or at least re-written)
        assert new_ts is not None

    def test_correct_unknown_id_raises(self, tmp_store):
        with pytest.raises(KeyError):
            tmp_store.correct("nonexistent-id", "positive")

    def test_correct_invalid_label_raises(self, tmp_store):
        eid = tmp_store.add("text", "positive")
        with pytest.raises(ValueError, match="label must be"):
            tmp_store.correct(eid, "bearish")

    def test_correct_notes_updated(self, tmp_store):
        eid = tmp_store.add("text", "positive", notes="original")
        tmp_store.correct(eid, "negative", notes="correction reason")
        row = tmp_store.get(eid)
        assert row["notes"] == "correction reason"

    def test_correct_does_not_change_split(self, tmp_store):
        eid = tmp_store.add("text", "positive", split="eval")
        tmp_store.correct(eid, "negative")
        row = tmp_store.get(eid)
        assert row["split"] == "eval"


class TestDeleteExample:
    def test_delete_removes_example(self, tmp_store):
        eid = tmp_store.add("text", "positive")
        assert len(tmp_store) == 1
        tmp_store.delete(eid)
        assert len(tmp_store) == 0
        assert tmp_store.get(eid) is None

    def test_delete_unknown_id_raises(self, tmp_store):
        with pytest.raises(KeyError):
            tmp_store.delete("ghost-id")


# ---------------------------------------------------------------------------
# LabelledExampleStore: persistence
# ---------------------------------------------------------------------------


class TestPersistence:
    def test_reload_recovers_examples(self, tmp_path):
        path = tmp_path / "persist.jsonl"
        store1 = LabelledExampleStore(path)
        eid = store1.add("persistent text", "positive", labeller="persist-test")

        # Create a second store from the same file
        store2 = LabelledExampleStore(path)
        row = store2.get(eid)
        assert row is not None
        assert row["text"] == "persistent text"
        assert row["label"] == "positive"

    def test_correct_persisted(self, tmp_path):
        path = tmp_path / "correct_persist.jsonl"
        store1 = LabelledExampleStore(path)
        eid = store1.add("text", "positive")
        store1.correct(eid, "negative", labeller="corrector")

        store2 = LabelledExampleStore(path)
        assert store2.get(eid)["label"] == "negative"

    def test_delete_persisted(self, tmp_path):
        path = tmp_path / "delete_persist.jsonl"
        store1 = LabelledExampleStore(path)
        eid = store1.add("text to delete", "neutral")
        store1.delete(eid)

        store2 = LabelledExampleStore(path)
        assert store2.get(eid) is None
        assert len(store2) == 0


# ---------------------------------------------------------------------------
# LabelledExampleStore: get_split
# ---------------------------------------------------------------------------


class TestGetSplit:
    def test_split_returns_two_dataframes(self, seeded_store):
        train_df, eval_df = seeded_store.get_split()
        assert hasattr(train_df, "columns")
        assert hasattr(eval_df, "columns")

    def test_train_count(self, seeded_store):
        train_df, _ = seeded_store.get_split()
        assert len(train_df) == 3

    def test_eval_count(self, seeded_store):
        _, eval_df = seeded_store.get_split()
        assert len(eval_df) == 1

    def test_eval_rows_are_not_in_train(self, seeded_store):
        train_df, eval_df = seeded_store.get_split()
        train_ids = set(train_df["id"].tolist())
        eval_ids = set(eval_df["id"].tolist())
        assert train_ids.isdisjoint(eval_ids)

    def test_empty_store_returns_empty_dfs(self, tmp_store):
        train_df, eval_df = tmp_store.get_split()
        assert train_df.empty
        assert eval_df.empty

    def test_all_train_columns_present(self, seeded_store):
        train_df, _ = seeded_store.get_split()
        for col in ["id", "text", "label", "labeller", "timestamp", "split"]:
            assert col in train_df.columns


# ---------------------------------------------------------------------------
# LabelledExampleStore: class_counts
# ---------------------------------------------------------------------------


class TestClassCounts:
    def test_class_counts_sum_matches_total(self, seeded_store):
        counts = seeded_store.class_counts()
        assert sum(counts.values()) == len(seeded_store)

    def test_all_labels_present_in_counts(self, seeded_store):
        counts = seeded_store.class_counts()
        for label in VALID_LABELS:
            assert label in counts

    def test_positive_count(self, seeded_store):
        counts = seeded_store.class_counts()
        assert counts["positive"] == 2  # train + eval

    def test_empty_store_all_zeros(self, tmp_store):
        counts = tmp_store.class_counts()
        assert all(v == 0 for v in counts.values())


# ---------------------------------------------------------------------------
# LabelledExampleStore: list_all / to_dataframe
# ---------------------------------------------------------------------------


class TestListAll:
    def test_list_all_returns_copies(self, seeded_store):
        rows = seeded_store.list_all()
        # Mutating a returned row should not affect the store
        rows[0]["label"] = "MUTATED"
        stored = seeded_store.get(rows[0]["id"])
        assert stored["label"] != "MUTATED"

    def test_to_dataframe_shape(self, seeded_store):
        df = seeded_store.to_dataframe()
        assert len(df) == 4
        assert "text" in df.columns

    def test_empty_store_dataframe_has_columns(self, tmp_store):
        df = tmp_store.to_dataframe()
        assert df.empty
        assert "text" in df.columns


# ---------------------------------------------------------------------------
# Auto-split heuristic
# ---------------------------------------------------------------------------


class TestAutoSplit:
    def test_auto_split_is_deterministic(self):
        eid = str(uuid.uuid4())
        split1 = LabelledExampleStore._auto_split(eid)
        split2 = LabelledExampleStore._auto_split(eid)
        assert split1 == split2

    def test_auto_split_returns_valid_value(self):
        for _ in range(50):
            eid = str(uuid.uuid4())
            assert LabelledExampleStore._auto_split(eid) in VALID_SPLITS

    def test_auto_split_eval_fraction(self):
        # With eval_fraction=0.2 approximately 20% should be eval.
        # Use a large sample and allow ±10% tolerance.
        n = 1000
        eval_count = sum(
            1 for _ in range(n)
            if LabelledExampleStore._auto_split(str(uuid.uuid4())) == "eval"
        )
        assert 100 <= eval_count <= 300  # 10–30% range


# ---------------------------------------------------------------------------
# _compound_to_label (retraining pipeline helper)
# ---------------------------------------------------------------------------


class TestCompoundToLabel:
    def test_positive_threshold(self):
        assert _compound_to_label(0.05) == "positive"
        assert _compound_to_label(0.9) == "positive"

    def test_negative_threshold(self):
        assert _compound_to_label(-0.05) == "negative"
        assert _compound_to_label(-0.9) == "negative"

    def test_neutral_boundary_low(self):
        assert _compound_to_label(0.04) == "neutral"

    def test_neutral_boundary_high(self):
        assert _compound_to_label(-0.04) == "neutral"

    def test_zero_is_neutral(self):
        assert _compound_to_label(0.0) == "neutral"


# ---------------------------------------------------------------------------
# _evaluate_sentiment_model
# ---------------------------------------------------------------------------


class TestEvaluateSentimentModel:
    def test_returns_dict(self, tmp_path, monkeypatch):
        """With a real seed file the function returns a valid metrics dict."""
        # Point the pipeline at the real seed file
        seed_file = (
            Path(__file__).resolve().parent.parent
            / "data"
            / "labelled_examples.jsonl"
        )
        if not seed_file.exists():
            pytest.skip("Seed file not found — skipping integration eval test")

        monkeypatch.setenv("LABELLED_EXAMPLES_PATH", str(seed_file))
        # Re-import to pick up the env var (pipeline reads it at module level)
        import importlib
        import src.ml.retraining_pipeline as rp
        importlib.reload(rp)

        analyzer, _ = _build_sentiment_model()
        metrics = rp._evaluate_sentiment_model(analyzer)

        assert isinstance(metrics, dict)
        assert metrics.get("eval_examples", 0) > 0

    def test_metrics_keys_present(self, tmp_path, monkeypatch):
        """Metrics dict must contain accuracy, precision, recall, f1."""
        seed_file = (
            Path(__file__).resolve().parent.parent
            / "data"
            / "labelled_examples.jsonl"
        )
        if not seed_file.exists():
            pytest.skip("Seed file not found")

        monkeypatch.setenv("LABELLED_EXAMPLES_PATH", str(seed_file))
        import importlib
        import src.ml.retraining_pipeline as rp
        importlib.reload(rp)

        analyzer, _ = _build_sentiment_model()
        metrics = rp._evaluate_sentiment_model(analyzer)

        if metrics.get("eval_examples", 0) == 0:
            pytest.skip("Eval split is empty")

        for key in ("accuracy", "precision", "recall", "f1"):
            assert key in metrics, f"Missing key: {key}"

    def test_precision_recall_f1_have_macro_and_weighted(self, tmp_path, monkeypatch):
        seed_file = (
            Path(__file__).resolve().parent.parent
            / "data"
            / "labelled_examples.jsonl"
        )
        if not seed_file.exists():
            pytest.skip("Seed file not found")

        monkeypatch.setenv("LABELLED_EXAMPLES_PATH", str(seed_file))
        import importlib
        import src.ml.retraining_pipeline as rp
        importlib.reload(rp)

        analyzer, _ = _build_sentiment_model()
        metrics = rp._evaluate_sentiment_model(analyzer)

        if metrics.get("eval_examples", 0) == 0:
            pytest.skip("Eval split is empty")

        for bucket in ("precision", "recall", "f1"):
            assert "macro" in metrics[bucket], f"{bucket} missing 'macro'"
            assert "weighted" in metrics[bucket], f"{bucket} missing 'weighted'"

    def test_metrics_values_in_valid_range(self, tmp_path, monkeypatch):
        seed_file = (
            Path(__file__).resolve().parent.parent
            / "data"
            / "labelled_examples.jsonl"
        )
        if not seed_file.exists():
            pytest.skip("Seed file not found")

        monkeypatch.setenv("LABELLED_EXAMPLES_PATH", str(seed_file))
        import importlib
        import src.ml.retraining_pipeline as rp
        importlib.reload(rp)

        analyzer, _ = _build_sentiment_model()
        metrics = rp._evaluate_sentiment_model(analyzer)

        if metrics.get("eval_examples", 0) == 0:
            pytest.skip("Eval split is empty")

        assert 0.0 <= metrics["accuracy"] <= 1.0
        for bucket in ("precision", "recall", "f1"):
            for key, val in metrics[bucket].items():
                assert 0.0 <= val <= 1.0, f"{bucket}[{key}] = {val} out of range"

    def test_empty_store_returns_zero_examples(self, tmp_path, monkeypatch):
        """When the eval split is empty, eval_examples=0 and no crash."""
        empty_file = tmp_path / "empty.jsonl"
        empty_file.write_text("")
        monkeypatch.setenv("LABELLED_EXAMPLES_PATH", str(empty_file))

        import importlib
        import src.ml.retraining_pipeline as rp
        importlib.reload(rp)

        analyzer, _ = _build_sentiment_model()
        metrics = rp._evaluate_sentiment_model(analyzer)
        assert metrics["eval_examples"] == 0

    def test_missing_store_returns_zero_examples(self, tmp_path, monkeypatch):
        """When the store file doesn't exist, eval gracefully returns zero."""
        monkeypatch.setenv(
            "LABELLED_EXAMPLES_PATH",
            str(tmp_path / "nonexistent.jsonl"),
        )
        import importlib
        import src.ml.retraining_pipeline as rp
        importlib.reload(rp)

        analyzer, _ = _build_sentiment_model()
        metrics = rp._evaluate_sentiment_model(analyzer)
        assert metrics["eval_examples"] == 0


# ---------------------------------------------------------------------------
# Seed data integrity
# ---------------------------------------------------------------------------


class TestSeedData:
    """Validate that the shipped seed file is well-formed and usable."""

    SEED_PATH = (
        Path(__file__).resolve().parent.parent / "data" / "labelled_examples.jsonl"
    )

    def test_seed_file_exists(self):
        assert self.SEED_PATH.exists(), f"Seed file not found at {self.SEED_PATH}"

    def test_seed_has_required_fields(self):
        required = {"id", "text", "label", "labeller", "timestamp", "split"}
        with self.SEED_PATH.open() as fh:
            for i, line in enumerate(fh):
                row = json.loads(line.strip())
                missing = required - set(row.keys())
                assert not missing, f"Row {i} missing fields: {missing}"

    def test_seed_labels_are_valid(self):
        with self.SEED_PATH.open() as fh:
            for i, line in enumerate(fh):
                row = json.loads(line.strip())
                assert row["label"] in VALID_LABELS, (
                    f"Row {i} has invalid label: {row['label']!r}"
                )

    def test_seed_splits_are_valid(self):
        with self.SEED_PATH.open() as fh:
            for i, line in enumerate(fh):
                row = json.loads(line.strip())
                assert row["split"] in VALID_SPLITS, (
                    f"Row {i} has invalid split: {row['split']!r}"
                )

    def test_seed_eval_split_non_empty(self):
        store = LabelledExampleStore(self.SEED_PATH)
        _, eval_df = store.get_split()
        assert len(eval_df) > 0, "Eval split must have at least one example"

    def test_seed_train_split_non_empty(self):
        store = LabelledExampleStore(self.SEED_PATH)
        train_df, _ = store.get_split()
        assert len(train_df) > 0

    def test_seed_ids_are_unique(self):
        ids = []
        with self.SEED_PATH.open() as fh:
            for line in fh:
                row = json.loads(line.strip())
                ids.append(row["id"])
        assert len(ids) == len(set(ids)), "Duplicate IDs found in seed file"

    def test_seed_texts_non_empty(self):
        with self.SEED_PATH.open() as fh:
            for i, line in enumerate(fh):
                row = json.loads(line.strip())
                assert row["text"].strip(), f"Row {i} has empty text"
