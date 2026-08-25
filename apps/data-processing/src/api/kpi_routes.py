"""
KPI API Routes for exposing computed protocol metrics.

Provides endpoints for:
- Getting latest KPIs
- Getting KPI history/series
- Triggering KPI recomputation
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel, Field

from src.utils.logger import setup_logger
from src.kpi_computer import KPIComputer, get_current_kpis, get_kpi_history
from src.security import verify_admin_token

logger = setup_logger(__name__)

router = APIRouter(prefix="/api/kpi", tags=["kpi"])


class KPIResponse(BaseModel):
    """Response model for KPI data."""
    tvl: float = Field(..., description="Total Value Locked")
    volume: float = Field(..., description="Cumulative volume")
    active_rounds: int = Field(..., description="Number of active funding rounds")
    contribution_count: int = Field(..., description="Total number of contributions")
    unique_contributors: int = Field(..., description="Number of unique contributors")
    snapshot_date: Optional[str] = Field(None, description="Date of snapshot")
    updated_at: Optional[str] = Field(None, description="Last update timestamp")
    extra_data: Optional[Dict[str, Any]] = Field(None, description="Additional metadata")


class KPISeriesResponse(BaseModel):
    """Response model for KPI time series."""
    date: str = Field(..., description="Date of snapshot")
    tvl: float = Field(..., description="Total Value Locked")
    volume: float = Field(..., description="Cumulative volume")
    active_rounds: int = Field(..., description="Number of active funding rounds")
    contribution_count: int = Field(..., description="Total number of contributions")
    unique_contributors: int = Field(..., description="Number of unique contributors")


class RecomputeResponse(BaseModel):
    """Response model for recompute trigger."""
    success: bool = Field(..., description="Whether recompute was triggered successfully")
    message: str = Field(..., description="Status message")
    task_id: Optional[str] = Field(None, description="Task ID for async jobs")
    result: Optional[Dict[str, Any]] = Field(None, description="Recompute results if sync")


@router.get("/latest", response_model=KPIResponse)
async def get_latest_kpis() -> KPIResponse:
    """
    Get the latest KPI snapshot.

    Returns:
        Latest KPI values or 404 if no data available.
    """
    kpis = get_current_kpis()
    if not kpis:
        raise HTTPException(
            status_code=404,
            detail="No KPI data available. Run recompute first."
        )
    
    return KPIResponse(**kpis)


@router.get("/series", response_model=List[KPISeriesResponse])
async def get_kpi_series(
    start_date: Optional[str] = Query(
        None,
        description="Start date in YYYY-MM-DD format"
    ),
    end_date: Optional[str] = Query(
        None,
        description="End date in YYYY-MM-DD format"
    ),
    period: str = Query(
        "daily",
        description="Period granularity (daily, hourly)"
    ),
) -> List[KPISeriesResponse]:
    """
    Get KPI time series data.

    Args:
        start_date: Start date (inclusive)
        end_date: End date (inclusive)
        period: Time period granularity

    Returns:
        List of KPI snapshots over time.
    """
    # Validate date formats
    if start_date:
        try:
            datetime.strptime(start_date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="start_date must be in YYYY-MM-DD format"
            )
    
    if end_date:
        try:
            datetime.strptime(end_date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="end_date must be in YYYY-MM-DD format"
            )
    
    history = get_kpi_history(start_date=start_date, end_date=end_date)
    
    # Convert to response model
    return [KPISeriesResponse(**item) for item in history]


@router.post("/recompute", response_model=RecomputeResponse)
async def trigger_kpi_recompute(
    contract_id: Optional[str] = Query(
        None,
        description="Contract ID to recompute (uses default if not specified)"
    ),
    from_raw: bool = Query(
        False,
        description="Recompute from raw events (slower but more accurate)"
    ),
    admin: bool = Depends(verify_admin_token),
) -> RecomputeResponse:
    """
    Trigger KPI recomputation from events.

    Admin-only endpoint for rebuilding KPI data when ingestion logic changes.
    """
    if not admin:
        raise HTTPException(
            status_code=403,
            detail="Admin access required"
        )
    
    try:
        computer = KPIComputer(contract_id=contract_id)
        
        if from_raw:
            # Recompute from raw events (full rebuild)
            final_state, series = computer.recompute_from_raw_events(
                persist=True
            )
            result = {
                "final_state": final_state.to_dict(),
                "series_count": len(series),
            }
            message = "KPI recompute from raw events completed successfully"
        else:
            # Incremental recompute from contract events
            final_state, series = computer.compute_kpis(
                force_recompute=True,
                persist=True
            )
            result = {
                "final_state": final_state.to_dict(),
                "series_count": len(series),
            }
            message = "KPI recompute completed successfully"
        
        return RecomputeResponse(
            success=True,
            message=message,
            result=result,
        )
    
    except Exception as e:
        logger.error(f"KPI recompute failed: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Recompute failed: {str(e)}"
        )


@router.post("/recompute-async", response_model=RecomputeResponse)
async def trigger_kpi_recompute_async(
    contract_id: Optional[str] = Query(
        None,
        description="Contract ID to recompute (uses default if not specified)"
    ),
    from_raw: bool = Query(
        False,
        description="Recompute from raw events (slower but more accurate)"
    ),
    admin: bool = Depends(verify_admin_token),
) -> RecomputeResponse:
    """
    Trigger async KPI recomputation.

    Admin-only endpoint for background recomputation.
    """
    if not admin:
        raise HTTPException(
            status_code=403,
            detail="Admin access required"
        )
    
    # Generate task ID
    task_id = f"kpi_recompute_{int(datetime.now(timezone.utc).timestamp())}"
    
    # Start async task
    asyncio.create_task(
        _run_kpi_recompute_task(task_id, contract_id, from_raw)
    )
    
    return RecomputeResponse(
        success=True,
        message=f"KPI recompute task {task_id} started",
        task_id=task_id,
    )


async def _run_kpi_recompute_task(
    task_id: str,
    contract_id: Optional[str],
    from_raw: bool,
) -> None:
    """Background task for KPI recompute."""
    logger.info(f"Starting KPI recompute task {task_id}")
    try:
        computer = KPIComputer(contract_id=contract_id)
        
        if from_raw:
            final_state, series = computer.recompute_from_raw_events(
                persist=True
            )
            logger.info(
                f"Task {task_id} completed: {len(series)} series points, "
                f"TVL={final_state.tvl}, Volume={final_state.cumulative_volume}"
            )
        else:
            final_state, series = computer.compute_kpis(
                force_recompute=True,
                persist=True
            )
            logger.info(
                f"Task {task_id} completed: {len(series)} series points, "
                f"TVL={final_state.tvl}, Volume={final_state.cumulative_volume}"
            )
    except Exception as e:
        logger.error(f"Task {task_id} failed: {e}")