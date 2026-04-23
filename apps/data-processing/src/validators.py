"""
validators.py

Provides data validation and sanitization for ingested records using Pydantic models.
Schemas:
- NewsArticle
- OnChainMetric

Invalid records are logged and handled safely.
"""
from typing import Optional, Any
from pydantic import BaseModel, ValidationError, validator
import logging

logger = logging.getLogger("data_validation")

class NewsArticle(BaseModel):
    id: str
    title: str
    content: str
    published_at: str  # ISO8601 string
    source: Optional[str]
    url: Optional[str]

    @validator("published_at")
    def validate_published_at(cls, v):
        # Optionally, add stricter ISO8601 validation here
        if not v or not isinstance(v, str):
            raise ValueError("published_at must be a non-empty string")
        return v


class OnChainMetric(BaseModel):
    metric_id: str
    value: float
    timestamp: str  # ISO8601 string
    chain: str
    extra: Optional[Any] = None

    @validator("timestamp")
    def validate_timestamp(cls, v):
        if not v or not isinstance(v, str):
            raise ValueError("timestamp must be a non-empty string")
        return v

def validate_news_article(data: dict) -> Optional[NewsArticle]:
    try:
        return NewsArticle(**data)
    except ValidationError as e:
        logger.warning(f"Invalid NewsArticle: {e.errors()}")
        return None

def validate_onchain_metric(data: dict) -> Optional[OnChainMetric]:
    try:
        return OnChainMetric(**data)
    except ValidationError as e:
        logger.warning(f"Invalid OnChainMetric: {e.errors()}")
        return None
