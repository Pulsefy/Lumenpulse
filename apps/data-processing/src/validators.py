"""
validators.py

Provides data validation and sanitization for ingested records using Pydantic models.
Schemas:
- NewsArticle
- OnChainMetric

Invalid records are logged and handled safely.
"""
from typing import Optional, Any
from pydantic import BaseModel, ValidationError, field_validator
import logging

logger = logging.getLogger("data_validation")

class NewsArticle(BaseModel):
    id: str
    title: str
    content: str
    published_at: str  # ISO8601 string
    source: Optional[str] = None
    url: Optional[str] = None

    @field_validator("published_at")
    @classmethod
    def validate_published_at(cls, v: str) -> str:
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

    @field_validator("timestamp")
    @classmethod
    def validate_timestamp(cls, v: str) -> str:
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
