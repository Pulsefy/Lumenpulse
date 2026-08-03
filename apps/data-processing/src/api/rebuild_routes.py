"""
Rebuild API Routes for data-processing service.

Provides endpoints for rebuilding derived datasets when ingestion logic changes.
"""

from __future__ import annotations

from typing import Optional, Dict, Any

from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel, Field

from src.utils.logger import setup_logger
from src.kpi_computer import KPIComputer
from src.security import verify_admin_token

logger = setup_logger(__name__)

router = APIRouter(prefix="/api/rebuild", tags=["rebuild"])


class RebuildRequest(BaseModel):
    """Request model for triggering a rebuild."""
    dataset: str = Field(..., description="Dataset to rebuild")
    contract_id: Optional[str] = Field(None, description="Contract ID to scope rebuild")
    force: bool = Field(False, description="Force rebuild even if in progress")
    idempotency_key: Optional[str] = Field(None, description="Idempotency key")


class RebuildResponse(BaseModel):
    """Response model for rebuild results."""
    status: str = Field(..., description="Status of rebuild")
    total_items: int = Field(0, description="Total items processed")
    processed_items: int = Field(0, description="Items successfully processed")
    failed_items: int = Field(0, description="Items that failed")
    details: Optional[Dict[str, Any]] = Field(None, description="Additional details")


@router.post("/kpi-snapshots", response_model=RebuildResponse)
async def rebuild_kpi_snapshots(
    contract_id: Optional[str] = Query(None, description="Contract ID"),
    admin: bool = Depends(verify_admin_token),
) -> RebuildResponse:
    """
    Rebuild KPI snapshots from raw events.
    
    Admin-only endpoint for rebuilding KPI data when ingestion logic changes.
    """
    if not admin:
        raise HTTPException(
            status_code=403,
            detail="Admin access required"
        )
    
    try:
        computer = KPIComputer(contract_id=contract_id)
        final_state, series = computer.recompute_from_raw_events(
            persist=True
        )
        
        return RebuildResponse(
            status="completed",
            total_items=len(series),
            processed_items=len(series),
            failed_items=0,
            details={
                "final_tvl": float(final_state.tvl),
                "final_volume": float(final_state.cumulative_volume),
                "series_count": len(series),
            },
        )
        
    except Exception as e:
        logger.error(f"KPI snapshot rebuild failed: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Rebuild failed: {str(e)}"
        )


@router.post("/all", response_model=RebuildResponse)
async def rebuild_all(
    contract_id: Optional[str] = Query(None, description="Contract ID"),
    admin: bool = Depends(verify_admin_token),
) -> RebuildResponse:
    """
    Rebuild all derived datasets.
    
    Admin-only endpoint for full rebuild of all datasets.
    """
    if not admin:
        raise HTTPException(
            status_code=403,
            detail="Admin access required"
        )
    
    try:
        # Rebuild KPI snapshots
        computer = KPIComputer(contract_id=contract_id)
        final_state, series = computer.recompute_from_raw_events(
            persist=True
        )
        
        # Rebuild project views would go here
        
        return RebuildResponse(
            status="completed",
            total_items=len(series),
            processed_items=len(series),
            failed_items=0,
            details={
                "rebuild_version": "1.0.0",
                "final_tvl": float(final_state.tvl),
                "final_volume": float(final_state.cumulative_volume),
                "series_count": len(series),
            },
        )
        
    except Exception as e:
        logger.error(f"Full rebuild failed: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Rebuild failed: {str(e)}"
        )