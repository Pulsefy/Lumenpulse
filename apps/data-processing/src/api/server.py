"""
FastAPI server to expose sentiment analysis as an HTTP API
for the Node.js backend to consume.
"""

from fastapi import FastAPI, HTTPException, Request, Response, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, Any, Optional, List
from datetime import datetime

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
from src.analytics.correlation_engine import CorrelationEngine
from src.db import PostgresService

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

try:
    postgres_service = PostgresService()
except Exception as exc:
    postgres_service = None
    logger.warning("PostgreSQL service unavailable for /news endpoint: %s", exc)


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
        },
        "note": "Returns sentiment score between -1 (negative) and 1 (positive)",
        "security": "All endpoints except /health and /metrics require X-API-Key header",
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
    request_context: Request,
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
            request_context.client.host,
        )

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
            )
            for article in articles
        ]
    except Exception as exc:
        logger.error("Error retrieving news: %s", str(exc), exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to fetch news articles")


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


# ---------------------------------------------------------------------------
# Predictive analytics endpoint (forecast market trends)
# ---------------------------------------------------------------------------


class ForecastResponse(BaseModel):
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


@app.get("/analytics/forecast", response_model=ForecastResponse)
@limiter.limit("20/minute") if limiter else lambda x: x
async def get_forecast(request_context: Request) -> ForecastResponse:
    """
    Predict market trends (Bullish / Bearish / Neutral) for the next 24-48 hours.

    Uses historical sentiment data from *analytics.jsonl* to train a
    SentimentForecaster (Prophet when installed, sklearn Ridge otherwise)
    and returns predicted health scores together with a Sentiment Velocity
    value that measures how fast the market mood is changing.

    Requires X-API-Key header.
    """
    import asyncio

    logger.info(f"Forecast requested | client_ip={request_context.client.host}")

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

    return ForecastResponse(**result.to_dict())


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


class CorrelationResponse(BaseModel):
    price_correlation: Optional[Dict[str, Any]] = None
    volume_correlation: Optional[Dict[str, Any]] = None
    summary: Dict[str, Any]


class LagAnalysisRequest(BaseModel):
    sentiment_data: List[CorrelationDataPoint]
    metric_data: List[MetricDataPoint]
    metric_type: str = "volume"
    max_lag_hours: int = 24


class LagAnalysisResponse(BaseModel):
    best_lag_hours: int
    best_correlation: float
    lag_analysis: List[Dict[str, Any]]
    recommendation: str


@app.post("/correlation/analyze", response_model=CorrelationResponse)
@limiter.limit("20/minute") if limiter else lambda x: x
async def analyze_correlation(
    body: CorrelationRequest,
    request_context: Request,
) -> CorrelationResponse:
    """
    Analyze correlation between sentiment and price/volume data.

    Returns correlation scores (-1 to 1) and scatter plot data points.
    Requires X-API-Key header.
    """
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
        f"Correlation analysis requested | sentiment_points={len(sentiment_list)} | "
        f"price_points={len(price_list)} | volume_points={len(volume_list)} | "
        f"lag_hours={body.lag_hours} | client_ip={request_context.client.host}"
    )

    result = CorrelationEngine.full_analysis(
        sentiment_data=sentiment_list,
        price_data=price_list,
        volume_data=volume_list,
        lag_hours=body.lag_hours,
    )

    return CorrelationResponse(
        price_correlation=result.get("price_correlation"),
        volume_correlation=result.get("volume_correlation"),
        summary=result.get("summary", {}),
    )


@app.post("/correlation/lag-analysis", response_model=LagAnalysisResponse)
@limiter.limit("10/minute") if limiter else lambda x: x
async def analyze_lag_correlation(
    body: LagAnalysisRequest,
    request_context: Request,
) -> LagAnalysisResponse:
    """
    Analyze correlation across multiple time lags to find optimal lead time.

    Returns the best lag hours and correlation strength for predicting market changes.
    Requires X-API-Key header.
    """
    sentiment_list = [{"timestamp": dp.timestamp, "score": dp.score} for dp in body.sentiment_data]
    metric_list = [{"timestamp": dp.timestamp, "value": dp.value} for dp in body.metric_data]

    logger.info(
        f"Lag correlation analysis | metric_type={body.metric_type} | "
        f"max_lag={body.max_lag_hours}h | client_ip={request_context.client.host}"
    )

    result = CorrelationEngine.analyze_with_lags(
        sentiment_data=sentiment_list,
        metric_data=metric_list,
        metric_type=body.metric_type,
        max_lag_hours=body.max_lag_hours,
    )

    return LagAnalysisResponse(
        best_lag_hours=result["best_lag_hours"],
        best_correlation=result["best_correlation"],
        lag_analysis=result["lag_analysis"],
        recommendation=result["recommendation"],
    )
