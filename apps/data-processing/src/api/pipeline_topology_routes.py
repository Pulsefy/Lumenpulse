"""Pipeline topology endpoint derived from the scheduler configuration."""

from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from scheduler import AnalyticsScheduler, get_global_scheduler

router = APIRouter(prefix="/api/pipeline", tags=["Pipeline"])


class PipelineStageResponse(BaseModel):
    id: str
    name: str
    dependencies: List[str] = []
    schedule: str
    last_run: Optional[str] = None
    duration_seconds: Optional[float] = None
    outcome: str
    error: Optional[str] = None


@router.get("/topology", response_model=List[PipelineStageResponse])
async def get_pipeline_topology() -> List[PipelineStageResponse]:
    """Expose the scheduler-defined pipeline stages and their derived runtime state."""
    scheduler = get_global_scheduler() or AnalyticsScheduler()
    stages = scheduler.get_pipeline_topology()
    return [PipelineStageResponse(**stage) for stage in stages]
