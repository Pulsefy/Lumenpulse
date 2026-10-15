"""FastAPI routes for entity linking review queue."""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from src.db.postgres_service import PostgresService

router = APIRouter(prefix="/api/review-queue", tags=["Review Queue"])


class ReviewQueueItemResponse(BaseModel):
    id: int
    article_id: str
    stable_entity_id: str
    entity_type: str
    display_name: str
    matched_text: str
    confidence: float
    supporting_evidence: Optional[Dict[str, Any]] = None
    status: str
    corrected_entity_id: Optional[str] = None
    reviewed_at: Optional[str] = None
    created_at: str


class UpdateReviewStatusRequest(BaseModel):
    status: str = Field(..., description="Must be approved, rejected, corrected, or pending")
    corrected_entity_id: Optional[str] = Field(None, description="Optional stable entity ID if status is 'corrected'")


class ActionResponse(BaseModel):
    success: bool
    message: str


try:
    postgres_service = PostgresService()
except Exception:
    postgres_service = None


def get_db():
    if not postgres_service:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database service unavailable",
        )
    return postgres_service


@router.get("", response_model=List[ReviewQueueItemResponse])
async def get_review_queue(
    status: Optional[str] = Query(None, description="Filter queue by status (pending, approved, rejected, corrected)"),
    limit: int = Query(100, ge=1, le=1000),
) -> List[ReviewQueueItemResponse]:
    """Retrieve items from the review queue with optional filters."""
    db_service = get_db()
    items = db_service.get_review_queue(status=status, limit=limit)
    return [
        ReviewQueueItemResponse(
            id=item.id,
            article_id=item.article_id,
            stable_entity_id=item.stable_entity_id,
            entity_type=item.entity_type,
            display_name=item.display_name,
            matched_text=item.matched_text,
            confidence=item.confidence,
            supporting_evidence=item.supporting_evidence,
            status=item.status,
            corrected_entity_id=item.corrected_entity_id,
            reviewed_at=item.reviewed_at.isoformat() if item.reviewed_at else None,
            created_at=item.created_at.isoformat(),
        )
        for item in items
    ]


@router.post("/{review_id}", response_model=ActionResponse)
async def update_item_status(
    review_id: int,
    req: UpdateReviewStatusRequest,
) -> ActionResponse:
    """Update status of a queue item (approve, reject, correct)."""
    db_service = get_db()
    success = db_service.update_review_status(
        review_id=review_id,
        status=req.status,
        corrected_entity_id=req.corrected_entity_id,
    )
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to update item. Ensure review_id exists and status is valid.",
        )
    return ActionResponse(success=True, message=f"Item {review_id} updated to {req.status}")


@router.get("/export", response_model=List[ReviewQueueItemResponse])
async def export_review_queue(
    status: Optional[str] = Query(None, description="Filter by status before exporting"),
) -> List[ReviewQueueItemResponse]:
    """Export the review queue as a structured response."""
    db_service = get_db()
    items = db_service.get_review_queue(status=status, limit=1000)
    return [
        ReviewQueueItemResponse(
            id=item.id,
            article_id=item.article_id,
            stable_entity_id=item.stable_entity_id,
            entity_type=item.entity_type,
            display_name=item.display_name,
            matched_text=item.matched_text,
            confidence=item.confidence,
            supporting_evidence=item.supporting_evidence,
            status=item.status,
            corrected_entity_id=item.corrected_entity_id,
            reviewed_at=item.reviewed_at.isoformat() if item.reviewed_at else None,
            created_at=item.created_at.isoformat(),
        )
        for item in items
    ]


@router.get("/outcomes", response_model=List[Dict[str, Any]])
async def get_reviewed_outcomes() -> List[Dict[str, Any]]:
    """Retrieve all reviewed outcomes (approved/corrected/rejected) for feedback tuning."""
    db_service = get_db()
    return db_service.get_reviewed_outcomes()
