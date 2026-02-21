"""
Database models for analytics data persistence
"""

from datetime import datetime
from typing import Optional
from sqlalchemy import Column, Integer, String, Float, DateTime, JSON, Text, Index
from sqlalchemy.orm import declarative_base
from sqlalchemy.sql import func

Base = declarative_base()


class NewsInsight(Base):
    """
    Stores sentiment analysis results for news articles
    """

    __tablename__ = "news_insights"

    id = Column(Integer, primary_key=True, autoincrement=True)
    article_id = Column(String(255), nullable=True, index=True)
    article_title = Column(Text, nullable=True)
    article_url = Column(Text, nullable=True)
    source = Column(String(100), nullable=True)
    
    # Sentiment scores
    sentiment_score = Column(Float, nullable=False)  # compound score -1 to 1
    positive_score = Column(Float, nullable=False)
    negative_score = Column(Float, nullable=False)
    neutral_score = Column(Float, nullable=False)
    sentiment_label = Column(String(20), nullable=False)  # positive/negative/neutral
    
    # Keywords and metadata
    keywords = Column(JSON, nullable=True)  # Array of keywords
    language = Column(String(10), nullable=True)
    
    # Timestamps
    article_published_at = Column(DateTime(timezone=True), nullable=True)
    analyzed_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Indexes for efficient querying
    __table_args__ = (
        Index("idx_news_insights_analyzed_at", "analyzed_at"),
        Index("idx_news_insights_sentiment_label", "sentiment_label"),
        Index("idx_news_insights_source", "source"),
    )

    def __repr__(self):
        return f"<NewsInsight(id={self.id}, sentiment={self.sentiment_label}, score={self.sentiment_score})>"


class AssetTrend(Base):
    """
    Stores calculated trends for assets and metrics
    """

    __tablename__ = "asset_trends"

    id = Column(Integer, primary_key=True, autoincrement=True)
    asset = Column(String(50), nullable=False, index=True)  # e.g., 'XLM', 'BTC'
    metric_name = Column(String(100), nullable=False)  # e.g., 'sentiment_score', 'volume'
    window = Column(String(20), nullable=False)  # e.g., '1h', '24h', '7d'
    
    # Trend data
    trend_direction = Column(String(20), nullable=False)  # up/down/stable
    score = Column(Float, nullable=False)  # trend score/strength
    current_value = Column(Float, nullable=False)
    previous_value = Column(Float, nullable=False)
    change_percentage = Column(Float, nullable=False)
    
    # Additional data (renamed from metadata to avoid SQLAlchemy conflict)
    extra_data = Column(JSON, nullable=True)  # Additional trend metadata
    
    # Timestamps
    timestamp = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Indexes for efficient querying
    __table_args__ = (
        Index("idx_asset_trends_asset_metric", "asset", "metric_name"),
        Index("idx_asset_trends_timestamp", "timestamp"),
        Index("idx_asset_trends_window", "window"),
    )

    def __repr__(self):
        return f"<AssetTrend(asset={self.asset}, metric={self.metric_name}, trend={self.trend_direction})>"
