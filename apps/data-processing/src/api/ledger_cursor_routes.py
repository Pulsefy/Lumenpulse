"""
FastAPI routes for ledger cursor operational visibility.

Exposes the persistent cursor state so maintainers can inspect ingestion
progress, identify stuck or failed streams, and trigger recovery without
restarting the process.

Endpoints
---------
GET  /ingestion/cursors              — list all cursor rows
GET  /ingestion/cursors/{stream_id}  — single cursor detail
POST /ingestion/cursors/{stream_id}/resume — reset a "failed" cursor to "idle"
"""

from __future__ import annotations

import os
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src.ingestion.ledger_cursor_store import LedgerCursorStore
from src.ingestion.recovery_coordinator import RecoveryCoordinator

router = APIRouter()


# ---------------------------------------------------------------------------
# Shared store instance (lazily constructed, one per process)
# ---------------------------------------------------------------------------

_store: Optional[LedgerCursorStore] = None


def _get_store() -> LedgerCursorStore:
    global _store
    if _store is None:
        _store = LedgerCursorStore(
            db_url=os.getenv("DATABASE_URL"),
            auto_create_table=False,  # table created by Alembic migration 008
        )
    return _store


# ---------------------------------------------------------------------------
# Pydantic response models
# ---------------------------------------------------------------------------


class CursorResponse(BaseModel):
    stream_id: str
    last_ingested_ledger: int
    safe_ledger: int
    last_event_id: Optional[str]
    status: str
    error_message: Optional[str]
    updated_at: Optional[str]
    created_at: Optional[str]


class CursorListResponse(BaseModel):
    count: int
    cursors: List[CursorResponse]


class ResumeResponse(BaseModel):
    stream_id: str
    resumed_from_ledger: int
    message: str


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get(
    "/ingestion/cursors",
    response_model=CursorListResponse,
    summary="List all ledger cursor rows",
    tags=["Ledger Cursors"],
)
async def list_cursors() -> CursorListResponse:
    """
    Return the full inventory of persistent ledger cursors.

    Each row represents one ingestion stream.  Use this endpoint to verify
    that all expected streams are active and no stream is stuck in
    ``"failed"`` or ``"ingesting"`` status longer than expected.
    """
    store = _get_store()
    rows = store.list_cursors()
    return CursorListResponse(
        count=len(rows),
        cursors=[CursorResponse(**r) for r in rows],
    )


@router.get(
    "/ingestion/cursors/{stream_id:path}",
    response_model=CursorResponse,
    summary="Get a single ledger cursor",
    tags=["Ledger Cursors"],
)
async def get_cursor(stream_id: str) -> CursorResponse:
    """
    Return the cursor for a specific *stream_id*.

    ``stream_id`` may contain slashes (e.g. ``contract/CXXX...YYY``); the
    ``:path`` converter captures the full value.
    """
    store = _get_store()
    row = store.get_cursor(stream_id)
    if row is None:
        raise HTTPException(
            status_code=404,
            detail=f"No cursor found for stream_id={stream_id!r}",
        )
    return CursorResponse(**row)


@router.post(
    "/ingestion/cursors/{stream_id:path}/resume",
    response_model=ResumeResponse,
    summary="Reset a failed cursor to idle",
    tags=["Ledger Cursors"],
)
async def resume_cursor(stream_id: str) -> ResumeResponse:
    """
    Reset a ``"failed"`` cursor back to ``"idle"`` so the ingestion loop
    will retry from the last safe ledger.

    This endpoint is idempotent: calling it on a cursor that is already
    ``"idle"`` is a no-op.

    The response includes the ledger number ingestion will resume from so
    maintainers can cross-check against Stellar explorer.
    """
    store = _get_store()

    # Verify the cursor exists before constructing a coordinator.
    existing = store.get_cursor(stream_id)
    if existing is None:
        raise HTTPException(
            status_code=404,
            detail=f"No cursor found for stream_id={stream_id!r}",
        )

    coordinator = RecoveryCoordinator(store=store, stream_id=stream_id)
    resume_ledger = coordinator.resume_from_safe_point()

    return ResumeResponse(
        stream_id=stream_id,
        resumed_from_ledger=resume_ledger,
        message=(
            f"Cursor for '{stream_id}' is now idle; "
            f"ingestion will resume from ledger {resume_ledger}."
        ),
    )
