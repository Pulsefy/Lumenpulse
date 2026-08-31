"""Human-labelled sentiment dataset endpoints (#1241)."""

from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.db.postgres_service import PostgresService

router = APIRouter(prefix="/api/sentiment-labels", tags=["Sentiment Labels"])

try:
    postgres_service = PostgresService()
except Exception:
    postgres_service = None


class SentimentLabelRequest(BaseModel):
    text: str = Field(..., min_length=1)
    label: str
    labeller: str = Field(..., min_length=1)
    is_held_out: bool = False
    timestamp: Optional[datetime] = None


class SentimentLabelResponse(BaseModel):
    id: int
    text: str
    label: str
    labeller: str
    timestamp: str
    is_held_out: bool


def _db() -> PostgresService:
    if postgres_service is None:
        raise HTTPException(status_code=503, detail="Database service unavailable")
    return postgres_service


@router.post("", response_model=SentimentLabelResponse)
async def submit_sentiment_label(body: SentimentLabelRequest) -> SentimentLabelResponse:
    """Submit a label or correct the existing label for identical text."""
    try:
        row = _db().save_sentiment_label(
            text=body.text,
            label=body.label,
            labeller=body.labeller,
            labelled_at=body.timestamp,
            is_held_out=body.is_held_out,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if row is None:
        raise HTTPException(status_code=500, detail="Failed to persist sentiment label")
    return SentimentLabelResponse(**_db()._sentiment_label_dict(row))


@router.put("/{label_id}", response_model=SentimentLabelResponse)
async def correct_sentiment_label(label_id: int, body: SentimentLabelRequest) -> SentimentLabelResponse:
    """Correct a label by updating the canonical text record."""
    db = _db()
    rows = db.get_sentiment_labels(limit=10000)
    existing = next((row for row in rows if row.id == label_id), None)
    if existing is None:
        raise HTTPException(status_code=404, detail="Sentiment label not found")
    row = db.save_sentiment_label(body.text, body.label, body.labeller, body.timestamp, body.is_held_out)
    if row is None:
        raise HTTPException(status_code=500, detail="Failed to correct sentiment label")
    return SentimentLabelResponse(**db._sentiment_label_dict(row))


@router.get("", response_model=List[SentimentLabelResponse])
async def list_sentiment_labels(held_out: Optional[bool] = None, limit: int = 1000) -> List[SentimentLabelResponse]:
    db = _db()
    return [SentimentLabelResponse(**db._sentiment_label_dict(row)) for row in db.get_sentiment_labels(held_out, limit)]
