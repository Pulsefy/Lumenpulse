"""
FastAPI server to expose sentiment analysis as an HTTP API
for the Node.js backend to consume.
"""

from fastapi import FastAPI, HTTPException, Request, Response, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, Any, Optional, List

# Import your existing SentimentAnalyzer
import sys
import os

# Add parent directory to path to import from src
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from sentiment import SentimentAnalyzer
from src.utils.logger import setup_logger, correlation_id_ctx, generate_correlation_id
from src.utils.metrics import API_FAILURES_TOTAL, generate_latest, CONTENT_TYPE_LATEST
from src.security import (
    security_config,
    setup_security_middleware,
    setup_rate_limiter,
    get_rate_limit_decorator,
)
from src.ml.retraining_pipeline import run_retraining, get_last_run_status
from src.ml.model_registry import get_registry_status

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

@app.middleware("http")
async def metrics_and_logging_middleware(request: Request, call_next):
    corr_id = request.headers.get("X-Correlation-ID", generate_correlation_id())
    correlation_id_ctx.set(corr_id)
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

# Initialize your existing SentimentAnalyzer
sentiment_analyzer = SentimentAnalyzer()


# Request/Response models
class AnalyzeRequest(BaseModel):
    text: str
    asset: Optional[str] = None  # Optional asset filter


class AnalyzeResponse(BaseModel):
    sentiment: float  # compound_score from SentimentResult
    asset_codes: List[str] = []  # Asset codes found in text
    sentiment_label: str = ""  # positive/negative/neutral


class AssetAnalysisResponse(BaseModel):
    asset: str
    sentiment: float
    sentiment_label: str
    analysis_count: int
    asset_distribution: Dict[str, int] = {}
    sentiment_distribution: Dict[str, float] = {}


class HealthResponse(BaseModel):
    status: str
    timestamp: str
    service: str

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
            "POST /analyze": "Analyze text sentiment (requires X-API-Key header)",
            "GET /analyze": "Get asset-specific sentiment analysis (requires X-API-Key header)",
            "POST /analyze-batch": "Batch analyze multiple texts (requires X-API-Key header)",
        },
        "note": "Returns sentiment score between -1 (negative) and 1 (positive)",
        "security": "All endpoints except /health and /metrics require X-API-Key header",
    }


@app.get("/health", response_model=HealthResponse)
@limiter.limit("30/minute") if limiter else lambda x: x
async def health_check(request: Request) -> HealthResponse:
    """Health check endpoint for monitoring"""
    from datetime import datetime

    return HealthResponse(
        status="healthy",
        timestamp=datetime.now().isoformat(),
        service="sentiment-analysis",
    )


@app.post("/analyze", response_model=AnalyzeResponse)
@limiter.limit("50/minute") if limiter else lambda x: x
async def analyze_text(request: AnalyzeRequest, request_context: Request) -> AnalyzeResponse:
    """
    Analyze the sentiment of provided text.

    This endpoint connects to your existing SentimentAnalyzer class
    and returns the compound_score as the sentiment value.

    Args:
        request: Contains the text to analyze and optional asset filter

    Returns:
        sentiment: float between -1 and 1
        asset_codes: List of asset codes found in text
        sentiment_label: positive/negative/neutral
    """
    try:
        # Validate input
        if not request.text or not request.text.strip():
            raise HTTPException(status_code=400, detail="Text cannot be empty")

        # Use your existing SentimentAnalyzer with asset filter
        result = sentiment_analyzer.analyze(request.text, request.asset)

        logger.info(
            f"Analyzed text: '{request.text[:50]}...' -> sentiment: {result.compound_score} | "
            f"asset: {request.asset} | client_ip: {request_context.client.host}"
        )

        # Return enhanced response with asset information
        return AnalyzeResponse(
            sentiment=result.compound_score,
            asset_codes=result.asset_codes,
            sentiment_label=result.sentiment_label,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in sentiment analysis: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@app.get("/analyze", response_model=AssetAnalysisResponse)
@limiter.limit("30/minute") if limiter else lambda x: x
async def get_asset_analysis(
    request_context: Request, 
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
        
        logger.info(f"Requested asset analysis for: {asset} | client_ip: {request_context.client.host}")
        
        # Mock response - replace with actual database query
        return AssetAnalysisResponse(
            asset=asset,
            sentiment=0.0,  # Neutral sentiment as placeholder
            sentiment_label="neutral",
            analysis_count=0,
            asset_distribution={},
            sentiment_distribution={"positive": 0.0, "negative": 0.0, "neutral": 1.0},
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in asset analysis: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


# Optional: Batch analysis endpoint if needed
@app.post("/analyze-batch")
@limiter.limit("10/minute") if limiter else lambda x: x
async def analyze_batch(request_context: Request, texts: list[str], asset: Optional[str] = None) -> Dict[str, Any]:
    """Batch analyze multiple texts with optional asset filter"""
    try:
        if not texts:
            raise HTTPException(status_code=400, detail="Texts list cannot be empty")

        results = sentiment_analyzer.analyze_batch(texts, asset)
        summary = sentiment_analyzer.get_sentiment_summary(results)

        return {
            "results": [r.to_dict() for r in results],
            "summary": summary,
            "count": len(results),
            "asset_filter": asset,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
# Model retraining endpoints (Issue #454)
# ---------------------------------------------------------------------------

class RetrainRequest(BaseModel):
    force: bool = False  # Skip quality gates when True


class RetrainResponse(BaseModel):
    status: str
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    duration_seconds: Optional[float] = None
    models: Dict[str, Any] = {}
    registry: Dict[str, Any] = {}
    error: Optional[str] = None


class ModelStatusResponse(BaseModel):
    last_run: Dict[str, Any]
    registry: Dict[str, Any]


@app.post("/retrain", response_model=RetrainResponse)
@limiter.limit("5/minute") if limiter else lambda x: x
async def trigger_retraining(
    body: RetrainRequest,
    request_context: Request,
) -> RetrainResponse:
    """
    Trigger an immediate model retraining run.

    Runs synchronously in a thread pool so the HTTP response is returned
    only after retraining completes (or fails). For long-running production
    retrains, consider making this async with a task queue.

    Requires X-API-Key header.
    """
    import asyncio

    logger.info(
        f"Retraining triggered via API | force={body.force} | "
        f"client_ip={request_context.client.host}"
    )

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None, lambda: run_retraining(force=body.force)
    )

    return RetrainResponse(**{k: result.get(k) for k in RetrainResponse.model_fields if k in result})


@app.get("/model/status", response_model=ModelStatusResponse)
@limiter.limit("30/minute") if limiter else lambda x: x
async def model_status(request_context: Request) -> ModelStatusResponse:
    """
    Return the current model registry state and last retraining run metadata.

    Requires X-API-Key header.
    """
    return ModelStatusResponse(
        last_run=get_last_run_status(),
        registry=get_registry_status(),
    )
