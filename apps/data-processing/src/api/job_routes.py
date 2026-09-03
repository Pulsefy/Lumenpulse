"""Async analytics job status endpoint (#1248)."""

from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src.db.postgres_service import PostgresService
from src.jobs.manager import get_job

router = APIRouter(prefix="/api/jobs", tags=["Jobs"])

try:
    postgres_service = PostgresService()
except Exception:
    postgres_service = None


class JobStatusResponse(BaseModel):
    job_id: str
    job_type: str
    status: str  # queued | running | succeeded | failed
    params: Optional[Dict[str, Any]] = None
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    created_at: Optional[str] = None
    started_at: Optional[str] = None
    finished_at: Optional[str] = None


@router.get("/{job_id}", response_model=JobStatusResponse)
async def get_job_status(job_id: str) -> JobStatusResponse:
    """
    Report the status of a job submitted to the async analytics job queue.

    Requires X-API-Key header.
    """
    if postgres_service is None:
        raise HTTPException(status_code=503, detail="Database service unavailable")

    job = get_job(postgres_service, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")

    return JobStatusResponse(**job)
