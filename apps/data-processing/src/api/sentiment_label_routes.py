# -*- coding: utf-8 -*-
"""
FastAPI router: human-labelled sentiment example store (Issue Wave 8).

Endpoints
---------
POST   /api/sentiment-labels/submit
    Submit a new labelled example for a text snippet.

PATCH  /api/sentiment-labels/correct/{example_id}
    Correct (update) the label on an existing example.

GET    /api/sentiment-labels/examples
    List stored examples with optional split/label filtering.
"""

from __future__ import annotations

import logging
import os
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from src.db.label_store import LabelStore, LabelValidationError
from src.db.models import VALID_LABELS, VALID_SPLITS, Base, SentimentLabelledExample

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sentiment-labels", tags=["Sentiment Labels"])

# ---------------------------------------------------------------------------
# Database session factory
# ---------------------------------------------------------------------------

_engine = None


def _get_engine():
    global _engine
    if _engine is None:
        url = os.environ.get("DATABASE_URL", "sqlite:///:memory:")
        _engine = create_engine(url, future=True)
        # Ensure the table exists (idempotent; safe in tests)
        Base.metadata.create_all(_engine, checkfirst=True)
    return _engine


def _get_session() -> Session:
    return Session(_get_engine())


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------


class SubmitLabelRequest(BaseModel):
    """Request body for submitting a new labelled example."""

    model_config = {"str_strip_whitespace": True}

    text: str = Field(..., min_length=1, description="Raw text being labelled")
    label: str = Field(
        ...,
        description="Sentiment label: 'positive', 'negative', or 'neutral'",
    )
    labeller: str = Field(
        default="api",
        description="Username or service account that provided this label",
    )
    split: str = Field(
        default="train",
        description="Dataset split: 'train' (default) or 'eval' (held-out)",
    )
    correction_note: Optional[str] = Field(
        default=None, description="Optional contextual note"
    )

    @field_validator("label")
    @classmethod
    def validate_label(cls, v: str) -> str:
        if v not in VALID_LABELS:
            raise ValueError(
                f"Invalid label '{v}'. Must be one of: {sorted(VALID_LABELS)}"
            )
        return v

    @field_validator("split")
    @classmethod
    def validate_split(cls, v: str) -> str:
        if v not in VALID_SPLITS:
            raise ValueError(
                f"Invalid split '{v}'. Must be one of: {sorted(VALID_SPLITS)}"
            )
        return v


class CorrectLabelRequest(BaseModel):
    """Request body for correcting an existing label."""

    model_config = {"str_strip_whitespace": True}

    new_label: str = Field(
        ...,
        description="Replacement label: 'positive', 'negative', or 'neutral'",
    )
    labeller: str = Field(
        ..., description="Username or service account making the correction"
    )
    correction_note: Optional[str] = Field(
        default=None, description="Reason for the correction"
    )

    @field_validator("new_label")
    @classmethod
    def validate_label(cls, v: str) -> str:
        if v not in VALID_LABELS:
            raise ValueError(
                f"Invalid label '{v}'. Must be one of: {sorted(VALID_LABELS)}"
            )
        return v


class LabelledExampleResponse(BaseModel):
    """Response schema for a single labelled example."""

    id: int
    text: str
    label: str
    labeller: str
    split: str
    correction_note: Optional[str]
    labelled_at: str
    created_at: str


class SubmitResponse(BaseModel):
    success: bool
    id: int
    message: str


class CorrectResponse(BaseModel):
    success: bool
    id: int
    message: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _row_to_response(row: SentimentLabelledExample) -> LabelledExampleResponse:
    return LabelledExampleResponse(
        id=row.id,
        text=row.text,
        label=row.label,
        labeller=row.labeller,
        split=row.split,
        correction_note=row.correction_note,
        labelled_at=row.labelled_at.isoformat() if row.labelled_at else "",
        created_at=row.created_at.isoformat() if row.created_at else "",
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post(
    "/submit",
    response_model=SubmitResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Submit a new labelled example",
)
async def submit_label(req: SubmitLabelRequest) -> SubmitResponse:
    """
    Persist a new human-labelled sentiment example.

    The ``split`` field controls whether the example is eligible for
    lexicon enrichment (``"train"``) or is reserved exclusively for the
    held-out evaluation set (``"eval"``).
    """
    with _get_session() as session:
        store = LabelStore(session)
        try:
            row = store.add(
                text=req.text,
                label=req.label,
                labeller=req.labeller,
                split=req.split,
                correction_note=req.correction_note,
            )
            session.commit()
            logger.info("Submitted label id=%d label=%s split=%s", row.id, req.label, req.split)
            return SubmitResponse(
                success=True,
                id=row.id,
                message=f"Label submitted successfully (id={row.id})",
            )
        except LabelValidationError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
            ) from exc
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
            ) from exc
        except Exception as exc:
            logger.error("Unexpected error submitting label: %s", exc, exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to store label",
            ) from exc


@router.patch(
    "/correct/{example_id}",
    response_model=CorrectResponse,
    summary="Correct the label on an existing example",
)
async def correct_label(
    example_id: int,
    req: CorrectLabelRequest,
) -> CorrectResponse:
    """
    Update the label on an existing labelled example.

    The ``labelled_at`` timestamp is refreshed on each correction so the
    audit trail reflects the most recent update.
    """
    with _get_session() as session:
        store = LabelStore(session)
        try:
            row = store.correct(
                example_id,
                new_label=req.new_label,
                labeller=req.labeller,
                correction_note=req.correction_note,
            )
            session.commit()
            logger.info(
                "Corrected label id=%d new_label=%s by %s",
                row.id,
                req.new_label,
                req.labeller,
            )
            return CorrectResponse(
                success=True,
                id=row.id,
                message=f"Label id={row.id} corrected to '{req.new_label}'",
            )
        except KeyError as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Example id={example_id} not found",
            ) from exc
        except LabelValidationError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
            ) from exc
        except Exception as exc:
            logger.error(
                "Unexpected error correcting label id=%d: %s", example_id, exc, exc_info=True
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to correct label",
            ) from exc


@router.get(
    "/examples",
    response_model=List[LabelledExampleResponse],
    summary="List labelled examples",
)
async def list_examples(
    split: Optional[str] = Query(
        None,
        description="Filter by split: 'train' or 'eval'",
    ),
    label: Optional[str] = Query(
        None,
        description="Filter by label: 'positive', 'negative', or 'neutral'",
    ),
    limit: int = Query(100, ge=1, le=1000, description="Maximum results to return"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
) -> List[LabelledExampleResponse]:
    """
    Retrieve stored labelled examples with optional filtering.

    Use ``split=eval`` to inspect the held-out evaluation set.
    """
    # Validate query params before touching the DB
    if split and split not in VALID_SPLITS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid split '{split}'. Must be one of: {sorted(VALID_SPLITS)}",
        )
    if label and label not in VALID_LABELS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid label '{label}'. Must be one of: {sorted(VALID_LABELS)}",
        )

    with _get_session() as session:
        store = LabelStore(session)
        try:
            rows = store.list_all(
                split=split, label=label, limit=limit, offset=offset
            )
            return [_row_to_response(r) for r in rows]
        except Exception as exc:
            logger.error("Error listing examples: %s", exc, exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to retrieve examples",
            ) from exc
