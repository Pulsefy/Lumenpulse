"""
Account Operation API Routes

Provides endpoints for:
- Ingesting account operations
- Getting ingestion status
- Resetting ingestion cursors
- Querying account operations
"""

from __future__ import annotations

from typing import Optional, List, Dict, Any

from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel, Field

from src.utils.logger import setup_logger
from src.ingestion.account_operation_ingestor import (
    AccountOperationIngestor,
    get_ingestion_status,
)
from src.security import verify_admin_token

logger = setup_logger(__name__)

router = APIRouter(prefix="/api/account-operations", tags=["account-operations"])


class IngestionRequest(BaseModel):
    """Request model for triggering ingestion."""
    account_id: Optional[str] = Field(None, description="Account ID to ingest operations for")
    from_ledger: Optional[int] = Field(None, description="Starting ledger for backfill")
    to_ledger: Optional[int] = Field(None, description="Ending ledger for backfill")
    max_operations: Optional[int] = Field(None, description="Maximum operations to ingest")


class IngestionResponse(BaseModel):
    """Response model for ingestion results."""
    operations_processed: int = Field(..., description="Total operations processed")
    operations_ingested: int = Field(..., description="New operations ingested")
    operations_duplicate: int = Field(..., description="Duplicate operations skipped")
    operations_failed: int = Field(..., description="Failed operations")
    start_ledger: int = Field(..., description="Starting ledger")
    end_ledger: int = Field(..., description="Ending ledger")
    start_time: Optional[str] = Field(None, description="Start time")
    end_time: Optional[str] = Field(None, description="End time")
    duration_seconds: Optional[float] = Field(None, description="Duration in seconds")


class CursorStatusResponse(BaseModel):
    """Response model for cursor status."""
    stream_id: str = Field(..., description="Stream ID")
    last_ingested_ledger: int = Field(..., description="Last ingested ledger")
    safe_ledger: int = Field(..., description="Safe ledger for rollback")
    last_event_id: Optional[str] = Field(None, description="Last event ID")
    status: str = Field(..., description="Status (idle, ingesting, failed)")
    error_message: Optional[str] = Field(None, description="Error message if failed")
    updated_at: Optional[str] = Field(None, description="Last update time")


class ResetCursorRequest(BaseModel):
    """Request model for resetting cursor."""
    account_id: Optional[str] = Field(None, description="Account ID")
    ledger: int = Field(0, description="Ledger to reset to")


class OperationResponse(BaseModel):
    """Response model for account operation."""
    operation_id: str = Field(..., description="Operation ID")
    tx_id: str = Field(..., description="Transaction ID")
    operation_type: str = Field(..., description="Type of operation")
    amount: Optional[float] = Field(None, description="Amount")
    asset_code: Optional[str] = Field(None, description="Asset code")
    asset_issuer: Optional[str] = Field(None, description="Asset issuer")
    to_account: Optional[str] = Field(None, description="Destination account")
    from_account: Optional[str] = Field(None, description="Source account")
    ledger: int = Field(..., description="Ledger sequence")
    created_at: Optional[str] = Field(None, description="Creation time")


@router.post("/ingest", response_model=IngestionResponse)
async def trigger_ingestion(
    request: IngestionRequest,
    admin: bool = Depends(verify_admin_token),
) -> IngestionResponse:
    """
    Trigger ingestion of account operations.
    
    Admin-only endpoint for backfill and incremental ingestion.
    
    Args:
        request: Ingestion parameters
        
    Returns:
        Ingestion statistics
    """
    if not admin:
        raise HTTPException(
            status_code=403,
            detail="Admin access required"
        )
    
    try:
        ingestor = AccountOperationIngestor()
        
        if request.from_ledger is not None:
            # Backfill mode
            stats = ingestor.backfill(
                account_id=request.account_id,
                from_ledger=request.from_ledger,
                to_ledger=request.to_ledger,
                max_operations=request.max_operations,
            )
        else:
            # Incremental mode
            stats = ingestor.ingest_incremental(
                account_id=request.account_id,
                max_operations=request.max_operations,
            )
        
        return IngestionResponse(**stats.to_dict())
        
    except Exception as e:
        logger.error(f"Ingestion failed: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Ingestion failed: {str(e)}"
        )


@router.get("/status", response_model=CursorStatusResponse)
async def get_status(
    account_id: Optional[str] = Query(None, description="Account ID"),
    admin: bool = Depends(verify_admin_token),
) -> CursorStatusResponse:
    """
    Get ingestion status for an account.
    
    Args:
        account_id: Optional account ID
        
    Returns:
        Cursor status
    """
    if not admin:
        raise HTTPException(
            status_code=403,
            detail="Admin access required"
        )
    
    status = get_ingestion_status(account_id)
    return CursorStatusResponse(**status)


@router.post("/reset-cursor", response_model=Dict[str, Any])
async def reset_cursor(
    request: ResetCursorRequest,
    admin: bool = Depends(verify_admin_token),
) -> Dict[str, Any]:
    """
    Reset the ingestion cursor for an account.
    
    Warning: This will cause re-ingestion of operations.
    
    Args:
        request: Reset parameters
        
    Returns:
        Success status
    """
    if not admin:
        raise HTTPException(
            status_code=403,
            detail="Admin access required"
        )
    
    ingestor = AccountOperationIngestor()
    success = ingestor.reset_cursor(
        account_id=request.account_id,
        ledger=request.ledger,
    )
    
    if success:
        return {"success": True, "message": "Cursor reset successfully"}
    else:
        raise HTTPException(
            status_code=500,
            detail="Failed to reset cursor"
        )


@router.get("/operations", response_model=List[OperationResponse])
async def get_operations(
    account_id: str = Query(..., description="Account ID"),
    limit: int = Query(100, ge=1, le=500, description="Maximum operations"),
    from_ledger: Optional[int] = Query(None, description="Starting ledger"),
    to_ledger: Optional[int] = Query(None, description="Ending ledger"),
    admin: bool = Depends(verify_admin_token),
) -> List[OperationResponse]:
    """
    Get account operations from the database.
    
    Args:
        account_id: Account ID
        limit: Maximum number of operations
        from_ledger: Starting ledger
        to_ledger: Ending ledger
        
    Returns:
        List of operations
    """
    if not admin:
        raise HTTPException(
            status_code=403,
            detail="Admin access required"
        )
    
    ingestor = AccountOperationIngestor()
    operations = ingestor.get_account_operations(
        account_id=account_id,
        limit=limit,
        from_ledger=from_ledger,
        to_ledger=to_ledger,
    )
    
    return [OperationResponse(**op) for op in operations]