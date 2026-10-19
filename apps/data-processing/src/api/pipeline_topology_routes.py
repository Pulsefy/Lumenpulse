# -*- coding: utf-8 -*-
"""Pipeline topology endpoint (#1451).

Exposes the scheduled data-processing pipeline - its stages, their schedules
and logical dependencies, and each stage's latest run - so the backend can ask
the service what runs, in what order, and whether a stage is stale, instead of
reading ``src/scheduler.py``.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from src.lineage.dataset_registry import get_registered_datasets
from src.pipeline_run_registry import get_default_registry
from src.pipeline_topology import build_topology, generated_at

router = APIRouter(prefix="/api/pipeline", tags=["Pipeline"])


class StageStatus(BaseModel):
    """One pipeline stage plus the outcome of its most recent run."""

    id: str
    name: str
    schedule: str
    depends_on: List[str]
    # never_run | running | success | failed
    status: str
    last_run: Optional[str] = None
    duration_seconds: Optional[float] = None
    outcome: Optional[str] = None
    error: Optional[str] = None


class PipelineTopologyResponse(BaseModel):
    """The full pipeline topology response."""

    generated_at: str
    stages: List[StageStatus]


class DatasetRegistryEntry(BaseModel):
    """Registry metadata for one data-processing dataset."""

    id: str
    display_name: str
    description: str
    owner: str
    schema_definition: Dict[str, str] = Field(..., alias="schema")
    update_cadence: str
    retention: str
    model_consumers: List[str]
    pipeline_stages: List[str]


class DatasetRegistryResponse(BaseModel):
    """All registered datasets and their operational metadata."""

    generated_at: str
    count: int
    datasets: List[DatasetRegistryEntry]


@router.get("/topology", response_model=PipelineTopologyResponse)
async def get_pipeline_topology() -> PipelineTopologyResponse:
    """Return the pipeline topology: each scheduled stage, its schedule and dependencies, and its latest run (last run, duration, outcome)."""  # noqa: E501
    runs = get_default_registry().get_runs()
    stages = [StageStatus(**stage) for stage in build_topology(runs)]
    return PipelineTopologyResponse(generated_at=generated_at(), stages=stages)


@router.get("/datasets", response_model=DatasetRegistryResponse)
async def get_pipeline_datasets() -> DatasetRegistryResponse:
    """Return the validated dataset inventory and its owners and consumers."""
    datasets: List[Dict[str, Any]] = get_registered_datasets()
    return DatasetRegistryResponse(
        generated_at=generated_at(),
        count=len(datasets),
        datasets=[DatasetRegistryEntry(**dataset) for dataset in datasets],
    )
