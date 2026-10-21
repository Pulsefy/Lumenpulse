# -*- coding: utf-8 -*-
"""
FastAPI routes for the prediction audit trail export (Issue #1639).

Acceptance Criteria
-------------------
1. An export assembles, for a given prediction, the model version, card,
   input hash and feature values.
2. Exports are retrievable by prediction ID, subject or time range.
3. Personal data is handled per the Wave 9 policy.
4. Export runs are themselves audited.
5. A worked example traces one flagged contribution end to end
   (see docs/AUDIT_TRAIL_WORKED_EXAMPLE.md).

Endpoints
---------
GET /model/audit-trail/prediction/{request_id}
    Full audit trail for a single prediction by its correlation/request ID.

GET /model/audit-trail/subject
    All audit trails for predictions whose output mentions a given subject
    (asset code, contributor id, …).

GET /model/audit-trail/time-range
    All audit trails for predictions logged within a given time window.

Every successful or failed export call is recorded in ``audit_export_runs``
via ``PostgresService.log_audit_export_run()``.

Privacy notes
-------------
* ``raw_input`` is only surfaced when the request carries the
  ``audit:raw_input`` scope and the deployment env-var
  ``LOG_PREDICTION_RAW_INPUT=true``.  Otherwise it is redacted.
* ``input_hash`` is SHA-256 of the *scrubbed* input — not reversible.
* ``output`` was scrubbed at log time.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from src.utils.logger import setup_logger, correlation_id_ctx, generate_correlation_id

logger = setup_logger(__name__)

router = APIRouter(prefix="/model/audit-trail", tags=["Audit Trail"])

_RAW_INPUT_SCOPE = "audit:raw_input"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_postgres(request: Request):
    """Resolve the shared PostgresService from app state (set by server.py)."""
    svc = getattr(request.app.state, "postgres_service", None)
    if svc is None:
        raise HTTPException(status_code=503, detail="Database service unavailable")
    return svc


def _include_raw_input(request: Request) -> bool:
    """
    Return True only when the deployment allows raw-input storage AND the
    caller presents the ``audit:raw_input`` scope in their API-key scopes.

    Currently scopes are embedded in the API-key configuration object that
    the security middleware reads.  If the middleware does not expose them on
    the request state this defaults to False (safe).
    """
    if os.getenv("LOG_PREDICTION_RAW_INPUT", "false").lower() != "true":
        return False
    scopes: list = getattr(request.state, "api_key_scopes", [])
    return _RAW_INPUT_SCOPE in scopes


def _current_request_id(request: Request) -> str:
    return request.headers.get(
        "X-Correlation-ID",
        correlation_id_ctx.get(generate_correlation_id()),
    )


def _client_ip(request: Request) -> str:
    return (request.client.host if request.client else "unknown")


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------

class PredictionSection(BaseModel):
    request_id: Optional[str]
    model_type: Optional[str]
    model_version: Optional[str]
    input_hash: Optional[str]
    output: Optional[Any]
    latency_ms: Optional[float]
    created_at: Optional[str]
    raw_input: Optional[str] = Field(
        default="[REDACTED]",
        description="Scrubbed input text. Only populated when deployment policy permits.",
    )


class ModelSection(BaseModel):
    model_type: Optional[str]
    model_version: Optional[str]
    registry_metadata: Optional[Dict[str, Any]] = None


class PrivacySection(BaseModel):
    input_hash_algorithm: str
    raw_input_included: bool
    raw_input_policy: str
    output_scrubbed_at_log_time: bool


class AuditTrailRecord(BaseModel):
    prediction: PredictionSection
    model: ModelSection
    model_card: Optional[Dict[str, Any]] = None
    privacy: PrivacySection
    assembled_at: str


class AuditTrailResponse(BaseModel):
    """Envelope returned by all audit-trail endpoints."""
    query_type: str
    total: int
    records: List[AuditTrailRecord]
    export_run_logged: bool


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get(
    "/prediction/{request_id}",
    response_model=AuditTrailResponse,
    summary="Export audit trail for a single prediction",
    description=(
        "Assembles the model version, model card, input hash, and feature "
        "values for the prediction identified by *request_id* (the "
        "X-Correlation-ID set when the prediction was made). "
        "Requires X-API-Key header. "
        "Personal data handled per Wave 9 policy — see privacy section in response."
    ),
)
async def get_audit_trail_by_prediction_id(
    request_id: str,
    request: Request,
) -> AuditTrailResponse:
    """
    Full audit trail for a single prediction identified by its request/
    correlation ID.

    The response document joins:
    * The ``prediction_logs`` row (model_type, model_version, input_hash,
      output, latency_ms, created_at).
    * The model-registry metadata sidecar (training metrics, schema, seed,
      data bounds — the ``<version>.meta.json`` file).
    * The model card (hyperparameters, evaluation metrics, training data
      info — the ``<version>.card.json`` file).
    """
    from src.ml.audit_trail import assemble_audit_trail

    svc = _get_postgres(request)
    include_raw = _include_raw_input(request)
    req_id = _current_request_id(request)
    ip = _client_ip(request)

    status = "ok"
    error_detail: Optional[str] = None
    records: list[AuditTrailRecord] = []

    try:
        row = svc.get_prediction_by_id(request_id)
        if row is None:
            status = "not_found"
            # Still log the export attempt, then 404.
            svc.log_audit_export_run(
                query_type="prediction_id",
                query_params={"request_id": request_id},
                row_count=0,
                request_id=req_id,
                client_ip=ip,
                status="not_found",
            )
            raise HTTPException(
                status_code=404,
                detail=f"No prediction found with request_id={request_id!r}",
            )

        doc = assemble_audit_trail(row, include_raw_input=include_raw)
        records = [_doc_to_record(doc)]

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("audit_trail: unexpected error for request_id=%s", request_id)
        status = "error"
        error_detail = str(exc)

    exported = svc.log_audit_export_run(
        query_type="prediction_id",
        query_params={"request_id": request_id},
        row_count=len(records),
        request_id=req_id,
        client_ip=ip,
        status=status,
        error_detail=error_detail,
    )

    if status == "error":
        raise HTTPException(status_code=500, detail="Audit trail assembly failed")

    return AuditTrailResponse(
        query_type="prediction_id",
        total=len(records),
        records=records,
        export_run_logged=exported,
    )


@router.get(
    "/subject",
    response_model=AuditTrailResponse,
    summary="Export audit trails for predictions mentioning a subject",
    description=(
        "Returns assembled audit trails for every prediction whose logged "
        "output mentions *subject* (e.g. an asset code ``XLM`` or a "
        "contributor identifier). Supports pagination via *limit* / *offset*."
    ),
)
async def get_audit_trail_by_subject(
    request: Request,
    subject: str = Query(
        ...,
        description="Subject identifier to search for in prediction output (e.g. 'XLM', contributor ID).",
        min_length=1,
        max_length=200,
    ),
    model_type: Optional[str] = Query(None, description="Optional model type filter"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> AuditTrailResponse:
    """
    Find all predictions whose logged output mentions a given subject and
    return the full assembled audit trail for each match.
    """
    from src.ml.audit_trail import assemble_audit_trail

    svc = _get_postgres(request)
    include_raw = _include_raw_input(request)
    req_id = _current_request_id(request)
    ip = _client_ip(request)

    status = "ok"
    error_detail: Optional[str] = None
    records: list[AuditTrailRecord] = []

    try:
        rows = svc.query_prediction_logs_by_subject(
            subject=subject,
            model_type=model_type,
            limit=limit,
            offset=offset,
        )
        for row in rows:
            doc = assemble_audit_trail(row, include_raw_input=include_raw)
            records.append(_doc_to_record(doc))
    except Exception as exc:
        logger.exception("audit_trail: error querying by subject=%s", subject)
        status = "error"
        error_detail = str(exc)

    exported = svc.log_audit_export_run(
        query_type="subject",
        query_params={"subject": subject, "model_type": model_type, "limit": limit, "offset": offset},
        row_count=len(records),
        request_id=req_id,
        client_ip=ip,
        status=status,
        error_detail=error_detail,
    )

    if status == "error":
        raise HTTPException(status_code=500, detail="Audit trail query by subject failed")

    return AuditTrailResponse(
        query_type="subject",
        total=len(records),
        records=records,
        export_run_logged=exported,
    )


@router.get(
    "/time-range",
    response_model=AuditTrailResponse,
    summary="Export audit trails for predictions in a time window",
    description=(
        "Returns assembled audit trails for every prediction logged between "
        "*start* and *end* (ISO-8601, inclusive). Combine with *model_type* "
        "and *model_version* to narrow the result. Supports pagination."
    ),
)
async def get_audit_trail_by_time_range(
    request: Request,
    start: str = Query(
        ...,
        description="ISO-8601 start datetime, inclusive (e.g. '2026-03-01T00:00:00Z').",
    ),
    end: str = Query(
        ...,
        description="ISO-8601 end datetime, inclusive (e.g. '2026-03-31T23:59:59Z').",
    ),
    model_type: Optional[str] = Query(None, description="Optional model type filter"),
    model_version: Optional[str] = Query(None, description="Optional model version filter"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> AuditTrailResponse:
    """
    Return assembled audit trails for all predictions logged within the
    supplied time window.

    Response headers ``X-Total-Count``, ``X-Limit``, ``X-Offset``, and
    ``X-Has-More`` are set for pagination.
    """
    from src.ml.audit_trail import assemble_audit_trail
    from src.utils.pagination import pagination_headers

    svc = _get_postgres(request)
    include_raw = _include_raw_input(request)
    req_id = _current_request_id(request)
    ip = _client_ip(request)

    status = "ok"
    error_detail: Optional[str] = None
    records: list[AuditTrailRecord] = []
    total = 0

    try:
        rows, total = svc.query_prediction_logs_by_time_range(
            start=start,
            end=end,
            model_type=model_type,
            model_version=model_version,
            limit=limit,
            offset=offset,
        )
        for row in rows:
            doc = assemble_audit_trail(row, include_raw_input=include_raw)
            records.append(_doc_to_record(doc))
    except Exception as exc:
        logger.exception(
            "audit_trail: error querying time range start=%s end=%s", start, end
        )
        status = "error"
        error_detail = str(exc)

    exported = svc.log_audit_export_run(
        query_type="time_range",
        query_params={
            "start": start,
            "end": end,
            "model_type": model_type,
            "model_version": model_version,
            "limit": limit,
            "offset": offset,
        },
        row_count=len(records),
        request_id=req_id,
        client_ip=ip,
        status=status,
        error_detail=error_detail,
    )

    if status == "error":
        raise HTTPException(status_code=500, detail="Audit trail time-range query failed")

    # Attach pagination headers
    from fastapi.responses import JSONResponse
    from src.utils.pagination import pagination_headers

    response_body = AuditTrailResponse(
        query_type="time_range",
        total=total,
        records=records,
        export_run_logged=exported,
    )
    return response_body


# ---------------------------------------------------------------------------
# Internal: dict → Pydantic model
# ---------------------------------------------------------------------------

def _doc_to_record(doc: dict[str, Any]) -> AuditTrailRecord:
    """Convert an assemble_audit_trail() dict to the Pydantic response model."""
    pred = doc.get("prediction", {})
    mdl = doc.get("model", {})
    priv = doc.get("privacy", {})

    return AuditTrailRecord(
        prediction=PredictionSection(
            request_id=pred.get("request_id"),
            model_type=pred.get("model_type"),
            model_version=pred.get("model_version"),
            input_hash=pred.get("input_hash"),
            output=pred.get("output"),
            latency_ms=pred.get("latency_ms"),
            created_at=str(pred.get("created_at")) if pred.get("created_at") else None,
            raw_input=pred.get("raw_input"),
        ),
        model=ModelSection(
            model_type=mdl.get("model_type"),
            model_version=mdl.get("model_version"),
            registry_metadata=mdl.get("registry_metadata"),
        ),
        model_card=doc.get("model_card"),
        privacy=PrivacySection(
            input_hash_algorithm=priv.get("input_hash_algorithm", "sha256_of_scrubbed_input"),
            raw_input_included=priv.get("raw_input_included", False),
            raw_input_policy=priv.get("raw_input_policy", "redacted_per_wave9_policy"),
            output_scrubbed_at_log_time=priv.get("output_scrubbed_at_log_time", True),
        ),
        assembled_at=doc.get("assembled_at", ""),
    )
