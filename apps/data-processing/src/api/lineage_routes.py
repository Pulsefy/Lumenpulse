# -*- coding: utf-8 -*-
"""
FastAPI routes for the feature/KPI lineage graph (issue #1254).

``src/lineage/feature_lineage.yaml`` (see ``LINEAGE.md``) is the single
source of truth for how every ML feature and derived KPI is produced. This
router reads that file directly — no separate index is maintained — and
exposes it as a queryable upstream/downstream graph so tracing a KPI back
to its inputs (or forward to its consumers) doesn't require opening the
YAML by hand.

Endpoints
---------
GET /api/lineage/{feature_id}  — lineage graph for one feature/dataset
GET /api/lineage               — list every registered feature/dataset id

See also: Documentation: Data contracts and ownership map between
services (#1073) — this endpoint is the intended machine-readable source
for that work's lineage section.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.lineage.graph import LineageNotFoundError, get_lineage
from src.lineage.manifest import iter_entries, load_manifest

router = APIRouter(prefix="/api/lineage", tags=["Lineage"])


# ---------------------------------------------------------------------------
# Pydantic response models
# ---------------------------------------------------------------------------


class LineageNodeResponse(BaseModel):
    id: str = Field(..., description="Manifest entry id, or the raw external ref")
    kind: str = Field(
        ...,
        description="'ml_feature_set' | 'kpi_dataset' | 'external_source' "
        "(a raw file/module/API reference that isn't itself a manifest entry)",
    )
    display_name: str
    description: Optional[str] = None
    source_system: List[str] = Field(
        default_factory=list,
        description="Where this node's data originates — source table(s) "
        "or source file, or the raw reference itself for external sources.",
    )
    transformation: Optional[str] = Field(
        None, description="Formula, or description, describing how this node is produced."
    )
    owning_module: Optional[str] = Field(None, description="Manifest 'module' value.")
    owner: Optional[str] = Field(None, description="Owning team/individual (email or @handle).")


class LineageEdgeResponse(LineageNodeResponse):
    distance: int = Field(..., description="Hop count from the queried feature/dataset.")


class LineageGraphResponse(BaseModel):
    feature_id: str
    node: LineageNodeResponse
    upstream: List[LineageEdgeResponse] = Field(
        default_factory=list, description="Everything that feeds this node, transitively."
    )
    downstream: List[LineageEdgeResponse] = Field(
        default_factory=list, description="Everything this node feeds, transitively."
    )
    manifest_version: Optional[str] = None


class LineageEntrySummary(BaseModel):
    id: str
    kind: str
    display_name: str
    owner: Optional[str] = None


class LineageListResponse(BaseModel):
    count: int
    entries: List[LineageEntrySummary]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get(
    "",
    response_model=LineageListResponse,
    summary="List every registered feature and KPI dataset",
)
async def list_lineage_entries() -> LineageListResponse:
    """
    Return every ``id`` registered in the lineage manifest, so callers know
    what's valid to pass to ``GET /api/lineage/{feature_id}``.
    """
    manifest = load_manifest()
    entries = [
        LineageEntrySummary(
            id=entry.get("id", ""),
            kind="ml_feature_set" if section == "ml_feature_sets" else "kpi_dataset",
            display_name=entry.get("display_name", entry.get("id", "")),
            owner=entry.get("owner"),
        )
        for section, entry in iter_entries(manifest)
    ]
    return LineageListResponse(count=len(entries), entries=entries)


@router.get(
    "/{feature_id}",
    response_model=LineageGraphResponse,
    summary="Get the upstream/downstream lineage graph for a feature or KPI",
)
async def get_feature_lineage(feature_id: str) -> LineageGraphResponse:
    """
    Return the full upstream and downstream lineage for ``feature_id``,
    read live from ``feature_lineage.yaml``.

    * **upstream** — every source, feature, and KPI (transitively) feeding
      this node, terminating in raw ingestion files where the manifest
      doesn't track a further manifest entry.
    * **downstream** — every feature, KPI, and consuming API endpoint
      (transitively) fed by this node.

    Each node carries its source system, transformation (formula or
    description), and owning module/team so a KPI can be traced back to
    "what produced this and who owns it" without opening the YAML.
    """
    try:
        result: Dict[str, Any] = get_lineage(feature_id)
    except LineageNotFoundError:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No lineage entry found for id={feature_id!r}. "
                "See GET /api/lineage for the list of valid ids."
            ),
        )
    return LineageGraphResponse(**result)
