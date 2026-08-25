# -*- coding: utf-8 -*-
"""
Label store for human-annotated sentiment examples (Issue Wave 8).

Provides typed CRUD operations plus split-aware query helpers so that
the retraining pipeline can fetch the held-out evaluation set cleanly
without accidentally touching training rows.

Usage
-----
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    engine = create_engine("postgresql://...")
    with Session(engine) as session:
        store = LabelStore(session)
        store.add(text="Bitcoin is crashing", label="negative",
                  labeller="alice", split="eval")
        examples = store.get_eval_split()
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from src.db.models import VALID_LABELS, VALID_SPLITS, SentimentLabelledExample

logger = logging.getLogger(__name__)


class LabelValidationError(ValueError):
    """Raised when a supplied label or split value is outside the allowed set."""


class LabelStore:
    """
    Thin repository layer over the ``sentiment_labelled_examples`` table.

    All write operations validate ``label`` and ``split`` against the
    constants defined in ``src.db.models`` so that invalid values are
    rejected before they reach the database.
    """

    def __init__(self, session: Session) -> None:
        self._session = session

    # ------------------------------------------------------------------
    # Write helpers
    # ------------------------------------------------------------------

    def add(
        self,
        *,
        text: str,
        label: str,
        labeller: str = "api",
        split: str = "train",
        correction_note: Optional[str] = None,
    ) -> SentimentLabelledExample:
        """
        Persist a new labelled example.

        Args:
            text: The raw text being labelled.
            label: One of "positive", "negative", "neutral".
            labeller: Who assigned the label (username or service name).
            split: "train" (default) or "eval" (held-out).
            correction_note: Optional context note.

        Returns:
            The newly created ``SentimentLabelledExample`` row.

        Raises:
            LabelValidationError: If *label* or *split* is not in the
                allowed set.
            ValueError: If *text* is empty.
        """
        self._validate(label=label, split=split)
        text = text.strip()
        if not text:
            raise ValueError("text must not be empty")

        row = SentimentLabelledExample(
            text=text,
            label=label,
            labeller=labeller,
            split=split,
            correction_note=correction_note,
            labelled_at=datetime.now(timezone.utc),
        )
        self._session.add(row)
        self._session.flush()
        logger.debug("Added label id=%d label=%s split=%s", row.id, label, split)
        return row

    def correct(
        self,
        example_id: int,
        *,
        new_label: str,
        labeller: str,
        correction_note: Optional[str] = None,
    ) -> SentimentLabelledExample:
        """
        Update the label on an existing example.

        The ``labelled_at`` timestamp is refreshed to the moment of
        correction so the audit trail reflects the most recent action.

        Args:
            example_id: Primary key of the row to update.
            new_label: Replacement label (must be valid).
            labeller: Who is making the correction.
            correction_note: Optional note explaining the correction.

        Returns:
            The updated row.

        Raises:
            LabelValidationError: If *new_label* is not valid.
            KeyError: If no row with *example_id* exists.
        """
        self._validate(label=new_label)
        row = self._get_or_raise(example_id)
        row.label = new_label
        row.labeller = labeller
        row.labelled_at = datetime.now(timezone.utc)
        row.correction_note = correction_note
        self._session.flush()
        logger.debug("Corrected label id=%d new_label=%s by %s", example_id, new_label, labeller)
        return row

    def delete(self, example_id: int) -> None:
        """
        Remove a labelled example by primary key.

        Raises:
            KeyError: If no row with *example_id* exists.
        """
        row = self._get_or_raise(example_id)
        self._session.delete(row)
        self._session.flush()
        logger.debug("Deleted label id=%d", example_id)

    # ------------------------------------------------------------------
    # Read helpers
    # ------------------------------------------------------------------

    def get(self, example_id: int) -> Optional[SentimentLabelledExample]:
        """Return a single example by primary key, or ``None``."""
        return (
            self._session.query(SentimentLabelledExample)
            .filter(SentimentLabelledExample.id == example_id)
            .first()
        )

    def list_all(
        self,
        *,
        split: Optional[str] = None,
        label: Optional[str] = None,
        limit: int = 500,
        offset: int = 0,
    ) -> List[SentimentLabelledExample]:
        """
        Return labelled examples with optional filtering.

        Args:
            split: If given, restrict to ``"train"`` or ``"eval"``.
            label: If given, restrict to examples with this label.
            limit: Maximum rows to return (capped at 1000).
            offset: Pagination offset.
        """
        limit = min(limit, 1000)
        q = self._session.query(SentimentLabelledExample)
        if split:
            q = q.filter(SentimentLabelledExample.split == split)
        if label:
            q = q.filter(SentimentLabelledExample.label == label)
        return q.order_by(SentimentLabelledExample.id).offset(offset).limit(limit).all()

    def get_eval_split(self) -> List[SentimentLabelledExample]:
        """
        Return **all** held-out evaluation examples.

        These rows are strictly excluded from lexicon enrichment; they
        are used only to compute precision, recall, and F1.
        """
        return (
            self._session.query(SentimentLabelledExample)
            .filter(SentimentLabelledExample.split == "eval")
            .order_by(SentimentLabelledExample.id)
            .all()
        )

    def get_train_split(self) -> List[SentimentLabelledExample]:
        """Return all training-eligible examples."""
        return (
            self._session.query(SentimentLabelledExample)
            .filter(SentimentLabelledExample.split == "train")
            .order_by(SentimentLabelledExample.id)
            .all()
        )

    def count_by_split_and_label(self) -> Dict[str, Dict[str, int]]:
        """
        Return a nested dict of counts keyed by split → label.

        Example return value::

            {
                "train": {"positive": 12, "negative": 10, "neutral": 8},
                "eval":  {"positive": 4,  "negative": 3,  "neutral": 3},
            }
        """
        rows = (
            self._session.query(
                SentimentLabelledExample.split,
                SentimentLabelledExample.label,
                func.count(SentimentLabelledExample.id).label("cnt"),
            )
            .group_by(SentimentLabelledExample.split, SentimentLabelledExample.label)
            .all()
        )
        result: Dict[str, Dict[str, int]] = {}
        for split_val, label_val, cnt in rows:
            result.setdefault(split_val, {})[label_val] = cnt
        return result

    def bulk_add(
        self, examples: List[Dict[str, Any]], *, commit: bool = False
    ) -> List[SentimentLabelledExample]:
        """
        Insert multiple labelled examples in a single transaction batch.

        Each element of *examples* must be a dict with at least ``text``
        and ``label`` keys.  Optional keys: ``labeller``, ``split``,
        ``correction_note``.

        Args:
            examples: List of example dicts.
            commit: If ``True``, commit the session after inserting.

        Returns:
            List of the inserted ``SentimentLabelledExample`` rows.
        """
        created: List[SentimentLabelledExample] = []
        for item in examples:
            row = self.add(
                text=item["text"],
                label=item["label"],
                labeller=item.get("labeller", "seed"),
                split=item.get("split", "train"),
                correction_note=item.get("correction_note"),
            )
            created.append(row)
        if commit:
            self._session.commit()
        logger.info("Bulk-added %d labelled examples", len(created))
        return created

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _validate(
        label: Optional[str] = None, split: Optional[str] = None
    ) -> None:
        if label is not None and label not in VALID_LABELS:
            raise LabelValidationError(
                f"Invalid label '{label}'. Must be one of: {sorted(VALID_LABELS)}"
            )
        if split is not None and split not in VALID_SPLITS:
            raise LabelValidationError(
                f"Invalid split '{split}'. Must be one of: {sorted(VALID_SPLITS)}"
            )

    def _get_or_raise(self, example_id: int) -> SentimentLabelledExample:
        row = self.get(example_id)
        if row is None:
            raise KeyError(f"No SentimentLabelledExample found with id={example_id}")
        return row
