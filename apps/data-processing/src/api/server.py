from fastapi import FastAPI, Request, HTTPException
from pydantic import BaseModel
from typing import Dict, Optional
import time
import uuid
import contextvars

# Context variable to store correlation ID for the current request
correlation_id_ctx = contextvars.ContextVar(\"correlation_id\", default=None)

app = FastAPI(title=\"Lumenpulse Data Processing API\")

class SentimentRequest(BaseModel):
    text: str

class SentimentResponse(BaseModel):
    sentiment: float
    confidence: float
    metadata: Optional[Dict] = None

@app.middleware(\"http\")
async def add_process_time_header(request: Request, call_next):
    # Try to get correlation ID from headers (both common variants)
    correlation_id = request.headers.get(\"X-Request-Id\") or request.headers.get(\"X-Correlation-ID\")
    
    if not correlation_id:
        correlation_id = str(uuid.uuid4())
    
    # Set correlation ID in context
    token = correlation_id_ctx.set(correlation_id)
    
    start_time = time.time()
    try:
        response = await call_next(request)
        process_time = time.time() - start_time
        response.headers[\"X-Process-Time\"] = str(process_time)
        response.headers[\"X-Request-Id\"] = correlation_id
        return response
    finally:
        correlation_id_ctx.reset(token)

@app.post(\"/analyze\", response_model=SentimentResponse)
async def analyze_sentiment(request: SentimentRequest):
    correlation_id = correlation_id_ctx.get()
    
    # Simulated sentiment analysis
    # In a real app, this would use a model like VADER or a transformer
    text = request.text.lower()
    
    # Basic keyword-based sentiment for demonstration
    positive_words = [\"great\", \"good\", \"amazing\", \"excellent\", \"bullish\", \"up\", \"gain\"]
    negative_words = [\"bad\", \"poor\", \"terrible\", \"awful\", \"bearish\", \"down\", \"loss\"]
    
    pos_count = sum(1 for word in positive_words if word in text)
    neg_count = sum(1 for word in negative_words if word in text)
    
    sentiment = 0.5 # Neutral
    if pos_count > neg_count:
        sentiment = 0.5 + (0.1 * min(pos_count, 5))
    elif neg_count > pos_count:
        sentiment = 0.5 - (0.1 * min(neg_count, 5))
        
    return {
        \"sentiment\": sentiment,
        \"confidence\": 0.85,
        \"metadata\": {
            \"correlation_id\": correlation_id,
            \"word_counts\": {\"pos\": pos_count, \"neg\": neg_count}
        }
    }

@app.get(\"/health\")
async def health_check():
    return {\"status\": \"ok\", \"correlation_id\": correlation_id_ctx.get()}
