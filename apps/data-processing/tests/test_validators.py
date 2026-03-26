import pytest
from src.validators import validate_news_article, validate_onchain_metric
from datetime import datetime

def test_news_article_happy_path():
    data = {
        "id": "test1",
        "title": "Test News",
        "content": "Some content",
        "published_at": "2024-01-01T00:00:00Z",
        "source": "UnitTest",
        "url": "http://example.com",
    }
    result = validate_news_article(data)
    assert result is not None
    assert result.id == "test1"

def test_news_article_missing_field():
    data = {
        "id": "test2",
        # Missing title
        "content": "Some content",
        "published_at": "2024-01-01T00:00:00Z",
        "source": "UnitTest",
        "url": "http://example.com",
    }
    result = validate_news_article(data)
    assert result is None

def test_news_article_wrong_type():
    data = {
        "id": "test3",
        "title": 123,  # Should be str
        "content": "Some content",
        "published_at": "2024-01-01T00:00:00Z",
        "source": "UnitTest",
        "url": "http://example.com",
    }
    result = validate_news_article(data)
    assert result is None

def test_onchain_metric_happy_path():
    data = {
        "metric_id": "m1",
        "value": 42.0,
        "timestamp": "2024-01-01T00:00:00Z",
        "chain": "stellar",
    }
    result = validate_onchain_metric(data)
    assert result is not None
    assert result.metric_id == "m1"

def test_onchain_metric_missing_field():
    data = {
        # Missing metric_id
        "value": 42.0,
        "timestamp": "2024-01-01T00:00:00Z",
        "chain": "stellar",
    }
    result = validate_onchain_metric(data)
    assert result is None

def test_onchain_metric_wrong_type():
    data = {
        "metric_id": "m2",
        "value": "not-a-float",
        "timestamp": "2024-01-01T00:00:00Z",
        "chain": "stellar",
    }
    result = validate_onchain_metric(data)
    assert result is None
