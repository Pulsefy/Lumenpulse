# -*- coding: utf-8 -*-
"""
FastAPI server to expose sentiment analysis as an HTTP API
for the Node.js backend to consume.
"""

import asyncio
import os
import time
from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI, HTTPException, Request, Response, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict
from typing import Dict, Any, Optional, List
from datetime import datetime

# Import your existing SentimentAnalyzer
import sys
import os

# Add parent directory to path to import from src
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from sentiment import SentimentAnalyzer
from src.config.latency_budget import record_latency
from src.utils.logger import setup_logger, correlation_id_ctx, generate_correlation_id
from src.utils.metrics import API_FAILURES_TOTAL, generate_latest, CONTENT_TYPE_LATEST
from src.security import (
    security_config,
    setup_security_middleware,
    setup_rate_limiter,
    get_rate_limit_decorator,
)
from src.ml.retraining_pipeline import run_retraining, get_last_run_status
from src.ml.model_registry import (
    get_registry_status,
    # Shadow-mode deployment (Issue #1256)
    register_shadow,
    unregister_shadow,
    promote_shadow,
    get_shadow_model,
    get_shadow_version,
    get_shadow_status,
    get_all_shadow_status,
    list_versions,
    get_current_version,
    generate_comparison_report,
    read_comparison_log,
    clear_comparison_log,
    flush_all_comparisons,
    get_live_model,
)
from src.analytics.correlation_engine import CorrelationEngine
from src.db import PostgresService
from src.ingestion.stellar_ingestion_checks import run_all_checks

from src.analytics.sentiment_indicators import SentimentIndicatorMapper, get_legend as sentiment_legend
from src.api.rebuild_routes import router as rebuild_router
from src.api.sentiment_label_routes import router as sentiment_label_router

_indicator_mapper = SentimentIndicatorMapper()

# Initialize structured logger
logger = setup_logger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="Sentiment Analysis API",
    description="Exposes sentiment analysis for Node.js backend integration",
    version="1.0.0",
)

# Setup security middleware (API key authentication)
setup_security_middleware(app)

# Setup rate limiting
limiter = security_config.limiter
if limiter:
    setup_rate_limiter(app, limiter)
    logger.info(f"Rate limiting enabled: {security_config.rate_limit_default}")
else:
    logger.warning("Rate limiting is disabled")

# Add CORS middleware to allow requests from Node.js backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
    ],  # Adjust for your NestJS ports
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Batch inference backpressure configuration (Issue #1240)
# ---------------------------------------------------------------------------
MAX_BATCH_SIZE = int(os.getenv("BATCH_MAX_SIZE", "200"))
MAX_CONCURRENT_BATCHES = int(os.getenv("BATCH_MAX_CONCURRENT", "4"))
_batch_semaphore = asyncio.Semaphore(MAX_CONCURRENT_BATCHES)
_batch_executor = ThreadPoolExecutor(max_workers=MAX_CONCURRENT_BATCHES)


@app.middleware("http")
async def metrics_and_logging_middleware(request: Request, call_next):
    corr_id = request.headers.get("X-Correlation-ID", generate_correlation_id())
    correlation_id_ctx.set(corr_id)
    start_time = time.monotonic()
    try:
        response = await call_next(request)
        if response.status_code >= 500:
            API_FAILURES_TOTAL.labels(method=request.method, endpoint=request.url.path).inc()
        response.headers["X-Correlation-ID"] = corr_id
        return response
    except Exception as e:
        API_FAILURES_TOTAL.labels(method=request.method, endpoint=request.url.path).inc()
        logger.error("Unhandled exception during request processing", exc_info=True)
        raise
    finally:
        # Enforce the documented per-endpoint inference latency budget:
        # breaches are exported as Prometheus metrics for alerting.
        record_latency(
            path=request.url.path,
            method=request.method,
            duration_seconds=time.monotonic() - start_time,
        )


# Initialize your existing SentimentAnalyzer
sentiment_analyzer = SentimentAnalyzer()

# Import and register routers
from src.api.ingestion_quality_routes import router as ingestion_quality_router
from src.api.review_queue_routes import router as review_queue_router
from src.api.ledger_cursor_routes import router as ledger_cursor_router
from src.api.kpi_routes import router as kpi_router
from src.api.account_operation_routes import router as account_operation_router
from src.api.lineage_routes import router as lineage_router
from src.api.job_routes import router as job_router

app.include_router(ingestion_quality_router)
app.include_router(review_queue_router)
app.include_router(ledger_cursor_router)
app.include_router(kpi_router)  # KPI routes for TVL and volume computation
app.include_router(account_operation_router)  # Account operation ingestion
app.include_router(rebuild_router)  # Rebuild routes for admin
app.include_router(sentiment_label_router)
app.include_router(lineage_router)  # Feature/KPI lineage graph (#1254)
app.include_router(job_router)  # Async analytics job status (#1248)


try:
    postgres_service = PostgresService()
except Exception as exc:
    postgres_service = None
    logger.warning("PostgreSQL service unavailable for /news endpoint: %s", exc)


@app.on_event("startup")
async def _reconcile_orphaned_analytics_jobs() -> None:
    """
    Any job still queued/running at startup belongs to a process that died
    before finishing it (#1248) — report the loss instead of leaving it
    stuck forever.
    """
    from src.jobs.manager import reconcile_orphaned_jobs

    reconcile_orphaned_jobs(postgres_service)


import hashlib
from typing import Optional

def _log_prediction(
    request_id: str,
    model_type: str,
    model_version: str,
    input_text: str,
    output: Dict[str, Any],
    latency_ms: float,
):
    """Log prediction to database using PostgresService."""
    if not postgres_service:
        return
        
    try:
        store_raw_input = os.getenv("LOG_PREDICTION_RAW_INPUT", "false").lower() == "true"
        raw_input = input_text if store_raw_input else None
        input_hash = hashlib.sha256(input_text.encode("utf-8")).hexdigest()
        
        postgres_service.log_prediction(
            request_id=request_id,
            model_type=model_type,
            model_version=model_version,
            input_hash=input_hash,
            output=output,
            latency_ms=latency_ms,
            raw_input=raw_input,
        )
    except Exception as e:
        logger.error(f"Failed to log prediction (non-fatal) in helper: {e}")


# ---------------------------------------------------------------------------
# Request/Response models
# ---------------------------------------------------------------------------

class SentimentIndicatorResponse(BaseModel):
    """Visual indicator fields attached to every sentiment-bearing response."""

    score: float
    color: str  # "green" | "red" | "gray"
    hex_color: str  # CSS hex, e.g. "#00C853"
    label: str  # "Bullish" | "Bearish" | "Neutral"
    display_text: str  # e.g. "0.85 Bullish"


class AnalyzeRequest(BaseModel):
    text: str
    asset: Optional[str] = None  # Optional asset filter


class AnalyzeResponse(BaseModel):
    sentiment: float  # compound_score from SentimentResult
    asset_codes: List[str] = []  # Asset codes found in text
    sentiment_label: str = ""  # positive/negative/neutral
    indicator: Optional[SentimentIndicatorResponse] = None  # Visual colour indicator


class AssetAnalysisResponse(BaseModel):
    asset: str
    sentiment: float
    sentiment_label: str
    analysis_count: int
    asset_distribution: Dict[str, int] = {}
    sentiment_distribution: Dict[str, float] = {}
    indicator: Optional[SentimentIndicatorResponse] = None  # Visual colour indicator


class HealthResponse(BaseModel):
    status: str
    timestamp: str
    service: str


class NewsArticleResponse(BaseModel):
    article_id: str
    title: str
    content: Optional[str] = None
    summary: Optional[str] = None
    source: Optional[str] = None
    url: Optional[str] = None
    published_at: Optional[str] = None
    primary_asset: Optional[str] = None
    asset_codes: List[str] = []
    categories: List[str] = []
    keywords: List[str] = []
    detected_entities: List[str] = []
    onchain_entity_links: List[Dict[str, Any]] = []
    sentiment_score: Optional[float] = None  # Raw compound score stored in DB
    sentiment_label: Optional[str] = None  # positive / negative / neutral
    indicator: Optional[SentimentIndicatorResponse] = None  # Visual colour indicator


class ContributorActivityEventResponse(BaseModel):
    event_id: str
    contract_id: str
    project_id: Optional[int] = None
    contributor: Optional[str] = None
    ledger: int
    timestamp: Optional[str] = None
    event_type: Optional[str] = None
    category: str
    amount: Optional[float] = None
    milestone_id: Optional[int] = None
    status: Optional[str] = None
    summary: Optional[str] = None
    topics: List[str] = []
    raw_data: Optional[Dict[str, Any]] = None


class ContributorActivityTimelineResponse(BaseModel):
    contributor: str
    project_id: Optional[int] = None
    events: List[ContributorActivityEventResponse] = []


@app.get("/metrics")
async def metrics():
    """Expose Prometheus metrics"""
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/")
@limiter.limit("20/minute") if limiter else lambda x: x
async def root(request: Request) -> Dict[str, Any]:
    """Root endpoint with API information"""
    return {
        "service": "Sentiment Analysis API",
        "version": "1.0.0",
        "endpoints": {
            "GET /health": "Health check (no auth required)",
            "GET /metrics": "Prometheus metrics (no auth required)",
            "GET /news": "Get recent news with optional ?entity=... filter (requires X-API-Key header)",
            "POST /analyze": "Analyze text sentiment (requires X-API-Key header)",
            "GET /analyze": "Get asset-specific sentiment analysis (requires X-API-Key header)",
            "POST /analyze-batch": "Batch analyze multiple texts (requires X-API-Key header)",
            "GET /contributors/{contributor}/timeline": "Get contributor activity timeline from on-chain events (requires X-API-Key header)",
            "GET /sentiment/legend": "Get colour legend for sentiment indicators (no auth required)",
            # KPI endpoints (Issue #734)
            "GET /api/kpi/latest": "Get latest KPI snapshot (TVL, Volume) (requires X-API-Key header)",
            "GET /api/kpi/series": "Get KPI time series data (requires X-API-Key header)",
            "POST /api/kpi/recompute": "Trigger KPI recompute from events (Admin only, requires X-API-Key header)",
            "POST /api/kpi/recompute-async": "Trigger async KPI recompute (Admin only, requires X-API-Key header)",
            # Account operation endpoints (Issue #743)
            "POST /api/account-operations/ingest": "Ingest account operations from Horizon (Admin only, requires X-API-Key header)",
            "GET /api/account-operations/status": "Get ingestion status (Admin only, requires X-API-Key header)",
            "POST /api/account-operations/reset-cursor": "Reset ingestion cursor (Admin only, requires X-API-Key header)",
            "GET /api/account-operations/operations": "Get account operations from database (Admin only, requires X-API-Key header)",
            # Model management endpoints
            "POST /retrain": "Submit a model retraining run to the async job queue; returns a job_id immediately (Admin only, requires X-API-Key header)",
            "GET /model/status": "Get model registry status (Admin only, requires X-API-Key header)",
            # Async analytics job queue (Issue #1248)
            "GET /api/jobs/{job_id}": "Poll the status/result of a job submitted to /retrain, /correlation/analyze, /correlation/lag-analysis, or /analytics/kpis/daily-snapshots/run (requires X-API-Key header)",
            # Shadow-mode deployment (Issue #1256)
            "POST /model/shadow/register": "Register a candidate model for shadow evaluation (Admin only)",
            "POST /model/shadow/promote": "Promote shadow model to live (Admin only)",
            "POST /model/shadow/unregister": "Remove shadow model without promoting (Admin only)",
            "POST /model/rollback": "Rollback to a previous model version (Admin only)",
            "GET /model/shadow/status": "Get shadow deployment status for all model types (Admin only)",
            "GET /model/shadow/comparison-report": "Get comparison report for shadow vs live (Admin only)",
            "GET /model/shadow/comparison-log": "Get raw comparison log entries (Admin only)",
            "DELETE /model/shadow/comparison-log": "Clear comparison log for a model type (Admin only)",
        },
        "note": "Returns sentiment score between -1 (negative) and 1 (positive)",
        "security": "All endpoints except /health, /metrics, and /sentiment/legend require X-API-Key header",
    }


@app.get("/health", response_model=HealthResponse)
@limiter.limit("30/minute") if limiter else lambda x: x
async def health_check(request: Request) -> HealthResponse:
    """Health check endpoint for monitoring"""
    return HealthResponse(
        status="healthy",
        timestamp=datetime.now().isoformat(),
        service="sentiment-analysis",
    )


@app.get("/news", response_model=List[NewsArticleResponse])
@limiter.limit("30/minute") if limiter else lambda x: x
async def get_news(
    request: Request,
    limit: int = Query(50, ge=1, le=500),
    hours: int = Query(24, ge=1, le=168),
    asset: Optional[str] = Query(None, description="Optional primary asset code filter"),
    entity: Optional[str] = Query(
        None,
        description="Optional detected entity filter (example: Soroban)",
    ),
) -> List[NewsArticleResponse]:
    """Return recent articles with optional asset and entity filters."""
    if postgres_service is None:
        raise HTTPException(status_code=503, detail="Database service unavailable")

    try:
        articles = postgres_service.get_recent_articles(
            limit=limit,
            hours=hours,
            asset=asset,
            entity=entity,
        )

        logger.info(
            "Retrieved %d news articles | hours=%d | asset=%s | entity=%s | client_ip=%s",
            len(articles),
            hours,
            asset,
            entity,
            request.client.host,
        )

        def _build_indicator(
            score: Optional[float],
        ) -> Optional[SentimentIndicatorResponse]:
            if score is None:
                return None
            ind = _indicator_mapper.score_to_indicator(score)
            return SentimentIndicatorResponse(**ind.to_dict())

        return [
            NewsArticleResponse(
                article_id=article.article_id,
                title=article.title,
                content=article.content,
                summary=article.summary,
                source=article.source,
                url=article.url,
                published_at=(
                    article.published_at.isoformat() if article.published_at else None
                ),
                primary_asset=article.primary_asset,
                asset_codes=article.asset_codes or [],
                categories=article.categories or [],
                keywords=article.keywords or [],
                detected_entities=article.detected_entities or [],
                onchain_entity_links=article.onchain_entity_links or [],
                sentiment_score=article.sentiment_score,
                sentiment_label=article.sentiment_label,
                indicator=_build_indicator(article.sentiment_score),
            )
            for article in articles
        ]
    except Exception as exc:
        logger.error("Error retrieving news: %s", str(exc), exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to fetch news articles")


@app.get(
    "/contributors/{contributor}/timeline",
    response_model=ContributorActivityTimelineResponse,
)
@limiter.limit("20/minute") if limiter else lambda x: x
async def get_contributor_activity_timeline(
    request: Request,
    contributor: str,
    project_id: Optional[int] = Query(
        None,
        description="Optional project ID to scope the contributor timeline",
    ),
    limit: int = Query(200, ge=1, le=500),
    ascending: bool = Query(
        True,
        description="Order timeline ascending by timestamp if true, descending otherwise",
    ),
) -> ContributorActivityTimelineResponse:
    """Return a contributor-centric timeline of raw on-chain activity."""
    if postgres_service is None:
        raise HTTPException(status_code=503, detail="Database service unavailable")

    events = postgres_service.get_contributor_activity_timeline(
        contributor=contributor,
        project_id=project_id,
        limit=limit,
        ascending=ascending,
    )

    logger.info(
        "Retrieved contributor timeline for %s | project_id=%s | limit=%d | ascending=%s | client_ip=%s",
        contributor,
        project_id,
        limit,
        ascending,
        request.client.host,
    )

    return ContributorActivityTimelineResponse(
        contributor=contributor,
        project_id=project_id,
        events=[ContributorActivityEventResponse(**event) for event in events],
    )


@app.post("/analyze", response_model=AnalyzeResponse)
@limiter.limit("50/minute") if limiter else lambda x: x
async def analyze_text(body: AnalyzeRequest, request: Request) -> AnalyzeResponse:
    """
    Analyze the sentiment of provided text.
    """
    start_time = time.monotonic()
    try:
        # Validate input
        if not body.text or not body.text.strip():
            raise HTTPException(status_code=400, detail="Text cannot be empty")

        # Use your existing SentimentAnalyzer with asset filter
        result = sentiment_analyzer.analyze(body.text, body.asset)

        logger.info(
            f"Analyzed text: '{body.text[:50]}...' -> sentiment: {result.compound_score} | "
            f"asset: {body.asset} | client_ip: {request.client.host}"
        )

        # Build visual indicator
        ind = _indicator_mapper.score_to_indicator(result.compound_score)

        # Log prediction for auditability
        _log_prediction(
            request_id=correlation_id_ctx.get(generate_correlation_id()),
            model_type="sentiment",
            model_version=get_current_version("sentiment") or "1.0.0",
            input_text=body.text,
            output={
                "sentiment": result.compound_score,
                "asset_codes": result.asset_codes,
                "sentiment_label": result.sentiment_label,
            },
            latency_ms=(time.monotonic() - start_time) * 1000,
        )

        # Return enhanced response with asset information
        return AnalyzeResponse(
            sentiment=result.compound_score,
            asset_codes=result.asset_codes,
            sentiment_label=result.sentiment_label,
            indicator=SentimentIndicatorResponse(**ind.to_dict()),
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in sentiment analysis: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@app.get("/analyze", response_model=AssetAnalysisResponse)
@limiter.limit("30/minute") if limiter else lambda x: x
async def get_asset_analysis(
    request: Request,
    asset: str = Query(..., description="Asset code (e.g., XLM, USDC, BTC)")
) -> AssetAnalysisResponse:
    """
    Get sentiment analysis for a specific asset.
    
    This endpoint provides asset-specific sentiment analysis by filtering
    news and social media content that mentions the specified asset.

    Args:
        asset: Asset code to analyze (e.g., XLM, USDC, BTC)

    Returns:
        Asset-specific sentiment analysis with distribution statistics
    """
    try:
        if not asset or not asset.strip():
            raise HTTPException(status_code=400, detail="Asset code cannot be empty")
        
        asset = asset.upper().strip()
        
        # For now, return a mock response since we need to integrate with actual data sources
        # In a real implementation, this would query the database for recent sentiment data
        # related to the specific asset
        
        logger.info(f"Requested asset analysis for: {asset} | client_ip: {request.client.host}")
        
        # Mock response - replace with actual database query
        mock_score = 0.0
        ind = _indicator_mapper.score_to_indicator(mock_score)
        return AssetAnalysisResponse(
            asset=asset,
            sentiment=mock_score,
            sentiment_label="neutral",
            analysis_count=0,
            asset_distribution={},
            sentiment_distribution={"positive": 0.0, "negative": 0.0, "neutral": 1.0},
            indicator=SentimentIndicatorResponse(**ind.to_dict()),
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in asset analysis: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


# ---------------------------------------------------------------------------
# Batch inference endpoint with backpressure (Issue #1240)
# ---------------------------------------------------------------------------
@app.post("/analyze-batch")
@limiter.limit("10/minute") if limiter else lambda x: x
async def analyze_batch(request: Request, texts: list[str], asset: Optional[str] = None) -> Dict[str, Any]:
    """Batch analyze multiple texts with optional asset filter.

    Backpressure controls:
    - ``MAX_BATCH_SIZE`` (env ``BATCH_MAX_SIZE``, default 200): oversized
      requests are rejected with 413.
    - ``MAX_CONCURRENT_BATCHES`` (env ``BATCH_MAX_CONCURRENT``, default 4):
      concurrent batch work is bounded by an ``asyncio.Semaphore``.
      Requests beyond the bound receive 429 with ``Retry-After``.
    - Per-item error isolation: individual item failures are returned as
      error entries instead of failing the whole batch.
    - Synchronous sentiment analysis is offloaded to a
      ``ThreadPoolExecutor`` so the event loop stays responsive for
      ``/health`` and ``/metrics``.
    """
    start_time = time.monotonic()

    # --- 1. Validate batch size ------------------------------------------------
    if not texts:
        raise HTTPException(status_code=400, detail="Texts list cannot be empty")

    if len(texts) > MAX_BATCH_SIZE:
        raise HTTPException(
            status_code=413,
            detail=(
                f"Batch size {len(texts)} exceeds maximum of {MAX_BATCH_SIZE}. "
                "Please split your request into smaller batches."
            ),
        )

    # --- 2. Acquire concurrency semaphore (backpressure) ----------------------
    if _batch_semaphore.locked():
        logger.warning(
            "Batch concurrency limit reached (%d); rejecting request",
            MAX_CONCURRENT_BATCHES,
        )
        raise HTTPException(
            status_code=429,
            detail="Server is at capacity. Please retry after a short delay.",
            headers={"Retry-After": "5"},
        )

    async with _batch_semaphore:
        # --- 3. Run CPU-bound work off the event loop --------------------------
        loop = asyncio.get_running_loop()

        def _run_batch() -> list:
            return sentiment_analyzer.analyze_batch(texts, asset)

        try:
            results = await loop.run_in_executor(_batch_executor, _run_batch)
        except Exception as e:
            logger.error("Batch inference failed: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail=str(e))

        # --- 4. Per-item error isolation ---------------------------------------
        item_results: list[Dict[str, Any]] = []
        for idx, (text, result) in enumerate(zip(texts, results)):
            try:
                item_results.append({
                    "index": idx,
                    "text": text[:100],
                    "status": "ok",
                    **result.to_dict(),
                })
            except Exception as item_exc:
                logger.warning("Item %d failed: %s", idx, item_exc)
                item_results.append({
                    "index": idx,
                    "text": text[:100] if text else "",
                    "status": "error",
                    "error": str(item_exc),
                })

        # --- 5. Build response -------------------------------------------------
        req_id = correlation_id_ctx.get(generate_correlation_id())
        model_version = get_current_version("sentiment") or "1.0.0"
        latency_ms = (time.monotonic() - start_time) * 1000

        # Log each successful prediction
        for item in item_results:
            if item.get("status") == "ok":
                _log_prediction(
                    request_id=req_id,
                    model_type="sentiment",
                    model_version=model_version,
                    input_text=item.get("text", ""),
                    output={
                        "sentiment": item.get("compound_score", 0),
                        "asset_codes": item.get("asset_codes", []),
                        "sentiment_label": item.get("sentiment_label", "neutral"),
                    },
                    latency_ms=latency_ms / len(texts),
                )

        # Recompute summary from successful items only
        successful = [r for r in results if r is not None]
        summary = sentiment_analyzer.get_sentiment_summary(successful) if successful else {}

        return {
            "results": item_results,
            "summary": summary,
            "count": len(item_results),
            "errors": sum(1 for r in item_results if r.get("status") == "error"),
            "asset_filter": asset,
            "latency_ms": round(latency_ms, 2),
            "concurrency_slots_remaining": MAX_CONCURRENT_BATCHES - _batch_semaphore._value,
        }



@app.get("/sentiment/legend")
async def get_sentiment_legend() -> Dict[str, Any]:
    """
    Return the colour legend that frontend clients use to render
    sentiment badge tooltips.

    No authentication required — purely informational.

    Returns a list of objects with keys:
    - color       : semantic name ("green" | "red" | "gray")
    - hex_color   : CSS hex value
    - label       : human-readable label ("Bullish" | "Bearish" | "Neutral")
    - description : tooltip copy
    - score_range : score boundary description
    """
    return {
        "legend": sentiment_legend(),
        "thresholds": {
            "bullish": "score >= 0.05",
            "bearish": "score <= -0.05",
            "neutral": "-0.05 < score < 0.05",
        },
    }


if __name__ == "__main__":
    import uvicorn

    # Run the server
    uvicorn.run(
        "server:app",
        host="0.0.0.0",  # Listen on all interfaces
        port=8000,  # Default FastAPI port
        reload=True,  # Auto-reload during development
    )


# ---------------------------------------------------------------------------
# Model retraining endpoints (Issue #454; async job queue: #1248)
# ---------------------------------------------------------------------------

class RetrainRequest(BaseModel):
    force: bool = False  # Skip quality gates when True


class ModelStatusResponse(BaseModel):
    last_run: Dict[str, Any]
    registry: Dict[str, Any]


class JobSubmitResponse(BaseModel):
    """Returned immediately by long-running analytics endpoints (#1248)."""

    job_id: str
    job_type: str
    status: str  # queued | running (running means collapsed onto an in-flight job)
    created: bool  # False when this collapsed onto an already in-flight duplicate


@app.post("/retrain", response_model=JobSubmitResponse, status_code=202)
@limiter.limit("5/minute") if limiter else lambda x: x
async def trigger_retraining(
    body: RetrainRequest,
    request: Request,
) -> JobSubmitResponse:
    """
    Submit a model retraining run to the async job queue and return
    immediately with a job identifier. Poll GET /api/jobs/{job_id} for the
    outcome — retraining only ever runs one at a time, so a submission made
    while one is already in flight is collapsed onto that job.

    Requires X-API-Key header.
    """
    from src.jobs.manager import submit_job

    logger.info(
        f"Retraining submitted via API | force={body.force} | "
        f"client_ip={request.client.host}"
    )

    job, created = submit_job(
        postgres_service,
        job_type="retrain",
        idempotency_payload={"singleton": True},
        work_fn=lambda: run_retraining(force=body.force),
    )
    return JobSubmitResponse(
        job_id=job["job_id"], job_type=job["job_type"], status=job["status"], created=created
    )


@app.get("/model/status", response_model=ModelStatusResponse)
@limiter.limit("30/minute") if limiter else lambda x: x
async def model_status(request: Request) -> ModelStatusResponse:
    """
    Return the current model registry state and last retraining run metadata.

    Requires X-API-Key header.
    """
    return ModelStatusResponse(
        last_run=get_last_run_status(),
        registry=get_registry_status(),
    )


# ---------------------------------------------------------------------------
# Shadow-Mode Model Deployment Endpoints (Issue #1256)
# ---------------------------------------------------------------------------


class ShadowRegisterRequest(BaseModel):
    model_type: str  # e.g. "sentiment", "price_predictor"
    version: str     # e.g. "v1.2"


class ShadowRegisterResponse(BaseModel):
    status: str
    model_type: str
    shadow_version: str
    live_version: Optional[str] = None
    message: str


class ShadowPromoteRequest(BaseModel):
    model_type: str


class ShadowPromoteResponse(BaseModel):
    status: str
    model_type: str
    new_live_version: str
    message: str


class ShadowUnregisterResponse(BaseModel):
    status: str
    model_type: str
    message: str


class ShadowStatusResponse(BaseModel):
    model_type: str
    shadow: Optional[Dict[str, Any]] = None
    message: Optional[str] = None


class AllShadowStatusResponse(BaseModel):
    shadows: Dict[str, Any]


class ComparisonReportResponse(BaseModel):
    report: Optional[Dict[str, Any]] = None
    message: Optional[str] = None


class ComparisonLogResponse(BaseModel):
    model_type: str
    window_hours: int
    entries: List[Dict[str, Any]]
    total: int


class RollbackRequest(BaseModel):
    model_type: str
    target_version: Optional[str] = None  # If omitted, rollback to previous version


class RollbackResponse(BaseModel):
    status: str
    model_type: str
    previous_version: Optional[str] = None
    new_version: str
    message: str


@app.post("/model/shadow/register", response_model=ShadowRegisterResponse)
@limiter.limit("10/minute") if limiter else lambda x: x
async def shadow_register(
    body: ShadowRegisterRequest,
    request: Request,
) -> ShadowRegisterResponse:
    """
    Register a saved model version to run in shadow mode.

    The shadow model runs alongside the live model without affecting
    responses.  Both predictions are logged for comparison.

    Requires X-API-Key header.
    """
    live_version = get_current_version(body.model_type)
    if body.version == live_version:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Shadow version ({body.version}) must differ from "
                f"the current live version ({live_version})"
            ),
        )

    available = list_versions(body.model_type)
    if body.version not in available:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Version '{body.version}' not found for '{body.model_type}'. "
                f"Available: {available}"
            ),
        )

    register_shadow(body.model_type, body.version)

    logger.info(
        f"Shadow registered via API | type={body.model_type} "
        f"version={body.version} | client_ip={request.client.host}"
    )

    return ShadowRegisterResponse(
        status="registered",
        model_type=body.model_type,
        shadow_version=body.version,
        live_version=live_version,
        message=(
            f"Shadow model '{body.model_type}@{body.version}' is now running "
            f"alongside '{live_version}'. Predictions are being logged for comparison."
        ),
    )


@app.post("/model/shadow/promote", response_model=ShadowPromoteResponse)
@limiter.limit("10/minute") if limiter else lambda x: x
async def shadow_promote(
    body: ShadowPromoteRequest,
    request: Request,
) -> ShadowPromoteResponse:
    """
    Promote the shadow model to live with zero downtime.

    The shadow version becomes the current live model atomically.
    After promotion the shadow registration is cleared.

    Promote-from-shadow is a single documented operation with implicit
    roll-forward semantics.  To undo, call /model/rollback with the
    previous version.

    Requires X-API-Key header.
    """
    previous_live = get_current_version(body.model_type)
    shadow = get_shadow_version(body.model_type)

    if shadow is None:
        raise HTTPException(
            status_code=400,
            detail=f"No shadow model registered for '{body.model_type}'.",
        )

    promote_shadow(body.model_type)
    new_live = get_current_version(body.model_type)

    logger.info(
        f"Shadow promoted via API | type={body.model_type} "
        f"{previous_live} -> {new_live} | client_ip={request.client.host}"
    )

    return ShadowPromoteResponse(
        status="promoted",
        model_type=body.model_type,
        new_live_version=new_live or shadow,
        message=(
            f"Shadow model '{body.model_type}@{shadow}' promoted to live "
            f"(was '{previous_live}'). To rollback, POST /model/rollback "
            f"with target_version='{previous_live}'."
        ),
    )


@app.post("/model/shadow/unregister", response_model=ShadowUnregisterResponse)
@limiter.limit("10/minute") if limiter else lambda x: x
async def shadow_unregister(
    body: ShadowPromoteRequest,
    request: Request,
) -> ShadowUnregisterResponse:
    """
    Remove a shadow model registration without promoting it (rollback).

    The shadow model is discarded and the live model remains unchanged.

    Requires X-API-Key header.
    """
    shadow = get_shadow_version(body.model_type)
    if shadow is None:
        raise HTTPException(
            status_code=400,
            detail=f"No shadow model registered for '{body.model_type}'.",
        )

    unregister_shadow(body.model_type)

    logger.info(
        f"Shadow unregistered via API | type={body.model_type} "
        f"was={shadow} | client_ip={request.client.host}"
    )

    return ShadowUnregisterResponse(
        status="unregistered",
        model_type=body.model_type,
        message=(
            f"Shadow model '{body.model_type}@{shadow}' unregistered. "
            f"Live model unchanged."
        ),
    )


@app.post("/model/rollback", response_model=RollbackResponse)
@limiter.limit("10/minute") if limiter else lambda x: x
async def model_rollback(
    body: RollbackRequest,
    request: Request,
) -> RollbackResponse:
    """
    Rollback a model to a specified previous version.

    If target_version is omitted, rolls back to the previous version
    (sorted descending by semver).

    This is the counterpart to promote_shadow: after promoting a shadow
    to live, use this endpoint to revert if needed.

    Requires X-API-Key header.
    """
    previous_live = get_current_version(body.model_type)
    available = list_versions(body.model_type)

    if len(available) < 2:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Only one version available for '{body.model_type}'. "
                f"Cannot rollback."
            ),
        )

    target = body.target_version
    if target is None:
        # Auto-select: the version just before current
        if previous_live and previous_live in available:
            idx = available.index(previous_live)
            if idx > 0:
                target = available[idx - 1]
            else:
                target = available[1] if len(available) > 1 else available[0]
        else:
            target = available[0]

    if target == previous_live:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Target version '{target}' is already the current live version."
            ),
        )

    if target not in available:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Target version '{target}' not found for '{body.model_type}'. "
                f"Available: {available}"
            ),
        )

    # Promote the targeted version
    from src.ml.model_registry import promote_model
    promote_model(body.model_type, target)

    # Also clear any shadow so it doesn't conflict
    if get_shadow_version(body.model_type):
        unregister_shadow(body.model_type)

    logger.info(
        f"Model rolled back via API | type={body.model_type} "
        f"{previous_live} -> {target} | client_ip={request.client.host}"
    )

    return RollbackResponse(
        status="rolled_back",
        model_type=body.model_type,
        previous_version=previous_live,
        new_version=target,
        message=(
            f"Model '{body.model_type}' rolled back from "
            f"'{previous_live}' to '{target}'."
        ),
    )


@app.get("/model/shadow/status", response_model=AllShadowStatusResponse)
@limiter.limit("30/minute") if limiter else lambda x: x
async def shadow_status(request: Request) -> AllShadowStatusResponse:
    """
    Return the current shadow deployment status for all model types.

    Requires X-API-Key header.
    """
    return AllShadowStatusResponse(
        shadows=get_all_shadow_status(),
    )


@app.get("/model/shadow/comparison-report", response_model=ComparisonReportResponse)
@limiter.limit("20/minute") if limiter else lambda x: x
async def shadow_comparison_report(
    request: Request,
    model_type: str = Query(..., description="Model type, e.g. 'sentiment'"),
    window_hours: int = Query(24, ge=1, le=720, description="Time window in hours (1–720)"),
) -> ComparisonReportResponse:
    """
    Generate a comparison report between live and shadow model predictions.

    The report summarizes:
      - Agreement rate (exact match and directional agreement)
      - Divergence patterns across time
      - Latency overhead statistics
      - Timeout occurrences
      - A recommendation on whether to promote

    Requires X-API-Key header.
    """
    try:
        report = generate_comparison_report(
            model_type=model_type,
            window_hours=window_hours,
        )
    except Exception as exc:
        logger.error(f"Comparison report generation failed: {exc}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate comparison report: {exc}",
        )

    if report is None:
        return ComparisonReportResponse(
            report=None,
            message=(
                f"No comparison data available for '{model_type}' "
                f"within the last {window_hours} hours. "
                f"Register a shadow model first with "
                f"POST /model/shadow/register."
            ),
        )

    return ComparisonReportResponse(report=report)


@app.get("/model/shadow/comparison-log", response_model=ComparisonLogResponse)
@limiter.limit("20/minute") if limiter else lambda x: x
async def shadow_comparison_log(
    request: Request,
    model_type: str = Query(..., description="Model type, e.g. 'sentiment'"),
    window_hours: int = Query(24, ge=1, le=720, description="Time window in hours (1–720)"),
    limit: int = Query(1000, ge=1, le=10000),
) -> ComparisonLogResponse:
    """
    Retrieve raw comparison log entries between live and shadow predictions.

    Returns the most recent entries first.

    Requires X-API-Key header.
    """
    entries = read_comparison_log(
        model_type=model_type,
        window_hours=window_hours,
        limit=limit,
    )

    return ComparisonLogResponse(
        model_type=model_type,
        window_hours=window_hours,
        entries=entries,
        total=len(entries),
    )


@app.delete("/model/shadow/comparison-log")
@limiter.limit("5/minute") if limiter else lambda x: x
async def shadow_clear_comparison_log(
    request: Request,
    model_type: str = Query(..., description="Model type, e.g. 'sentiment'"),
) -> Dict[str, str]:
    """
    Clear comparison log for housekeeping.

    Requires X-API-Key header.
    """
    clear_comparison_log(model_type)
    logger.info(
        f"Comparison log cleared via API | type={model_type} | "
        f"client_ip={request.client.host}"
    )
    return {
        "status": "cleared",
        "model_type": model_type,
        "message": f"Comparison log for '{model_type}' has been cleared.",
    }


# ---------------------------------------------------------------------------
# Predictive analytics endpoint (forecast market trends)
# ---------------------------------------------------------------------------

@app.get("/model/prediction-logs")
@limiter.limit("20/minute") if limiter else lambda x: x
async def get_prediction_logs(
    request: Request,
    model_version: str = Query(..., description="Model version to filter by"),
    model_type: Optional[str] = Query(None, description="Optional model type"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> Dict[str, Any]:
    """
    Query prediction logs by model version to isolate suspect outputs.
    Requires X-API-Key header.
    """
    if postgres_service is None:
        raise HTTPException(status_code=503, detail="Database service unavailable")
        
    logs = postgres_service.query_prediction_logs(
        model_version=model_version,
        model_type=model_type,
        limit=limit,
        offset=offset,
    )
    
    return {
        "model_version": model_version,
        "model_type": model_type,
        "count": len(logs),
        "logs": logs
    }


class ForecastResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    predicted_trend_24h: str
    predicted_trend_48h: str
    confidence_24h: float
    confidence_48h: float
    sentiment_velocity: float
    forecast_score_24h: float
    forecast_score_48h: float
    model_backend: str
    data_points_used: int
    generated_at: str
    backtest_confidence: float = 0.0


@app.get("/analytics/forecast", response_model=ForecastResponse)
@limiter.limit("20/minute") if limiter else lambda x: x
async def get_forecast(request: Request) -> ForecastResponse:
    """
    Predict market trends (Bullish / Bearish / Neutral) for the next 24-48 hours.

    Uses historical sentiment data from *analytics.jsonl* to train a
    SentimentForecaster (Prophet when installed, sklearn Ridge otherwise)
    and returns predicted health scores together with a Sentiment Velocity
    value that measures how fast the market mood is changing.

    Requires X-API-Key header.
    """
    import asyncio

    logger.info(f"Forecast requested | client_ip={request.client.host}")
    start_time = time.monotonic()

    def _run_forecast():
        from src.analytics.forecaster import SentimentForecaster

        forecaster = SentimentForecaster()
        return forecaster.run()

    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(None, _run_forecast)
    except Exception as exc:
        logger.error(f"Forecast failed: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Forecast error: {exc}")

    output_dict = result.to_dict()
    _log_prediction(
        request_id=correlation_id_ctx.get(generate_correlation_id()),
        model_type="forecast",
        model_version=output_dict.get("model_backend", "1.0.0"),
        input_text="no_input_get_request",
        output=output_dict,
        latency_ms=(time.monotonic() - start_time) * 1000,
    )

    return ForecastResponse(**output_dict)


# ---------------------------------------------------------------------------
# Correlation Analysis endpoints (Issue #452)
# ---------------------------------------------------------------------------


class CorrelationDataPoint(BaseModel):
    timestamp: str
    score: float


class MetricDataPoint(BaseModel):
    timestamp: str
    value: float


class CorrelationRequest(BaseModel):
    sentiment_data: List[CorrelationDataPoint]
    price_data: Optional[List[MetricDataPoint]] = None
    volume_data: Optional[List[MetricDataPoint]] = None
    lag_hours: int = 0


class LagAnalysisRequest(BaseModel):
    sentiment_data: List[CorrelationDataPoint]
    metric_data: List[MetricDataPoint]
    metric_type: str = "volume"
    max_lag_hours: int = 24


@app.post("/correlation/analyze", response_model=JobSubmitResponse, status_code=202)
@limiter.limit("20/minute") if limiter else lambda x: x
async def analyze_correlation(
    body: CorrelationRequest,
    request: Request,
) -> JobSubmitResponse:
    """
    Submit a correlation analysis between sentiment and price/volume data to
    the async job queue and return immediately with a job identifier.

    Poll GET /api/jobs/{job_id} for the result: price_correlation,
    volume_correlation, and summary (correlation scores -1 to 1 and scatter
    plot data points). Requires X-API-Key header.
    """
    from src.jobs.manager import submit_job

    sentiment_list = [{"timestamp": dp.timestamp, "score": dp.score} for dp in body.sentiment_data]
    price_list = (
        [{"timestamp": dp.timestamp, "value": dp.value} for dp in body.price_data]
        if body.price_data
        else []
    )
    volume_list = (
        [{"timestamp": dp.timestamp, "value": dp.value} for dp in body.volume_data]
        if body.volume_data
        else []
    )

    logger.info(
        f"Correlation analysis submitted | sentiment_points={len(sentiment_list)} | "
        f"price_points={len(price_list)} | volume_points={len(volume_list)} | "
        f"lag_hours={body.lag_hours} | client_ip={request.client.host}"
    )

    def _run() -> Dict[str, Any]:
        start_time = time.monotonic()
        result = CorrelationEngine.full_analysis(
            sentiment_data=sentiment_list,
            price_data=price_list,
            volume_data=volume_list,
            lag_hours=body.lag_hours,
        )
        _log_prediction(
            request_id=correlation_id_ctx.get(generate_correlation_id()),
            model_type="correlation_analysis",
            model_version="1.0.0",
            input_text=body.json(),
            output=result,
            latency_ms=(time.monotonic() - start_time) * 1000,
        )
        return result

    job, created = submit_job(
        postgres_service,
        job_type="correlation_analyze",
        idempotency_payload=body.model_dump(),
        work_fn=_run,
    )
    return JobSubmitResponse(
        job_id=job["job_id"], job_type=job["job_type"], status=job["status"], created=created
    )


@app.post("/correlation/lag-analysis", response_model=JobSubmitResponse, status_code=202)
@limiter.limit("10/minute") if limiter else lambda x: x
async def analyze_lag_correlation(
    body: LagAnalysisRequest,
    request: Request,
) -> JobSubmitResponse:
    """
    Submit a lagged correlation analysis to the async job queue and return
    immediately with a job identifier.

    Poll GET /api/jobs/{job_id} for the result: best_lag_hours,
    best_correlation, lag_analysis, and recommendation. Requires X-API-Key
    header.
    """
    from src.jobs.manager import submit_job

    sentiment_list = [{"timestamp": dp.timestamp, "score": dp.score} for dp in body.sentiment_data]
    metric_list = [{"timestamp": dp.timestamp, "value": dp.value} for dp in body.metric_data]

    logger.info(
        f"Lag correlation analysis submitted | metric_type={body.metric_type} | "
        f"max_lag={body.max_lag_hours}h | client_ip={request.client.host}"
    )

    def _run() -> Dict[str, Any]:
        start_time = time.monotonic()
        result = CorrelationEngine.analyze_with_lags(
            sentiment_data=sentiment_list,
            metric_data=metric_list,
            metric_type=body.metric_type,
            max_lag_hours=body.max_lag_hours,
        )
        _log_prediction(
            request_id=correlation_id_ctx.get(generate_correlation_id()),
            model_type="lag_analysis",
            model_version="1.0.0",
            input_text=body.json(),
            output=result,
            latency_ms=(time.monotonic() - start_time) * 1000,
        )
        return result

    job, created = submit_job(
        postgres_service,
        job_type="correlation_lag_analysis",
        idempotency_payload=body.model_dump(),
        work_fn=_run,
    )
    return JobSubmitResponse(
        job_id=job["job_id"], job_type=job["job_type"], status=job["status"], created=created
    )


# ---------------------------------------------------------------------------
# Daily On-Chain KPI Snapshot Endpoints (#877)
# ---------------------------------------------------------------------------


class DailyKPISnapshotResponse(BaseModel):
    snapshot_date: str
    period: str
    tvl: float
    volume: float
    active_rounds: int
    contribution_count: int
    unique_contributors: int
    extra_data: Optional[Dict[str, Any]] = None
    created_at: Optional[str] = None


@app.get("/analytics/kpis/daily-snapshots", response_model=List[DailyKPISnapshotResponse])
@limiter.limit("30/minute") if limiter else lambda x: x
async def get_daily_kpi_snapshots(
    request: Request,
    start_date: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
    period: str = Query("daily", description="Period type (default: daily)"),
    limit: int = Query(100, ge=1, le=500),
) -> List[DailyKPISnapshotResponse]:
    """
    Retrieve historical daily on-chain KPI snapshots.
    Requires X-API-Key header.
    """
    if postgres_service is None:
        raise HTTPException(status_code=503, detail="Database service unavailable")

    snapshots = postgres_service.get_daily_onchain_kpi_snapshots(
        start_date=start_date,
        end_date=end_date,
        period=period,
        limit=limit,
    )

    return [
        DailyKPISnapshotResponse(
            snapshot_date=s.snapshot_date,
            period=s.period,
            tvl=s.tvl,
            volume=s.volume,
            active_rounds=s.active_rounds,
            contribution_count=s.contribution_count,
            unique_contributors=s.unique_contributors,
            extra_data=s.extra_data,
            created_at=s.created_at.isoformat() if s.created_at else None,
        )
        for s in snapshots
    ]


@app.post("/analytics/kpis/daily-snapshots/run", response_model=JobSubmitResponse, status_code=202)
@limiter.limit("10/minute") if limiter else lambda x: x
async def trigger_daily_kpi_snapshot(
    request: Request,
    target_date: Optional[str] = Query(None, description="Target date (YYYY-MM-DD)"),
    period: str = Query("daily", description="Period identifier"),
) -> JobSubmitResponse:
    """
    Submit generation of a daily on-chain KPI snapshot to the async job
    queue and return immediately with a job identifier. Poll
    GET /api/jobs/{job_id} for the result. Concurrent submissions for the
    same target_date/period are collapsed onto one job; the generator itself
    still skips duplicate snapshot creation if one already exists.

    Requires X-API-Key header.
    """
    from src.analytics.daily_kpi_snapshot import DailyKPISnapshotGenerator
    from src.jobs.manager import submit_job

    def _run() -> Dict[str, Any]:
        generator = DailyKPISnapshotGenerator(db_service=postgres_service)
        return generator.run_snapshot(target_date=target_date, period=period)

    job, created = submit_job(
        postgres_service,
        job_type="daily_kpi_snapshot",
        idempotency_payload={"target_date": target_date, "period": period},
        work_fn=_run,
    )
    return JobSubmitResponse(
        job_id=job["job_id"], job_type=job["job_type"], status=job["status"], created=created
    )