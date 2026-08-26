# -*- coding: utf-8 -*-
"""
FastAPI routes for the human-labelled sentiment example store.

Endpoints
---------
GET  /api/labels                 — list all examples (with optional filters)
POST /api/labels                 — add a new labelled example
GET  /api/labels/stats           — class counts and split statistics
GET  /api/labels/{example_id}    — retrieve a single example
PUT  /api/labels/{example_id}    — correct/update an existing label
DELETE /api/labels/{example_id}  — remove an example

All mutating endpoints require X-API-Key authentication (inherited from the
server's ``setup_security_middleware``).
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from src.ml.labelled_example_store import (
    LabelledExampleStore,
    VALID_LABELS,
    VALID_SPLITS,
)

router = APIRouter(prefix="/api/labels", tags=["Sentiment Labels"])

# ---------------------------------------------------------------------------
# Store singleton — path override via env var for testability
# ---------------------------------------------------------------------------

_STORE_PATH = Path(
    os.environ.get(
        "LABELLED_EXAMPLES_PATH",
        str(Path(__file__).resolve().parent.parent.parent / "data" / "labelled_examples.jsonl"),
    )
)

_store: Optional[LabelledExampleStore] = None


def _get_store() -> LabelledExampleStore:
    """Return the module-level store singleton, initialising it on first call."""
    global _store
    if _store is None:
        _store = LabelledExampleStore(_STORE_PATH)
    return _store


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class LabelledExampleResponse(BaseModel):
    id: str
    text: str
    label: str
    labeller: str
    timestamp: str
    split: str
    notes: str


class AddLabelRequest(BaseModel):
    text: str = Field(..., min_length=1, description="Raw input text to label")
    label: str = Field(
        ..., description=f"Sentiment label: one of {sorted(VALID_LABELS)}"
    )
    labeller: str = Field("api-user", description="Username of the labeller")
    split: Optional[str] = Field(
        None,
        description=f"Force 'train' or 'eval'. Auto-assigned if omitted.",
    )
    notes: str = Field("", description="Optional free-text annotation")


class CorrectLabelRequest(BaseModel):
    label: str = Field(
        ..., description=f"New sentiment label: one of {sorted(VALID_LABELS)}"
    )
    labeller: str = Field("api-user", description="Username of the corrector")
    notes: str = Field("", description="Optional reason for correction")


class StatsResponse(BaseModel):
    total: int
    train_count: int
    eval_count: int
    class_counts: Dict[str, int]


class ActionResponse(BaseModel):
    success: bool
    message: str
    id: Optional[str] = None


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


def _row_to_response(row: dict) -> LabelledExampleResponse:
    return LabelledExampleResponse(
        id=row["id"],
        text=row["text"],
        label=row["label"],
        labeller=row["labeller"],
        timestamp=row["timestamp"],
        split=row["split"],
        notes=row.get("notes", ""),
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("", response_model=List[LabelledExampleResponse], summary="List labelled examples")
async def list_examples(
    split: Optional[str] = Query(None, description="Filter by split: train | eval"),
    label: Optional[str] = Query(None, description="Filter by label: positive | negative | neutral"),
    limit: int = Query(500, ge=1, le=5000, description="Max results to return"),
) -> List[LabelledExampleResponse]:
    """Return all stored labelled examples, with optional filtering."""
    if split and split not in VALID_SPLITS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"split must be one of {sorted(VALID_SPLITS)}",
        )
    if label and label not in VALID_LABELS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"label must be one of {sorted(VALID_LABELS)}",
        )

    store = _get_store()
    rows = store.list_all()

    if split:
        rows = [r for r in rows if r.get("split") == split]
    if label:
        rows = [r for r in rows if r.get("label") == label]

    return [_row_to_response(r) for r in rows[:limit]]


@router.get("/stats", response_model=StatsResponse, summary="Label store statistics")
async def get_stats() -> StatsResponse:
    """Return class distribution and train/eval split counts."""
    store = _get_store()
    counts = store.class_counts()
    train_df, eval_df = store.get_split()
    return StatsResponse(
        total=len(store),
        train_count=len(train_df),
        eval_count=len(eval_df),
        class_counts=counts,
    )


@router.get("/{example_id}", response_model=LabelledExampleResponse, summary="Get a single example")
async def get_example(example_id: str) -> LabelledExampleResponse:
    """Retrieve a single labelled example by its UUID."""
    store = _get_store()
    row = store.get(example_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Example {example_id!r} not found",
        )
    return _row_to_response(row)


@router.post("", response_model=ActionResponse, status_code=status.HTTP_201_CREATED, summary="Add a labelled example")
async def add_example(req: AddLabelRequest) -> ActionResponse:
    """
    Submit a new labelled example.

    The ``split`` is auto-assigned (80 % train / 20 % eval) based on a
    deterministic hash of the generated UUID if not explicitly provided.
    """
    store = _get_store()
    try:
        eid = store.add(
            text=req.text,
            label=req.label,
            labeller=req.labeller,
            split=req.split,
            notes=req.notes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    row = store.get(eid)
    return ActionResponse(
        success=True,
        message=f"Example added with split={row['split']}",
        id=eid,
    )


@router.put("/{example_id}", response_model=ActionResponse, summary="Correct an existing label")
async def correct_example(
    example_id: str,
    req: CorrectLabelRequest,
) -> ActionResponse:
    """
    Update the label on an existing example (correction workflow).

    Overwrites ``label``, ``labeller``, and ``timestamp``.  The ``split``
    field is never changed by a correction — use DELETE + POST to move an
    example between splits.
    """
    store = _get_store()
    try:
        store.correct(
            example_id=example_id,
            new_label=req.label,
            labeller=req.labeller,
            notes=req.notes,
        )
    except KeyError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Example {example_id!r} not found",
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    return ActionResponse(
        success=True,
        message=f"Example {example_id} updated to label={req.label}",
        id=example_id,
    )


@router.delete("/{example_id}", response_model=ActionResponse, summary="Delete a labelled example")
async def delete_example(example_id: str) -> ActionResponse:
    """Remove a labelled example from the store permanently."""
    store = _get_store()
    try:
        store.delete(example_id)
    except KeyError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Example {example_id!r} not found",
        )
    return ActionResponse(
        success=True,
        message=f"Example {example_id} deleted",
        id=example_id,
    )
