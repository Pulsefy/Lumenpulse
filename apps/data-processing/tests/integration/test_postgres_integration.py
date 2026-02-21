"""
Integration tests for PostgreSQL persistence
"""

import pytest
import os
from datetime import datetime
from dotenv import load_dotenv

from src.db import PostgresService, NewsInsight, AssetTrend

load_dotenv()

# Skip tests if no database URL is configured
pytestmark = pytest.mark.skipif(
    not os.getenv("DATABASE_URL"),
    reason="DATABASE_URL not configured"
)


@pytest.fixture
def db_service():
    """Create a PostgreSQL service instance for testing"""
    service = PostgresService()
    # Create tables
    service.create_tables()
    yield service
    # Cleanup after tests
    # Note: In production, you might want to use a separate test database


class TestPostgresIntegration:
    """Integration tests for PostgreSQL service"""

    def test_save_and_retrieve_news_insight(self, db_service):
        """Test saving and retrieving a news insight"""
        # Create test data
        sentiment_result = {
            "compound_score": 0.5,
            "positive": 0.7,
            "negative": 0.1,
            "neutral": 0.2,
            "sentiment_label": "positive",
        }
        
        article_data = {
            "id": "test-article-1",
            "title": "Test Article",
            "url": "https://example.com/test",
            "source": "test-source",
            "keywords": ["crypto", "blockchain"],
            "language": "en",
            "published_at": datetime.utcnow(),
        }
        
        # Save insight
        insight = db_service.save_news_insight(sentiment_result, article_data)
        
        assert insight is not None
        assert insight.id is not None
        assert insight.sentiment_label == "positive"
        assert insight.sentiment_score == 0.5
        
        # Retrieve insights
        insights = db_service.get_recent_news_insights(limit=10, hours=1)
        assert len(insights) > 0
        assert any(i.article_id == "test-article-1" for i in insights)

    def test_save_news_insights_batch(self, db_service):
        """Test saving multiple news insights in a batch"""
        sentiment_results = [
            {
                "compound_score": 0.5,
                "positive": 0.7,
                "negative": 0.1,
                "neutral": 0.2,
                "sentiment_label": "positive",
            },
            {
                "compound_score": -0.3,
                "positive": 0.2,
                "negative": 0.6,
                "neutral": 0.2,
                "sentiment_label": "negative",
            },
        ]
        
        articles_data = [
            {"id": "batch-1", "title": "Article 1", "source": "test"},
            {"id": "batch-2", "title": "Article 2", "source": "test"},
        ]
        
        saved_count = db_service.save_news_insights_batch(
            sentiment_results, articles_data
        )
        
        assert saved_count == 2
        
        # Verify they were saved
        insights = db_service.get_recent_news_insights(limit=10, hours=1)
        assert len(insights) >= 2

    def test_save_and_retrieve_asset_trend(self, db_service):
        """Test saving and retrieving an asset trend"""
        trend_data = {
            "trend_direction": "up",
            "score": 0.75,
            "current_value": 100.0,
            "previous_value": 90.0,
            "change_percentage": 11.11,
            "extra_data": {"confidence": "high"},
        }
        
        trend = db_service.save_asset_trend(
            asset="XLM",
            metric_name="sentiment_score",
            window="24h",
            trend_data=trend_data,
        )
        
        assert trend is not None
        assert trend.id is not None
        assert trend.asset == "XLM"
        assert trend.trend_direction == "up"
        
        # Retrieve trends
        trends = db_service.get_recent_asset_trends(asset="XLM", limit=10)
        assert len(trends) > 0
        assert any(t.metric_name == "sentiment_score" for t in trends)

    def test_save_asset_trends_batch(self, db_service):
        """Test saving multiple asset trends in a batch"""
        trends = [
            {
                "metric_name": "sentiment_score",
                "trend_direction": "up",
                "score": 0.75,
                "current_value": 100.0,
                "previous_value": 90.0,
                "change_percentage": 11.11,
            },
            {
                "metric_name": "volume",
                "trend_direction": "down",
                "score": 0.60,
                "current_value": 80.0,
                "previous_value": 100.0,
                "change_percentage": -20.0,
            },
        ]
        
        saved_count = db_service.save_asset_trends_batch(
            asset="XLM", window="24h", trends=trends
        )
        
        assert saved_count == 2
        
        # Verify they were saved
        retrieved_trends = db_service.get_recent_asset_trends(asset="XLM", limit=10)
        assert len(retrieved_trends) >= 2

    def test_get_sentiment_summary(self, db_service):
        """Test getting sentiment summary statistics"""
        # Save some test data
        sentiment_results = [
            {
                "compound_score": 0.5,
                "positive": 0.7,
                "negative": 0.1,
                "neutral": 0.2,
                "sentiment_label": "positive",
            },
            {
                "compound_score": -0.3,
                "positive": 0.2,
                "negative": 0.6,
                "neutral": 0.2,
                "sentiment_label": "negative",
            },
            {
                "compound_score": 0.0,
                "positive": 0.3,
                "negative": 0.3,
                "neutral": 0.4,
                "sentiment_label": "neutral",
            },
        ]
        
        db_service.save_news_insights_batch(sentiment_results)
        
        # Get summary
        summary = db_service.get_sentiment_summary(hours=1)
        
        assert summary["total_articles"] >= 3
        assert "average_sentiment" in summary
        assert "positive_count" in summary
        assert "negative_count" in summary
        assert "neutral_count" in summary

    def test_cleanup_old_data(self, db_service):
        """Test cleaning up old data"""
        # This test would need to create old data with backdated timestamps
        # For now, just verify the method runs without error
        result = db_service.cleanup_old_data(days=30)
        
        assert isinstance(result, dict)
        assert "news_insights" in result
        assert "asset_trends" in result


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
