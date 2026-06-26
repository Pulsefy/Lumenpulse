"""
Database models for analytics data persistence
"""

from datetime import datetime
from typing import Optional
from sqlalchemy import Column, Integer, String, Float, DateTime, JSON, Text, Index, BigInteger
from sqlalchemy.orm import declarative_base
from sqlalchemy.sql import func

Base = declarative_base()


class Article(Base):
    """
    Stores news articles with full content and metadata
    """

    __tablename__ = "articles"

    id = Column(Integer, primary_key=True, autoincrement=True)
    article_id = Column(String(255), unique=True, nullable=False, index=True)
    title = Column(Text, nullable=False)
    content = Column(Text, nullable=True)
    summary = Column(Text, nullable=True)
    source = Column(String(100), nullable=True, index=True)
    url = Column(Text, nullable=True)
    
    # Asset information
    asset_codes = Column(JSON, nullable=True)  # Array of asset codes mentioned in article
    primary_asset = Column(String(20), nullable=True, index=True)  # Primary asset being discussed
    categories = Column(JSON, nullable=True)  # Article categories
    
    # Sentiment scores
    sentiment_score = Column(Float, nullable=True)  # compound score -1 to 1
    positive_score = Column(Float, nullable=True)
    negative_score = Column(Float, nullable=True)
    neutral_score = Column(Float, nullable=True)
    sentiment_label = Column(String(20), nullable=True, index=True)  # positive/negative/neutral
    
    # Keywords and metadata
    keywords = Column(JSON, nullable=True)  # Array of keywords
    detected_entities = Column(JSON, nullable=True)  # NER entities detected in article text
    onchain_entity_links = Column(JSON, nullable=True)  # Stable project/asset links
    language = Column(String(10), nullable=True)
    
    # Timestamps
    published_at = Column(DateTime(timezone=True), nullable=True, index=True)
    fetched_at = Column(DateTime(timezone=True), nullable=True)
    analyzed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Indexes for efficient querying
    __table_args__ = (
        Index("idx_articles_published_at", "published_at"),
        Index("idx_articles_sentiment_label", "sentiment_label"),
        Index("idx_articles_source", "source"),
        Index("idx_articles_primary_asset", "primary_asset"),
        Index("idx_articles_asset_sentiment", "primary_asset", "sentiment_label"),
        Index("idx_articles_created_at", "created_at"),
    )

    def __repr__(self):
        return f"<Article(id={self.article_id}, title={self.title[:50]}, asset={self.primary_asset}, sentiment={self.sentiment_label})>"


class ArticleOnchainEntityLink(Base):
    """
    Normalized article-to-on-chain entity links for backend consumption.
    """

    __tablename__ = "article_onchain_entity_links"

    id = Column(Integer, primary_key=True, autoincrement=True)
    article_id = Column(String(255), nullable=False, index=True)
    stable_entity_id = Column(String(255), nullable=False, index=True)
    entity_type = Column(String(50), nullable=False, index=True)
    display_name = Column(String(255), nullable=False)
    matched_text = Column(String(255), nullable=False)
    confidence = Column(Float, nullable=False)
    source = Column(String(100), nullable=False)
    asset_code = Column(String(20), nullable=True, index=True)
    project_id = Column(BigInteger, nullable=True, index=True)
    contract_id = Column(String(255), nullable=True, index=True)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        Index(
            "ux_article_onchain_links_article_entity",
            "article_id",
            "stable_entity_id",
            unique=True,
        ),
        Index("idx_article_onchain_links_type", "entity_type"),
    )


class SocialPost(Base):
    """
    Stores social media posts (Twitter, Reddit, etc.)
    """

    __tablename__ = "social_posts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    post_id = Column(String(255), unique=True, nullable=False, index=True)
    platform = Column(String(50), nullable=False, index=True)  # twitter, reddit, etc.
    content = Column(Text, nullable=False)
    author = Column(String(255), nullable=True)
    url = Column(Text, nullable=True)
    
    # Engagement metrics
    likes = Column(Integer, default=0)
    comments = Column(Integer, default=0)
    shares = Column(Integer, default=0)
    
    # Asset information
    asset_codes = Column(JSON, nullable=True)  # Array of asset codes mentioned
    primary_asset = Column(String(20), nullable=True, index=True)
    hashtags = Column(JSON, nullable=True)  # Array of hashtags
    subreddit = Column(String(100), nullable=True)  # For Reddit posts
    
    # Sentiment scores
    sentiment_score = Column(Float, nullable=True)  # compound score -1 to 1
    positive_score = Column(Float, nullable=True)
    negative_score = Column(Float, nullable=True)
    neutral_score = Column(Float, nullable=True)
    sentiment_label = Column(String(20), nullable=True, index=True)
    
    # Timestamps
    posted_at = Column(DateTime(timezone=True), nullable=False, index=True)
    fetched_at = Column(DateTime(timezone=True), nullable=True)
    analyzed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Indexes for efficient querying
    __table_args__ = (
        Index("idx_social_posts_platform", "platform"),
        Index("idx_social_posts_posted_at", "posted_at"),
        Index("idx_social_posts_sentiment_label", "sentiment_label"),
        Index("idx_social_posts_primary_asset", "primary_asset"),
        Index("idx_social_posts_platform_asset", "platform", "primary_asset"),
        Index("idx_social_posts_created_at", "created_at"),
    )

    def __repr__(self):
        return f"<SocialPost(id={self.post_id}, platform={self.platform}, asset={self.primary_asset}, sentiment={self.sentiment_label})>"


class AnalyticsRecord(Base):
    """
    Stores computed analytics and aggregated metrics
    """

    __tablename__ = "analytics_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    record_type = Column(String(50), nullable=False, index=True)  # sentiment_summary, trend, etc.
    asset = Column(String(50), nullable=True, index=True)  # Asset symbol (e.g., 'XLM', 'BTC')
    metric_name = Column(String(100), nullable=False)  # e.g., 'sentiment_score', 'volume'
    window = Column(String(20), nullable=True)  # e.g., '1h', '24h', '7d'
    
    # Metric values
    value = Column(Float, nullable=False)
    previous_value = Column(Float, nullable=True)
    change_percentage = Column(Float, nullable=True)
    trend_direction = Column(String(20), nullable=True)  # up/down/stable
    
    # Additional data
    extra_data = Column(JSON, nullable=True)  # Additional metadata
    
    # Timestamps
    timestamp = Column(DateTime(timezone=True), nullable=False, index=True)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Indexes for efficient querying
    __table_args__ = (
        Index("idx_analytics_records_type", "record_type"),
        Index("idx_analytics_records_asset", "asset"),
        Index("idx_analytics_records_timestamp", "timestamp"),
        Index("idx_analytics_records_type_asset", "record_type", "asset"),
        Index("idx_analytics_records_asset_metric", "asset", "metric_name"),
    )

    def __repr__(self):
        return f"<AnalyticsRecord(type={self.record_type}, asset={self.asset}, metric={self.metric_name}, value={self.value})>"


class ContractEvent(Base):
    """
    Stores raw Soroban contract events for project-state materialization.
    """

    __tablename__ = "contract_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    contract_id = Column(String(255), nullable=False, index=True)
    event_id = Column(String(255), nullable=False, index=True)
    ledger = Column(BigInteger, nullable=False, index=True)
    event_type = Column(String(100), nullable=False, index=True)
    project_id = Column(BigInteger, nullable=True, index=True)
    contributor = Column(String(255), nullable=True, index=True)
    amount = Column(Float, nullable=True)
    milestone_id = Column(Integer, nullable=True, index=True)
    status = Column(String(50), nullable=True, index=True)
    topics = Column(JSON, nullable=True)
    raw_data = Column(JSON, nullable=True)
    timestamp = Column(DateTime(timezone=True), nullable=True, index=True)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index(
            "ux_contract_events_contract_id_event_id",
            "contract_id",
            "event_id",
            unique=True,
        ),
        Index("idx_contract_events_project_type", "project_id", "event_type"),
    )

    def __repr__(self):
        return (
            f"<ContractEvent(contract_id={self.contract_id}, event_id={self.event_id}, "
            f"project_id={self.project_id}, event_type={self.event_type})>"
        )


class ProjectView(Base):
    """
    Stores aggregated project state for fast reads.
    """

    __tablename__ = "project_views"

    id = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(BigInteger, nullable=False, unique=True, index=True)
    contract_id = Column(String(255), nullable=True, index=True)
    owner = Column(String(255), nullable=True, index=True)
    total_contributions = Column(Float, nullable=False, default=0.0)
    unique_contributors = Column(Integer, nullable=False, default=0)
    funding_momentum_score = Column(Float, nullable=False, default=0.0)
    status = Column(String(50), nullable=True, index=True)
    last_event_ledger = Column(BigInteger, nullable=True, index=True)
    extra_data = Column(JSON, nullable=True)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        Index("idx_project_views_status", "status"),
        Index("idx_project_views_contract_id", "contract_id"),
        Index("idx_project_views_funding_momentum_score", "funding_momentum_score"),
    )

    def __repr__(self):
        return (
            f"<ProjectView(project_id={self.project_id}, total_contributions={self.total_contributions}, "
            f"unique_contributors={self.unique_contributors}, "
            f"funding_momentum_score={self.funding_momentum_score}, status={self.status})>"
        )


class ProjectContributor(Base):
    """
    Stores per-project contributor contribution totals and history.
    """

    __tablename__ = "project_contributors"

    id = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(BigInteger, nullable=False, index=True)
    contributor = Column(String(255), nullable=False, index=True)
    total_contributed = Column(Float, nullable=False, default=0.0)
    first_contribution_ledger = Column(BigInteger, nullable=True)
    last_contribution_ledger = Column(BigInteger, nullable=True)
    extra_data = Column(JSON, nullable=True)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        Index(
            "ux_project_contributors_project_id_contributor",
            "project_id",
            "contributor",
            unique=True,
        ),
    )

    def __repr__(self):
        return (
            f"<ProjectContributor(project_id={self.project_id}, contributor={self.contributor}, "
            f"total_contributed={self.total_contributed})>"
        )


class ProjectMilestone(Base):
    """
    Stores the latest milestone state for each project milestone.
    """

    __tablename__ = "project_milestones"

    id = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(BigInteger, nullable=False, index=True)
    milestone_id = Column(Integer, nullable=False, index=True)
    status = Column(String(50), nullable=False, default="pending", index=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)
    last_event_ledger = Column(BigInteger, nullable=True)
    extra_data = Column(JSON, nullable=True)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        Index(
            "ux_project_milestones_project_id_milestone_id",
            "project_id",
            "milestone_id",
            unique=True,
        ),
    )

    def __repr__(self):
        return (
            f"<ProjectMilestone(project_id={self.project_id}, milestone_id={self.milestone_id}, "
            f"status={self.status})>"
        )


class NewsInsight(Base):
    """
    Stores sentiment analysis results for news articles (legacy table, kept for backward compatibility)
    """

    __tablename__ = "news_insights"

    id = Column(Integer, primary_key=True, autoincrement=True)
    article_id = Column(String(255), nullable=True, index=True)
    article_title = Column(Text, nullable=True)
    article_url = Column(Text, nullable=True)
    source = Column(String(100), nullable=True)
    
    # Asset information
    asset_codes = Column(JSON, nullable=True)  # Array of asset codes mentioned in article
    primary_asset = Column(String(20), nullable=True, index=True)  # Primary asset being discussed
    
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
        Index("idx_news_insights_primary_asset", "primary_asset"),
        Index("idx_news_insights_asset_sentiment", "primary_asset", "sentiment_label"),
    )

    def __repr__(self):
        return f"<NewsInsight(id={self.id}, asset={self.primary_asset}, sentiment={self.sentiment_label}, score={self.sentiment_score})>"


class AssetTrend(Base):
    """
    Stores calculated trends for assets and metrics (legacy table, kept for backward compatibility)
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
