"""
FastAPI server to expose sentiment analysis as an HTTP API
for the Node.js backend to consume.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import logging
from typing import Dict, Any

# Import your existing SentimentAnalyzer
import sys
import os

# Add parent directory to path to import from src
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from sentiment import SentimentAnalyzer

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="Sentiment Analysis API",
    description="Exposes sentiment analysis for Node.js backend integration",
    version="1.0.0",
)

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

# Initialize your existing SentimentAnalyzer
sentiment_analyzer = SentimentAnalyzer()


# Request/Response models
class AnalyzeRequest(BaseModel):
    text: str


class AnalyzeResponse(BaseModel):
    sentiment: float  # compound_score from SentimentResult


class HealthResponse(BaseModel):
    status: str
    timestamp: str
    service: str


@app.get("/")
async def root() -> Dict[str, Any]:
    """Root endpoint with API information"""
    return {
        "service": "Sentiment Analysis API",
        "version": "1.0.0",
        "endpoints": {
            "GET /health": "Health check",
            "POST /analyze": "Analyze text sentiment (expects {text: string})",
        },
        "note": "Returns sentiment score between -1 (negative) and 1 (positive)",
    }


@app.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """Health check endpoint for monitoring"""
    from datetime import datetime

    return HealthResponse(
        status="healthy",
        timestamp=datetime.now().isoformat(),
        service="sentiment-analysis",
    )


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze_text(request: AnalyzeRequest) -> AnalyzeResponse:
    """
    Analyze the sentiment of provided text.

    This endpoint connects to your existing SentimentAnalyzer class
    and returns the compound_score as the sentiment value.

    Args:
        request: Contains the text to analyze

    Returns:
        sentiment: float between -1 and 1
    """
    try:
        # Validate input
        if not request.text or not request.text.strip():
            raise HTTPException(status_code=400, detail="Text cannot be empty")

        # Use your existing SentimentAnalyzer
        result = sentiment_analyzer.analyze(request.text)

        logger.info(
            f"Analyzed text: '{request.text[:50]}...' -> sentiment: {result.compound_score}"
        )

        # Return just the compound_score as "sentiment" for Node.js compatibility
        return AnalyzeResponse(sentiment=result.compound_score)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in sentiment analysis: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


# Optional: Batch analysis endpoint if needed
@app.post("/analyze-batch")
async def analyze_batch(texts: list[str]) -> Dict[str, Any]:
    """Batch analyze multiple texts"""
    try:
        if not texts:
            raise HTTPException(status_code=400, detail="Texts list cannot be empty")

        results = sentiment_analyzer.analyze_batch(texts)
        summary = sentiment_analyzer.get_sentiment_summary(results)

        return {
            "results": [r.to_dict() for r in results],
            "summary": summary,
            "count": len(results),
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
