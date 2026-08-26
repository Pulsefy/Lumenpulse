# -*- coding: utf-8 -*-
"""
Labelled Example Store (Issue: sentiment evaluation pipeline)

Persists human-labelled sentiment examples to a JSONL file so the evaluation
gate in the retraining pipeline has ground truth to measure against.

Each record has the schema:
    {
        "id":        str   — uuid4
        "text":      str   — the raw input text
        "label":     str   — "positive" | "negative" | "neutral"
        "labeller":  str   — who assigned the label (username or "seed")
        "timestamp": str   — ISO-8601 UTC datetime of most-recent label write
        "split":     str   — "train" | "eval"  (eval rows are held out)
        "notes":     str   — optional free-text annotation
    }

Usage
-----
    store = LabelledExampleStore("data/labelled_examples.jsonl")

    example_id = store.add("Bitcoin is surging today", "positive", labeller="alice")
    store.correct(example_id, "positive", labeller="bob")   # update existing row

    train_df, eval_df = store.get_split()
    report  = store.class_counts()
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import pandas as pd

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

VALID_LABELS = frozenset({"positive", "negative", "neutral"})
VALID_SPLITS = frozenset({"train", "eval"})

# Default fraction of examples reserved for evaluation (held out from training).
DEFAULT_EVAL_FRACTION = 0.20


class LabelledExampleStore:
    """
    Thread-unsafe, file-backed store for human-labelled sentiment examples.

    All mutations are append-style: each call re-writes the whole file so that
    the file on disk is always a valid JSONL snapshot.  For concurrent
    multi-process writes, callers should use an external lock.
    """

    def __init__(self, path: str | Path = "data/labelled_examples.jsonl") -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._examples: Dict[str, dict] = {}
        self._load()

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def _load(self) -> None:
        """Read existing examples from disk into memory."""
        if not self.path.exists():
            return
        with self.path.open("r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                    self._examples[row["id"]] = row
                except (json.JSONDecodeError, KeyError):
                    continue

    def _save(self) -> None:
        """Flush the current in-memory state to disk as JSONL."""
        with self.path.open("w", encoding="utf-8") as fh:
            for row in self._examples.values():
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")

    # ------------------------------------------------------------------
    # Mutations
    # ------------------------------------------------------------------

    def add(
        self,
        text: str,
        label: str,
        *,
        labeller: str = "unknown",
        split: Optional[str] = None,
        notes: str = "",
        example_id: Optional[str] = None,
    ) -> str:
        """
        Add a new labelled example.

        The ``split`` is auto-assigned if omitted: approximately
        ``DEFAULT_EVAL_FRACTION`` of examples are placed in the eval set
        using a deterministic hash of the example id.

        Returns the generated (or provided) example id.
        """
        label = label.strip().lower()
        if label not in VALID_LABELS:
            raise ValueError(f"label must be one of {VALID_LABELS}, got {label!r}")

        eid = example_id or str(uuid.uuid4())

        if split is None:
            split = self._auto_split(eid)
        elif split not in VALID_SPLITS:
            raise ValueError(f"split must be one of {VALID_SPLITS}, got {split!r}")

        row = {
            "id": eid,
            "text": text,
            "label": label,
            "labeller": labeller,
            "timestamp": _utcnow(),
            "split": split,
            "notes": notes,
        }
        self._examples[eid] = row
        self._save()
        return eid

    def correct(
        self,
        example_id: str,
        new_label: str,
        *,
        labeller: str = "unknown",
        notes: str = "",
    ) -> None:
        """
        Update the label on an existing example (correction workflow).

        Raises ``KeyError`` if the example does not exist.
        """
        new_label = new_label.strip().lower()
        if new_label not in VALID_LABELS:
            raise ValueError(f"label must be one of {VALID_LABELS}, got {new_label!r}")
        if example_id not in self._examples:
            raise KeyError(f"Example {example_id!r} not found in the store")

        row = self._examples[example_id]
        row["label"] = new_label
        row["labeller"] = labeller
        row["timestamp"] = _utcnow()
        if notes:
            row["notes"] = notes
        self._save()

    def delete(self, example_id: str) -> None:
        """Remove an example entirely."""
        if example_id not in self._examples:
            raise KeyError(f"Example {example_id!r} not found in the store")
        del self._examples[example_id]
        self._save()

    # ------------------------------------------------------------------
    # Queries
    # ------------------------------------------------------------------

    def get(self, example_id: str) -> Optional[dict]:
        """Return a single example dict or None."""
        return self._examples.get(example_id)

    def list_all(self) -> List[dict]:
        """Return all examples as a list of dicts (copies)."""
        return [dict(row) for row in self._examples.values()]

    def to_dataframe(self) -> pd.DataFrame:
        """Return all examples as a pandas DataFrame."""
        rows = self.list_all()
        if not rows:
            return pd.DataFrame(
                columns=["id", "text", "label", "labeller", "timestamp", "split", "notes"]
            )
        return pd.DataFrame(rows)

    def get_split(
        self, eval_fraction: float = DEFAULT_EVAL_FRACTION
    ) -> Tuple[pd.DataFrame, pd.DataFrame]:
        """
        Return (train_df, eval_df) split according to the 'split' field.

        Examples already stamped with a split retain that assignment.
        Any examples whose split field is missing or invalid are reassigned
        via ``_auto_split``.

        The eval set is strictly held out — it must not be used for training.
        """
        df = self.to_dataframe()
        if df.empty:
            empty = pd.DataFrame(
                columns=["id", "text", "label", "labeller", "timestamp", "split", "notes"]
            )
            return empty, empty

        train_mask = df["split"] == "train"
        eval_mask = df["split"] == "eval"
        return df[train_mask].reset_index(drop=True), df[eval_mask].reset_index(drop=True)

    def class_counts(self) -> Dict[str, int]:
        """Return a mapping of {label: count} for all examples."""
        counts: Dict[str, int] = {"positive": 0, "negative": 0, "neutral": 0}
        for row in self._examples.values():
            lbl = row.get("label", "")
            if lbl in counts:
                counts[lbl] += 1
        return counts

    def __len__(self) -> int:
        return len(self._examples)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _auto_split(example_id: str, eval_fraction: float = DEFAULT_EVAL_FRACTION) -> str:
        """
        Deterministically assign a split based on the example id hash.

        Uses the last two hex digits of the uuid's integer representation so
        that the split is stable across restarts.
        """
        slot = int(uuid.UUID(example_id)) % 100
        return "eval" if slot < int(eval_fraction * 100) else "train"


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------


def _utcnow() -> str:
    """Return current UTC time as an ISO-8601 string."""
    return datetime.now(tz=timezone.utc).isoformat()


def load_store(
    path: str | Path = "data/labelled_examples.jsonl",
) -> LabelledExampleStore:
    """Convenience factory that returns a ready-to-use store instance."""
    return LabelledExampleStore(path)
