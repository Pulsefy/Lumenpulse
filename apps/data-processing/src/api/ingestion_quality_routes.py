"""FastAPI routes for triggering ingestion quality checks."""

from __future__ import annotations

from typing import Any, Dict, Optional
from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from src.ingestion.stellar_ingestion_checks import run_all_checks
from src.ingestion.ingestion_alerting import (
    get_last_alerting_status,
    run_ingestion_alerting_cycle,
)


router = APIRouter()


class IngestionQualityRunRequest(BaseModel):
    network: str = "testnet"  # "testnet" only in MVP
    asset: str = "XLM"
    ingestion_lag_seconds: int = 300
    duplicate_window_hours: int = 24
    drift_compare_window_hours: int = 24
    drift_ratio_threshold: float = 0.05
    drift_hours: Optional[str] = "24,48"  # comma-separated
    manual_run_id: Optional[str] = None


class IngestionQualityRunResponse(BaseModel):
    schema_version: int
    generated_at: str
    network: str
    asset: str
    manual_run_id: Optional[str] = None
    thresholds: Dict[str, Any]
    summary: Dict[str, Any]
    findings: list[Dict[str, Any]]
    exit_code: int


@router.post("/ingestion/quality/run", response_model=IngestionQualityRunResponse)
async def run_ingestion_quality(req: IngestionQualityRunRequest) -> IngestionQualityRunResponse:
    hours_list = [int(x.strip()) for x in (req.drift_hours or "").split(",") if x.strip()]
    if not hours_list:
        hours_list = [24, 48]

    result = run_all_checks(
        network=req.network,
        asset=req.asset.upper(),
        ingestion_lag_seconds=req.ingestion_lag_seconds,
        dup_window_hours=req.duplicate_window_hours,
        drift_compare_window_hours=req.drift_compare_window_hours,
        drift_ratio_threshold=req.drift_ratio_threshold,
        hours_list=hours_list,
        report_dir="./data/ingestion_reports",
        manual_run_id=req.manual_run_id,
    )

    return IngestionQualityRunResponse(**result)


class IngestionAlertingStatusResponse(BaseModel):
    checked_at: Optional[str] = None
    metrics: list[Dict[str, Any]] = []
    lag_alerts: list[Dict[str, Any]] = []
    recent_source_failures: list[Dict[str, Any]] = []
    healthy: bool = True


@router.get("/ingestion/alerting/status", response_model=IngestionAlertingStatusResponse)
async def get_ingestion_alerting_status() -> IngestionAlertingStatusResponse:
    status = get_last_alerting_status()
    if not status:
        return IngestionAlertingStatusResponse()
    return IngestionAlertingStatusResponse(**status)


@router.post("/ingestion/alerting/run", response_model=IngestionAlertingStatusResponse)
async def run_ingestion_alerting() -> IngestionAlertingStatusResponse:
    result = run_ingestion_alerting_cycle()
    return IngestionAlertingStatusResponse(**result)

