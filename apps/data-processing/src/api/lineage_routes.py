# -*- coding: utf-8 -*-
"""
Lineage API Routes — Feature & KPI lineage graph endpoints.

Implements Issue #1254: expose feature lineage through an API so contributors
and consumers of data contracts can programmatically trace the upstream /
downstream graph for any registered feature set or KPI dataset.

Endpoints
---------
GET /api/lineage/validate
    Run the full manifest validation and return a structured report.  Fails
    (HTTP 422) when the manifest references a source_file that no longer
    exists on disk.

GET /api/lineage
    List every registered entry (ml_feature_sets + kpi_datasets) with a
    short summary suitable for search and navigation.

GET /api/lineage/{name}
    Return the complete lineage graph for a single entry identified by its
    ``id`` field.  The response includes:
    - entry metadata (owner, source, description, formula …)
    - ``upstream``  – resolved nodes that feed this entry
    - ``downstream`` – nodes that consume this entry

The manifest at ``src/lineage/feature_lineage.yaml`` is the single source of
truth; no separate database is required.

Related issue: Data contracts and ownership map #1073
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.utils.logger import setup_logger

logger = setup_logger(__name__)

# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter(prefix="/api/lineage", tags=["lineage"])

# ---------------------------------------------------------------------------
# Manifest helpers
# ---------------------------------------------------------------------------

_MANIFEST_PATH: Path = (
    Path(__file__).resolve().parent.parent / "lineage" / "feature_lineage.yaml"
)
_DATA_PROCESSING_ROOT: Path = Path(__file__).resolve().parent.parent.parent


def _load_manifest() -> Dict[str, Any]:
    """Parse and return the lineage YAML manifest."""
    try:
        with _MANIFEST_PATH.open("r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh)
        if not isinstance(data, dict):
            raise ValueError("Manifest root must be a YAML mapping.")
        return data
    except FileNotFoundError:
        raise HTTPException(
            status_code=503,
            detail=f"Lineage manifest not found at {_MANIFEST_PATH}",
        )
    except yaml.YAMLError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Lineage manifest YAML parse error: {exc}",
        )


def _all_entries(manifest: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Return a flat list of all entries with a ``_section`` annotation."""
    entries: List[Dict[str, Any]] = []
    for entry in manifest.get("ml_feature_sets") or []:
        entries.append({**entry, "_section": "ml_feature_sets"})
    for entry in manifest.get("kpi_datasets") or []:
        entries.append({**entry, "_section": "kpi_datasets"})
    return entries


def _find_entry(
    manifest: Dict[str, Any], name: str
) -> Optional[Dict[str, Any]]:
    """Locate a single entry by its ``id`` field (case-sensitive)."""
    for entry in _all_entries(manifest):
        if entry.get("id") == name:
            return entry
    return None


# ---------------------------------------------------------------------------
# Upstream / downstream extraction helpers
# ---------------------------------------------------------------------------


def _extract_upstream_nodes(entry: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Build a list of upstream nodes for an entry.

    Upstream references live in different places depending on the entry type:
    - ``inputs[*].upstream``  – explicit list on each input field
    - ``features[*].upstream`` – on ML feature set sub-features
    - ``source_file``          – always included as the implementing module
    """
    nodes: List[Dict[str, Any]] = []
    seen: set = set()

    def _add(ref: str, label: str, kind: str = "module") -> None:
        key = (ref, kind)
        if key not in seen:
            seen.add(key)
            nodes.append({"ref": ref, "label": label, "kind": kind})

    # Inputs section (kpi_datasets pattern)
    for inp in entry.get("inputs") or []:
        inp_name = inp.get("name", "")
        upstream_val = inp.get("upstream")
        # upstream can be a string (scalar) or a list
        if isinstance(upstream_val, str):
            upstream_refs = [upstream_val]
        elif isinstance(upstream_val, list):
            upstream_refs = upstream_val
        else:
            upstream_refs = []
        for up in upstream_refs:
            if isinstance(up, str):
                # Cross-reference to another manifest entry (e.g. kpi_datasets.*)
                if up.startswith("ml_feature_sets.") or up.startswith("kpi_datasets."):
                    parts = up.split(".")
                    ref_id = parts[1] if len(parts) > 1 else up
                    _add(ref_id, ref_id, "lineage_entry")
                else:
                    _add(up, f"input:{inp_name}", "module")

    # Features section (ml_feature_sets pattern)
    for feat in entry.get("features") or []:
        feat_name = feat.get("name", "")
        for up in feat.get("upstream") or []:
            if isinstance(up, str):
                _add(up, f"feature:{feat_name}", "module")
        src_table = feat.get("source_table")
        if src_table:
            _add(src_table, f"feature:{feat_name}", "table")

    # The source_file is always the implementing module
    src = entry.get("source_file")
    if src:
        _add(src, "source", "module")

    return nodes


def _extract_downstream_nodes(entry: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Build a list of downstream consumers for an entry.

    Downstream references live in ``downstream`` list on each entry.
    """
    nodes: List[Dict[str, Any]] = []
    seen: set = set()

    for ref in entry.get("downstream") or []:
        if isinstance(ref, str) and ref not in seen:
            seen.add(ref)
            # Strip inline comments like "  (ForecastResult.forecast_score_24h / _48h)"
            # that appear in the YAML after the file path.
            clean_ref = ref.strip()
            # Split on first space followed by "(" to separate path from annotation
            if "  (" in clean_ref:
                clean_ref = clean_ref.split("  (")[0].strip()
            elif " (" in clean_ref:
                clean_ref = clean_ref.split(" (")[0].strip()
            kind = "lineage_entry" if (
                clean_ref.startswith("ml_feature_sets.") or clean_ref.startswith("kpi_datasets.")
            ) else "module"
            label = clean_ref.split("/")[-1] if "/" in clean_ref else clean_ref
            nodes.append({"ref": clean_ref, "label": label, "kind": kind})

    return nodes


def _extract_source_system(entry: Dict[str, Any]) -> str:
    """
    Best-effort identification of the primary source system for an entry.

    Priority:
    1. Any upstream ref that mentions "stellar" → Stellar Blockchain
    2. Any upstream ref that mentions "social" → Social Data
    3. Any upstream ref that mentions "news"   → News Feed
    4. storage table                            → Database
    5. fallback                                 → Internal Pipeline
    """
    all_upstream_text = str(entry).lower()
    if "stellar" in all_upstream_text or "soroban" in all_upstream_text:
        return "Stellar Blockchain"
    if "social_fetcher" in all_upstream_text:
        return "Social Data"
    if "news_fetcher" in all_upstream_text:
        return "News Feed"
    storage = entry.get("storage")
    if storage:
        return "Database"
    return "Internal Pipeline"


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class LineageNode(BaseModel):
    """A single node in an upstream or downstream graph."""

    ref: str = Field(..., description="Module path, table name, or entry id")
    label: str = Field(..., description="Human-readable short label")
    kind: str = Field(
        ...,
        description="Node type: module | table | lineage_entry | external",
    )


class LineageEntrySummary(BaseModel):
    """Brief summary used in list responses."""

    id: str
    display_name: str
    description: str
    owner: str
    source_file: str
    section: str = Field(..., description="ml_feature_sets or kpi_datasets")
    source_system: str


class LineageGraphResponse(BaseModel):
    """Full lineage graph for a single feature or KPI dataset."""

    id: str
    display_name: str
    description: str
    owner: str
    source_file: str
    section: str
    source_system: str = Field(
        ..., description="Primary source system (Stellar Blockchain, Database, …)"
    )
    transformation: Optional[str] = Field(
        None,
        description="Formula or transformation description when available",
    )
    owning_module: str = Field(
        ..., description="The source_file that computes this feature/KPI"
    )
    update_cadence: Optional[str] = None
    storage: Optional[Any] = None
    upstream: List[LineageNode] = Field(
        default_factory=list,
        description="Nodes that feed into this feature/KPI",
    )
    downstream: List[LineageNode] = Field(
        default_factory=list,
        description="Nodes that consume this feature/KPI",
    )
    raw_entry: Dict[str, Any] = Field(
        ...,
        description="Complete raw entry from the manifest for full detail",
    )


class ValidationIssue(BaseModel):
    """A single validation problem found in the manifest."""

    severity: str = Field(..., description="error or warning")
    message: str


class ValidationResponse(BaseModel):
    """Result of running the full manifest validation."""

    valid: bool
    manifest_path: str
    manifest_version: str
    ml_feature_sets_count: int
    kpi_datasets_count: int
    checked_files: bool
    issues: List[ValidationIssue] = Field(default_factory=list)
    missing_source_files: List[str] = Field(
        default_factory=list,
        description="source_file paths that no longer exist on disk",
    )


# ---------------------------------------------------------------------------
# Validation logic (mirrors scripts/validate_lineage.py rules)
# ---------------------------------------------------------------------------

import re

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_HANDLE_RE = re.compile(r"^@\S+$")
_REQUIRED_TOP_KEYS = {"manifest_version", "project", "module"}
_REQUIRED_ENTRY_KEYS = {"id", "display_name", "description", "owner", "source_file"}


def _looks_like_owner(value: str) -> bool:
    return bool(_EMAIL_RE.match(value) or _HANDLE_RE.match(value))


def _run_validation(
    manifest: Dict[str, Any], check_files: bool = True
) -> tuple[bool, List[ValidationIssue], List[str]]:
    """
    Run all manifest validation rules.

    Returns (ok, issues, missing_files).
    A validation failure is triggered when any source_file is missing
    (satisfies acceptance criterion: 'validation check fails when the
    lineage file references a feature that no longer exists').
    """
    issues: List[ValidationIssue] = []
    missing: List[str] = []

    # Rule: required top-level keys
    for key in _REQUIRED_TOP_KEYS:
        if key not in manifest:
            issues.append(
                ValidationIssue(severity="error", message=f"Missing top-level key: '{key}'")
            )

    ml_sets: List[Dict] = manifest.get("ml_feature_sets") or []
    kpi_sets: List[Dict] = manifest.get("kpi_datasets") or []

    if not ml_sets:
        issues.append(
            ValidationIssue(
                severity="error",
                message="'ml_feature_sets' is empty or missing — at least one entry required.",
            )
        )
    if not kpi_sets:
        issues.append(
            ValidationIssue(
                severity="error",
                message="'kpi_datasets' is empty or missing — at least one entry required.",
            )
        )

    all_entries_raw = [("ml_feature_sets", e) for e in ml_sets] + [
        ("kpi_datasets", e) for e in kpi_sets
    ]

    # Rule: required entry keys
    for section, entry in all_entries_raw:
        entry_id = entry.get("id", "<unknown>")
        for key in _REQUIRED_ENTRY_KEYS:
            if key not in entry:
                issues.append(
                    ValidationIssue(
                        severity="error",
                        message=f"[{section}/{entry_id}] Missing required key: '{key}'",
                    )
                )

    # Rule: no duplicate IDs
    seen_ids: set = set()
    for _, entry in all_entries_raw:
        eid = entry.get("id")
        if eid:
            if eid in seen_ids:
                issues.append(
                    ValidationIssue(
                        severity="error",
                        message=f"Duplicate 'id' value: '{eid}'",
                    )
                )
            seen_ids.add(eid)

    # Rule: owner format
    for section, entry in all_entries_raw:
        owner = entry.get("owner", "")
        if owner and not _looks_like_owner(str(owner)):
            issues.append(
                ValidationIssue(
                    severity="warning",
                    message=(
                        f"[{section}/{entry.get('id', '?')}] 'owner' value '{owner}' "
                        "does not look like an email or @handle."
                    ),
                )
            )

    # Rule: source_file existence (acceptance criterion #4)
    if check_files:
        for section, entry in all_entries_raw:
            entry_id = entry.get("id", "<unknown>")
            for file_key in ("source_file", "model_file"):
                fpath = entry.get(file_key)
                if fpath:
                    resolved = _DATA_PROCESSING_ROOT / fpath
                    if not resolved.exists():
                        missing.append(fpath)
                        issues.append(
                            ValidationIssue(
                                severity="error",
                                message=(
                                    f"[{section}/{entry_id}] {file_key} not found on disk: "
                                    f"'{fpath}' — feature '{entry_id}' no longer exists."
                                ),
                            )
                        )

    has_errors = any(i.severity == "error" for i in issues)
    return not has_errors, issues, missing


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/validate",
    response_model=ValidationResponse,
    summary="Validate the feature lineage manifest",
    description=(
        "Runs all manifest validation rules including checking that every "
        "``source_file`` referenced in the manifest actually exists on disk. "
        "Returns HTTP 422 when errors are found so CI pipelines can gate on "
        "this endpoint."
    ),
)
async def validate_lineage() -> ValidationResponse:
    """
    Validate the lineage manifest and check that all source files exist.

    Fails with HTTP 422 when the manifest references a feature or KPI whose
    source_file no longer exists on disk (acceptance criterion #4).
    """
    manifest = _load_manifest()
    ok, issues, missing = _run_validation(manifest, check_files=True)

    response = ValidationResponse(
        valid=ok,
        manifest_path=str(_MANIFEST_PATH),
        manifest_version=str(manifest.get("manifest_version", "unknown")),
        ml_feature_sets_count=len(manifest.get("ml_feature_sets") or []),
        kpi_datasets_count=len(manifest.get("kpi_datasets") or []),
        checked_files=True,
        issues=issues,
        missing_source_files=missing,
    )

    if not ok:
        logger.warning(
            "Lineage manifest validation failed: %d error(s), %d missing file(s)",
            sum(1 for i in issues if i.severity == "error"),
            len(missing),
        )
        raise HTTPException(
            status_code=422,
            detail=response.dict(),
        )

    logger.info(
        "Lineage manifest validation passed: %d ML feature sets, %d KPI datasets",
        response.ml_feature_sets_count,
        response.kpi_datasets_count,
    )
    return response


@router.get(
    "",
    response_model=List[LineageEntrySummary],
    summary="List all registered features and KPI datasets",
    description=(
        "Returns a summary of every entry in the lineage manifest — both "
        "ML feature sets and KPI datasets.  Use this endpoint for navigation "
        "and discovery before querying a specific entry's graph."
    ),
)
async def list_lineage_entries() -> List[LineageEntrySummary]:
    """List all registered ML feature sets and KPI datasets."""
    manifest = _load_manifest()
    entries = _all_entries(manifest)

    result = []
    for entry in entries:
        desc = (entry.get("description") or "").strip().replace("\n", " ")
        result.append(
            LineageEntrySummary(
                id=entry.get("id", ""),
                display_name=entry.get("display_name", ""),
                description=desc,
                owner=entry.get("owner", ""),
                source_file=entry.get("source_file", ""),
                section=entry.get("_section", ""),
                source_system=_extract_source_system(entry),
            )
        )

    logger.info("Returned lineage summary for %d entries", len(result))
    return result


@router.get(
    "/{name}",
    response_model=LineageGraphResponse,
    summary="Get the lineage graph for a named feature or dataset",
    description=(
        "Returns the full upstream/downstream lineage graph for the entry "
        "identified by ``name`` (its ``id`` field in the manifest).  The "
        "response identifies the source system, transformation, owning module, "
        "and all upstream/downstream node references for every node in the graph."
    ),
)
async def get_lineage_graph(name: str) -> LineageGraphResponse:
    """
    Return upstream + downstream lineage graph for a single feature or KPI.

    Path parameter ``name`` must match the ``id`` field in the manifest
    (e.g. ``market_health_score``, ``price_predictor_features``).

    The response includes:
    - ``source_system``: where the raw data originates
    - ``transformation``: formula / algorithm when documented
    - ``owning_module``: the source_file that implements this entry
    - ``upstream``: list of nodes that feed into this entry
    - ``downstream``: list of nodes that consume this entry
    """
    manifest = _load_manifest()
    entry = _find_entry(manifest, name)

    if entry is None:
        # Build helpful error with list of valid IDs
        valid_ids = [e.get("id") for e in _all_entries(manifest) if e.get("id")]
        raise HTTPException(
            status_code=404,
            detail={
                "message": f"No lineage entry found with id='{name}'.",
                "valid_ids": valid_ids,
            },
        )

    upstream = _extract_upstream_nodes(entry)
    downstream = _extract_downstream_nodes(entry)
    source_system = _extract_source_system(entry)

    # Normalise description
    desc = (entry.get("description") or "").strip().replace("\n", " ")

    # Strip internal _section annotation before returning raw_entry
    raw_entry = {k: v for k, v in entry.items() if not k.startswith("_")}

    response = LineageGraphResponse(
        id=entry.get("id", ""),
        display_name=entry.get("display_name", ""),
        description=desc,
        owner=entry.get("owner", ""),
        source_file=entry.get("source_file", ""),
        section=entry.get("_section", ""),
        source_system=source_system,
        transformation=entry.get("formula"),
        owning_module=entry.get("source_file", ""),
        update_cadence=entry.get("update_cadence"),
        storage=entry.get("storage"),
        upstream=upstream,
        downstream=downstream,
        raw_entry=raw_entry,
    )

    logger.info(
        "Lineage graph returned for '%s': %d upstream, %d downstream node(s)",
        name,
        len(upstream),
        len(downstream),
    )
    return response
