"""
PostgreSQL service for persisting analytics data
"""

import logging
import os
import time
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
from contextlib import contextmanager

from sqlalchemy import create_engine, select, and_, desc
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.exc import SQLAlchemyError, OperationalError

from .models import Base, Article, SocialPost, AnalyticsRecord, NewsInsight, AssetTrend
from src.analytics.ner_service import NERService

logger = logging.getLogger(__name__)


class PostgresService:
    """
    Service for persisting and retrieving analytics data from PostgreSQL
    """

    def __init__(self, database_url: Optional[str] = None):
        """
        Initialize PostgreSQL service

        Args:
            database_url: PostgreSQL connection URL. If None, reads from environment
        """
        self.database_url = database_url or os.getenv(
            "DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/lumenpulse"
        )

        try:
            self.engine = create_engine(
                self.database_url,
                pool_pre_ping=True,  # Verify connections before using
                pool_size=5,
                max_overflow=10,
                echo=False,  # Set to True for SQL query logging
            )
            self.SessionLocal = sessionmaker(
                autocommit=False,
                autoflush=False,
                expire_on_commit=False,
                bind=self.engine,
            )
            self.ner_service = NERService()
            logger.info("PostgreSQL service initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize PostgreSQL service: {e}")
            raise

    def _ensure_detected_entities(self, article_data: Dict[str, Any]) -> Dict[str, Any]:
        """Populate detected_entities when absent using the NER service."""
        normalized = dict(article_data)
        existing_entities = normalized.get("detected_entities")
        if isinstance(existing_entities, list) and existing_entities:
            return normalized

        normalized["detected_entities"] = self.ner_service.extract_entities_from_article(
            title=normalized.get("title"),
            summary=normalized.get("summary"),
            content=normalized.get("content"),
        )
        return normalized

    @contextmanager
    def get_session(self):
        """
        Context manager for database sessions

        Yields:
            Session: SQLAlchemy session
        """
        session = self.SessionLocal()
        try:
            yield session
            session.commit()
        except Exception as e:
            session.rollback()
            logger.error(f"Session error: {e}")
            raise
        finally:
            session.close()

    def _retry_operation(self, operation, max_retries=3, retry_delay=1.0):
        """
        Retry a database operation with exponential backoff

        Args:
            operation: Callable to execute
            max_retries: Maximum number of retry attempts
            retry_delay: Initial delay between retries (doubles each retry)

        Returns:
            Result of the operation

        Raises:
            Exception: If all retries fail
        """
        last_exception = None
        for attempt in range(max_retries):
            try:
                return operation()
            except OperationalError as e:
                last_exception = e
                if attempt < max_retries - 1:
                    wait_time = retry_delay * (2 ** attempt)  # Exponential backoff
                    logger.warning(
                        f"Database operation failed (attempt {attempt + 1}/{max_retries}): {e}. "
                        f"Retrying in {wait_time:.1f}s..."
                    )
                    time.sleep(wait_time)
                else:
                    logger.error(f"Database operation failed after {max_retries} attempts: {e}")
                    raise
            except SQLAlchemyError as e:
                # Non-retryable errors
                logger.error(f"Database operation failed with non-retryable error: {e}")
                raise
        raise last_exception

    def create_tables(self):
        """
        Create all tables in the database
        """
        try:
            Base.metadata.create_all(bind=self.engine)
            logger.info("Database tables created successfully")
        except Exception as e:
            logger.error(f"Failed to create tables: {e}")
            raise

    def drop_tables(self):
        """
        Drop all tables (use with caution!)
        """
        try:
            Base.metadata.drop_all(bind=self.engine)
            logger.warning("All database tables dropped")
        except Exception as e:
            logger.error(f"Failed to drop tables: {e}")
            raise

    # Article Methods

    def save_article(
        self,
        article_data: Dict[str, Any],
        sentiment_result: Optional[Dict[str, Any]] = None,
    ) -> Optional[Article]:
        """
        Save an article with optional sentiment analysis

        Args:
            article_data: Article data dictionary
            sentiment_result: Optional sentiment analysis result

        Returns:
            Article object if successful, None otherwise
        """
        article_data = self._ensure_detected_entities(article_data)

        def _save():
            with self.get_session() as session:
                # Check if article already exists
                existing = session.execute(
                    select(Article).where(Article.article_id == article_data.get("id"))
                ).scalar_one_or_none()

                if existing:
                    # Update existing article
                    existing.title = article_data.get("title", existing.title)
                    existing.content = article_data.get("content", existing.content)
                    existing.summary = article_data.get("summary", existing.summary)
                    existing.source = article_data.get("source", existing.source)
                    existing.url = article_data.get("url", existing.url)
                    existing.asset_codes = article_data.get("asset_codes", existing.asset_codes)
                    existing.primary_asset = article_data.get("primary_asset", existing.primary_asset)
                    existing.categories = article_data.get("categories", existing.categories)
                    existing.keywords = article_data.get("keywords", existing.keywords)
                    existing.detected_entities = article_data.get("detected_entities", existing.detected_entities)
                    existing.language = article_data.get("language", existing.language)
                    existing.published_at = article_data.get("published_at", existing.published_at)
                    existing.fetched_at = article_data.get("fetched_at", existing.fetched_at)

                    if sentiment_result:
                        existing.sentiment_score = sentiment_result.get("compound_score")
                        existing.positive_score = sentiment_result.get("positive")
                        existing.negative_score = sentiment_result.get("negative")
                        existing.neutral_score = sentiment_result.get("neutral")
                        existing.sentiment_label = sentiment_result.get("sentiment_label")
                        existing.analyzed_at = datetime.utcnow()

                    session.flush()
                    logger.debug(f"Updated article: {existing.article_id}")
                    return existing
                else:
                    # Create new article
                    article = Article(
                        article_id=article_data.get("id"),
                        title=article_data.get("title", ""),
                        content=article_data.get("content"),
                        summary=article_data.get("summary"),
                        source=article_data.get("source"),
                        url=article_data.get("url"),
                        asset_codes=article_data.get("asset_codes"),
                        primary_asset=article_data.get("primary_asset"),
                        categories=article_data.get("categories"),
                        keywords=article_data.get("keywords"),
                        detected_entities=article_data.get("detected_entities"),
                        language=article_data.get("language"),
                        published_at=article_data.get("published_at"),
                        fetched_at=article_data.get("fetched_at"),
                    )

                    if sentiment_result:
                        article.sentiment_score = sentiment_result.get("compound_score")
                        article.positive_score = sentiment_result.get("positive")
                        article.negative_score = sentiment_result.get("negative")
                        article.neutral_score = sentiment_result.get("neutral")
                        article.sentiment_label = sentiment_result.get("sentiment_label")
                        article.analyzed_at = datetime.utcnow()

                    session.add(article)
                    session.flush()
                    logger.debug(f"Saved article: {article.article_id}")
                    return article

        try:
            return self._retry_operation(_save)
        except SQLAlchemyError as e:
            logger.error(f"Failed to save article: {e}")
            return None

    def save_articles_batch(
        self,
        articles_data: List[Dict[str, Any]],
        sentiment_results: Optional[List[Dict[str, Any]]] = None,
    ) -> int:
        """
        Save multiple articles in a batch

        Args:
            articles_data: List of article data dictionaries
            sentiment_results: Optional list of sentiment analysis results

        Returns:
            Number of articles saved
        """
        saved_count = 0
        try:
            with self.get_session() as session:
                for i, article_data in enumerate(articles_data):
                    article_data = self._ensure_detected_entities(article_data)
                    sentiment_result = sentiment_results[i] if sentiment_results and i < len(sentiment_results) else None

                    # Check if article already exists
                    existing = session.execute(
                        select(Article).where(Article.article_id == article_data.get("id"))
                    ).scalar_one_or_none()

                    if existing:
                        # Update existing article
                        existing.title = article_data.get("title", existing.title)
                        existing.content = article_data.get("content", existing.content)
                        existing.summary = article_data.get("summary", existing.summary)
                        existing.source = article_data.get("source", existing.source)
                        existing.url = article_data.get("url", existing.url)
                        existing.asset_codes = article_data.get("asset_codes", existing.asset_codes)
                        existing.primary_asset = article_data.get("primary_asset", existing.primary_asset)
                        existing.categories = article_data.get("categories", existing.categories)
                        existing.keywords = article_data.get("keywords", existing.keywords)
                        existing.detected_entities = article_data.get("detected_entities", existing.detected_entities)
                        existing.language = article_data.get("language", existing.language)
                        existing.published_at = article_data.get("published_at", existing.published_at)
                        existing.fetched_at = article_data.get("fetched_at", existing.fetched_at)

                        if sentiment_result:
                            existing.sentiment_score = sentiment_result.get("compound_score")
                            existing.positive_score = sentiment_result.get("positive")
                            existing.negative_score = sentiment_result.get("negative")
                            existing.neutral_score = sentiment_result.get("neutral")
                            existing.sentiment_label = sentiment_result.get("sentiment_label")
                            existing.analyzed_at = datetime.utcnow()
                    else:
                        # Create new article
                        article = Article(
                            article_id=article_data.get("id"),
                            title=article_data.get("title", ""),
                            content=article_data.get("content"),
                            summary=article_data.get("summary"),
                            source=article_data.get("source"),
                            url=article_data.get("url"),
                            asset_codes=article_data.get("asset_codes"),
                            primary_asset=article_data.get("primary_asset"),
                            categories=article_data.get("categories"),
                            keywords=article_data.get("keywords"),
                            detected_entities=article_data.get("detected_entities"),
                            language=article_data.get("language"),
                            published_at=article_data.get("published_at"),
                            fetched_at=article_data.get("fetched_at"),
                        )

                        if sentiment_result:
                            article.sentiment_score = sentiment_result.get("compound_score")
                            article.positive_score = sentiment_result.get("positive")
                            article.negative_score = sentiment_result.get("negative")
                            article.neutral_score = sentiment_result.get("neutral")
                            article.sentiment_label = sentiment_result.get("sentiment_label")
                            article.analyzed_at = datetime.utcnow()

                        session.add(article)

                    saved_count += 1

                logger.info(f"Saved {saved_count} articles")
        except SQLAlchemyError as e:
            logger.error(f"Failed to save articles batch: {e}")

        return saved_count

    def get_recent_articles(
        self,
        limit: int = 100,
        hours: int = 24,
        asset: Optional[str] = None,
        entity: Optional[str] = None,
    ) -> List[Article]:
        """
        Get recent articles

        Args:
            limit: Maximum number of results
            hours: Time window in hours
            asset: Optional asset filter
            entity: Optional NER entity filter

        Returns:
            List of Article objects
        """
        try:
            with self.get_session() as session:
                cutoff_time = datetime.utcnow() - timedelta(hours=hours)
                stmt = (
                    select(Article)
                    .where(Article.published_at >= cutoff_time)
                    .order_by(desc(Article.published_at))
                    .limit(limit * 5 if entity else limit)
                )

                if asset:
                    stmt = stmt.where(Article.primary_asset == asset)

                results = session.execute(stmt).scalars().all()
                if entity:
                    target = entity.strip().lower()
                    results = [
                        article
                        for article in results
                        if any(
                            str(value).strip().lower() == target
                            for value in (article.detected_entities or [])
                        )
                    ][:limit]
                logger.debug(f"Retrieved {len(results)} articles")
                return results
        except SQLAlchemyError as e:
            logger.error(f"Failed to retrieve articles: {e}")
            return []

    # Social Post Methods

    def save_social_post(
        self,
        post_data: Dict[str, Any],
        sentiment_result: Optional[Dict[str, Any]] = None,
    ) -> Optional[SocialPost]:
        """
        Save a social media post with optional sentiment analysis

        Args:
            post_data: Social post data dictionary
            sentiment_result: Optional sentiment analysis result

        Returns:
            SocialPost object if successful, None otherwise
        """
        def _save():
            with self.get_session() as session:
                # Check if post already exists
                existing = session.execute(
                    select(SocialPost).where(SocialPost.post_id == post_data.get("id"))
                ).scalar_one_or_none()

                if existing:
                    # Update existing post
                    existing.content = post_data.get("content", existing.content)
                    existing.author = post_data.get("author", existing.author)
                    existing.url = post_data.get("url", existing.url)
                    existing.likes = post_data.get("likes", existing.likes)
                    existing.comments = post_data.get("comments", existing.comments)
                    existing.shares = post_data.get("shares", existing.shares)
                    existing.asset_codes = post_data.get("asset_codes", existing.asset_codes)
                    existing.primary_asset = post_data.get("primary_asset", existing.primary_asset)
                    existing.hashtags = post_data.get("hashtags", existing.hashtags)
                    existing.subreddit = post_data.get("subreddit", existing.subreddit)
                    existing.posted_at = post_data.get("posted_at", existing.posted_at)
                    existing.fetched_at = post_data.get("fetched_at", existing.fetched_at)

                    if sentiment_result:
                        existing.sentiment_score = sentiment_result.get("compound_score")
                        existing.positive_score = sentiment_result.get("positive")
                        existing.negative_score = sentiment_result.get("negative")
                        existing.neutral_score = sentiment_result.get("neutral")
                        existing.sentiment_label = sentiment_result.get("sentiment_label")
                        existing.analyzed_at = datetime.utcnow()

                    session.flush()
                    logger.debug(f"Updated social post: {existing.post_id}")
                    return existing
                else:
                    # Create new post
                    post = SocialPost(
                        post_id=post_data.get("id"),
                        platform=post_data.get("platform", "unknown"),
                        content=post_data.get("content", ""),
                        author=post_data.get("author"),
                        url=post_data.get("url"),
                        likes=post_data.get("likes", 0),
                        comments=post_data.get("comments", 0),
                        shares=post_data.get("shares", 0),
                        asset_codes=post_data.get("asset_codes"),
                        primary_asset=post_data.get("primary_asset"),
                        hashtags=post_data.get("hashtags"),
                        subreddit=post_data.get("subreddit"),
                        posted_at=post_data.get("posted_at"),
                        fetched_at=post_data.get("fetched_at"),
                    )

                    if sentiment_result:
                        post.sentiment_score = sentiment_result.get("compound_score")
                        post.positive_score = sentiment_result.get("positive")
                        post.negative_score = sentiment_result.get("negative")
                        post.neutral_score = sentiment_result.get("neutral")
                        post.sentiment_label = sentiment_result.get("sentiment_label")
                        post.analyzed_at = datetime.utcnow()

                    session.add(post)
                    session.flush()
                    logger.debug(f"Saved social post: {post.post_id}")
                    return post

        try:
            return self._retry_operation(_save)
        except SQLAlchemyError as e:
            logger.error(f"Failed to save social post: {e}")
            return None

    def save_social_posts_batch(
        self,
        posts_data: List[Dict[str, Any]],
        sentiment_results: Optional[List[Dict[str, Any]]] = None,
    ) -> int:
        """
        Save multiple social posts in a batch

        Args:
            posts_data: List of social post data dictionaries
            sentiment_results: Optional list of sentiment analysis results

        Returns:
            Number of posts saved
        """
        saved_count = 0
        try:
            with self.get_session() as session:
                for i, post_data in enumerate(posts_data):
                    sentiment_result = sentiment_results[i] if sentiment_results and i < len(sentiment_results) else None

                    # Check if post already exists
                    existing = session.execute(
                        select(SocialPost).where(SocialPost.post_id == post_data.get("id"))
                    ).scalar_one_or_none()

                    if existing:
                        # Update existing post
                        existing.content = post_data.get("content", existing.content)
                        existing.author = post_data.get("author", existing.author)
                        existing.url = post_data.get("url", existing.url)
                        existing.likes = post_data.get("likes", existing.likes)
                        existing.comments = post_data.get("comments", existing.comments)
                        existing.shares = post_data.get("shares", existing.shares)
                        existing.asset_codes = post_data.get("asset_codes", existing.asset_codes)
                        existing.primary_asset = post_data.get("primary_asset", existing.primary_asset)
                        existing.hashtags = post_data.get("hashtags", existing.hashtags)
                        existing.subreddit = post_data.get("subreddit", existing.subreddit)
                        existing.posted_at = post_data.get("posted_at", existing.posted_at)
                        existing.fetched_at = post_data.get("fetched_at", existing.fetched_at)

                        if sentiment_result:
                            existing.sentiment_score = sentiment_result.get("compound_score")
                            existing.positive_score = sentiment_result.get("positive")
                            existing.negative_score = sentiment_result.get("negative")
                            existing.neutral_score = sentiment_result.get("neutral")
                            existing.sentiment_label = sentiment_result.get("sentiment_label")
                            existing.analyzed_at = datetime.utcnow()
                    else:
                        # Create new post
                        post = SocialPost(
                            post_id=post_data.get("id"),
                            platform=post_data.get("platform", "unknown"),
                            content=post_data.get("content", ""),
                            author=post_data.get("author"),
                            url=post_data.get("url"),
                            likes=post_data.get("likes", 0),
                            comments=post_data.get("comments", 0),
                            shares=post_data.get("shares", 0),
                            asset_codes=post_data.get("asset_codes"),
                            primary_asset=post_data.get("primary_asset"),
                            hashtags=post_data.get("hashtags"),
                            subreddit=post_data.get("subreddit"),
                            posted_at=post_data.get("posted_at"),
                            fetched_at=post_data.get("fetched_at"),
                        )

                        if sentiment_result:
                            post.sentiment_score = sentiment_result.get("compound_score")
                            post.positive_score = sentiment_result.get("positive")
                            post.negative_score = sentiment_result.get("negative")
                            post.neutral_score = sentiment_result.get("neutral")
                            post.sentiment_label = sentiment_result.get("sentiment_label")
                            post.analyzed_at = datetime.utcnow()

                        session.add(post)

                    saved_count += 1

                logger.info(f"Saved {saved_count} social posts")
        except SQLAlchemyError as e:
            logger.error(f"Failed to save social posts batch: {e}")

        return saved_count

    def get_recent_social_posts(
        self,
        limit: int = 100,
        hours: int = 24,
        platform: Optional[str] = None,
        asset: Optional[str] = None,
    ) -> List[SocialPost]:
        """
        Get recent social posts

        Args:
            limit: Maximum number of results
            hours: Time window in hours
            platform: Optional platform filter
            asset: Optional asset filter

        Returns:
            List of SocialPost objects
        """
        try:
            with self.get_session() as session:
                cutoff_time = datetime.utcnow() - timedelta(hours=hours)
                stmt = (
                    select(SocialPost)
                    .where(SocialPost.posted_at >= cutoff_time)
                    .order_by(desc(SocialPost.posted_at))
                    .limit(limit)
                )

                if platform:
                    stmt = stmt.where(SocialPost.platform == platform)
                if asset:
                    stmt = stmt.where(SocialPost.primary_asset == asset)

                results = session.execute(stmt).scalars().all()
                logger.debug(f"Retrieved {len(results)} social posts")
                return results
        except SQLAlchemyError as e:
            logger.error(f"Failed to retrieve social posts: {e}")
            return []

    # Analytics Record Methods

    def save_analytics_record(
        self,
        record_type: str,
        metric_name: str,
        value: float,
        asset: Optional[str] = None,
        window: Optional[str] = None,
        previous_value: Optional[float] = None,
        change_percentage: Optional[float] = None,
        trend_direction: Optional[str] = None,
        extra_data: Optional[Dict[str, Any]] = None,
        timestamp: Optional[datetime] = None,
    ) -> Optional[AnalyticsRecord]:
        """
        Save an analytics record

        Args:
            record_type: Type of record (e.g., 'sentiment_summary', 'trend')
            metric_name: Metric name (e.g., 'sentiment_score', 'volume')
            value: Metric value
            asset: Optional asset symbol
            window: Optional time window
            previous_value: Optional previous value
            change_percentage: Optional change percentage
            trend_direction: Optional trend direction
            extra_data: Optional additional metadata
            timestamp: Optional timestamp (defaults to now)

        Returns:
            AnalyticsRecord object if successful, None otherwise
        """
        def _save():
            with self.get_session() as session:
                record = AnalyticsRecord(
                    record_type=record_type,
                    metric_name=metric_name,
                    value=value,
                    asset=asset,
                    window=window,
                    previous_value=previous_value,
                    change_percentage=change_percentage,
                    trend_direction=trend_direction,
                    extra_data=extra_data,
                    timestamp=timestamp or datetime.utcnow(),
                )
                session.add(record)
                session.flush()
                logger.debug(f"Saved analytics record: {record_type}/{metric_name}")
                return record

        try:
            return self._retry_operation(_save)
        except SQLAlchemyError as e:
            logger.error(f"Failed to save analytics record: {e}")
            return None

    def save_analytics_records_batch(
        self,
        records_data: List[Dict[str, Any]],
    ) -> int:
        """
        Save multiple analytics records in a batch

        Args:
            records_data: List of analytics record data dictionaries

        Returns:
            Number of records saved
        """
        saved_count = 0
        try:
            with self.get_session() as session:
                for record_data in records_data:
                    record = AnalyticsRecord(
                        record_type=record_data.get("record_type"),
                        metric_name=record_data.get("metric_name"),
                        value=record_data.get("value"),
                        asset=record_data.get("asset"),
                        window=record_data.get("window"),
                        previous_value=record_data.get("previous_value"),
                        change_percentage=record_data.get("change_percentage"),
                        trend_direction=record_data.get("trend_direction"),
                        extra_data=record_data.get("extra_data"),
                        timestamp=record_data.get("timestamp", datetime.utcnow()),
                    )
                    session.add(record)
                    saved_count += 1

                logger.info(f"Saved {saved_count} analytics records")
        except SQLAlchemyError as e:
            logger.error(f"Failed to save analytics records batch: {e}")

        return saved_count

    def get_analytics_records(
        self,
        record_type: Optional[str] = None,
        asset: Optional[str] = None,
        metric_name: Optional[str] = None,
        hours: int = 24,
        limit: int = 100,
    ) -> List[AnalyticsRecord]:
        """
        Get analytics records

        Args:
            record_type: Optional record type filter
            asset: Optional asset filter
            metric_name: Optional metric name filter
            hours: Time window in hours
            limit: Maximum number of results

        Returns:
            List of AnalyticsRecord objects
        """
        try:
            with self.get_session() as session:
                cutoff_time = datetime.utcnow() - timedelta(hours=hours)
                stmt = (
                    select(AnalyticsRecord)
                    .where(AnalyticsRecord.timestamp >= cutoff_time)
                    .order_by(desc(AnalyticsRecord.timestamp))
                    .limit(limit)
                )

                if record_type:
                    stmt = stmt.where(AnalyticsRecord.record_type == record_type)
                if asset:
                    stmt = stmt.where(AnalyticsRecord.asset == asset)
                if metric_name:
                    stmt = stmt.where(AnalyticsRecord.metric_name == metric_name)

                results = session.execute(stmt).scalars().all()
                logger.debug(f"Retrieved {len(results)} analytics records")
                return results
        except SQLAlchemyError as e:
            logger.error(f"Failed to retrieve analytics records: {e}")
            return []

    # Legacy News Insights Methods (kept for backward compatibility)

    def save_news_insight(
        self,
        sentiment_result: Dict[str, Any],
        article_data: Optional[Dict[str, Any]] = None,
    ) -> Optional[NewsInsight]:
        """
        Save a news sentiment analysis result

        Args:
            sentiment_result: Sentiment analysis result dictionary
            article_data: Optional article metadata

        Returns:
            NewsInsight object if successful, None otherwise
        """
        try:
            with self.get_session() as session:
                insight = NewsInsight(
                    article_id=article_data.get("id") if article_data else None,
                    article_title=article_data.get("title") if article_data else None,
                    article_url=article_data.get("url") if article_data else None,
                    source=article_data.get("source") if article_data else None,
                    sentiment_score=sentiment_result["compound_score"],
                    positive_score=sentiment_result["positive"],
                    negative_score=sentiment_result["negative"],
                    neutral_score=sentiment_result["neutral"],
                    sentiment_label=sentiment_result["sentiment_label"],
                    keywords=article_data.get("keywords") if article_data else None,
                    language=article_data.get("language") if article_data else None,
                    article_published_at=(
                        article_data.get("published_at") if article_data else None
                    ),
                )
                session.add(insight)
                session.flush()
                logger.debug(f"Saved news insight: {insight.id}")
                return insight
        except SQLAlchemyError as e:
            logger.error(f"Failed to save news insight: {e}")
            return None

    def save_news_insights_batch(
        self, sentiment_results: List[Dict[str, Any]], articles_data: List[Dict[str, Any]] = None
    ) -> int:
        """
        Save multiple news insights in a batch

        Args:
            sentiment_results: List of sentiment analysis results
            articles_data: Optional list of article metadata

        Returns:
            Number of insights saved
        """
        saved_count = 0
        try:
            with self.get_session() as session:
                for i, result in enumerate(sentiment_results):
                    article_data = articles_data[i] if articles_data and i < len(articles_data) else None
                    
                    insight = NewsInsight(
                        article_id=article_data.get("id") if article_data else None,
                        article_title=article_data.get("title") if article_data else None,
                        article_url=article_data.get("url") if article_data else None,
                        source=article_data.get("source") if article_data else None,
                        sentiment_score=result["compound_score"],
                        positive_score=result["positive"],
                        negative_score=result["negative"],
                        neutral_score=result["neutral"],
                        sentiment_label=result["sentiment_label"],
                        keywords=article_data.get("keywords") if article_data else None,
                        language=article_data.get("language") if article_data else None,
                        article_published_at=(
                            article_data.get("published_at") if article_data else None
                        ),
                    )
                    session.add(insight)
                    saved_count += 1
                
                logger.info(f"Saved {saved_count} news insights")
        except SQLAlchemyError as e:
            logger.error(f"Failed to save news insights batch: {e}")
        
        return saved_count

    def get_recent_news_insights(
        self, limit: int = 100, hours: int = 24
    ) -> List[NewsInsight]:
        """
        Get recent news insights

        Args:
            limit: Maximum number of results
            hours: Time window in hours

        Returns:
            List of NewsInsight objects
        """
        try:
            with self.get_session() as session:
                cutoff_time = datetime.utcnow() - timedelta(hours=hours)
                stmt = (
                    select(NewsInsight)
                    .where(NewsInsight.analyzed_at >= cutoff_time)
                    .order_by(desc(NewsInsight.analyzed_at))
                    .limit(limit)
                )
                results = session.execute(stmt).scalars().all()
                logger.debug(f"Retrieved {len(results)} news insights")
                return results
        except SQLAlchemyError as e:
            logger.error(f"Failed to retrieve news insights: {e}")
            return []

    # Legacy Asset Trends Methods (kept for backward compatibility)

    def save_asset_trend(
        self,
        asset: str,
        metric_name: str,
        window: str,
        trend_data: Dict[str, Any],
    ) -> Optional[AssetTrend]:
        """
        Save an asset trend

        Args:
            asset: Asset symbol (e.g., 'XLM')
            metric_name: Metric name (e.g., 'sentiment_score')
            window: Time window (e.g., '24h')
            trend_data: Trend data dictionary

        Returns:
            AssetTrend object if successful, None otherwise
        """
        try:
            with self.get_session() as session:
                trend = AssetTrend(
                    asset=asset,
                    metric_name=metric_name,
                    window=window,
                    trend_direction=trend_data["trend_direction"],
                    score=trend_data.get("score", 0.0),
                    current_value=trend_data["current_value"],
                    previous_value=trend_data["previous_value"],
                    change_percentage=trend_data["change_percentage"],
                    extra_data=trend_data.get("extra_data") or trend_data.get("metadata"),
                )
                session.add(trend)
                session.flush()
                logger.debug(f"Saved asset trend: {asset}/{metric_name}")
                return trend
        except SQLAlchemyError as e:
            logger.error(f"Failed to save asset trend: {e}")
            return None

    def save_asset_trends_batch(
        self, asset: str, window: str, trends: List[Dict[str, Any]]
    ) -> int:
        """
        Save multiple asset trends in a batch

        Args:
            asset: Asset symbol
            window: Time window
            trends: List of trend dictionaries

        Returns:
            Number of trends saved
        """
        saved_count = 0
        try:
            with self.get_session() as session:
                for trend_data in trends:
                    trend = AssetTrend(
                        asset=asset,
                        metric_name=trend_data["metric_name"],
                        window=window,
                        trend_direction=trend_data["trend_direction"],
                        score=trend_data.get("score", 0.0),
                        current_value=trend_data["current_value"],
                        previous_value=trend_data["previous_value"],
                        change_percentage=trend_data["change_percentage"],
                        extra_data=trend_data.get("extra_data") or trend_data.get("metadata"),
                    )
                    session.add(trend)
                    saved_count += 1
                
                logger.info(f"Saved {saved_count} asset trends for {asset}")
        except SQLAlchemyError as e:
            logger.error(f"Failed to save asset trends batch: {e}")
        
        return saved_count

    def get_recent_asset_trends(
        self, asset: str, metric_name: Optional[str] = None, limit: int = 100
    ) -> List[AssetTrend]:
        """
        Get recent asset trends

        Args:
            asset: Asset symbol
            metric_name: Optional metric name filter
            limit: Maximum number of results

        Returns:
            List of AssetTrend objects
        """
        try:
            with self.get_session() as session:
                stmt = select(AssetTrend).where(AssetTrend.asset == asset)
                
                if metric_name:
                    stmt = stmt.where(AssetTrend.metric_name == metric_name)
                
                stmt = stmt.order_by(desc(AssetTrend.timestamp)).limit(limit)
                
                results = session.execute(stmt).scalars().all()
                logger.debug(f"Retrieved {len(results)} asset trends for {asset}")
                return results
        except SQLAlchemyError as e:
            logger.error(f"Failed to retrieve asset trends: {e}")
            return []

    def get_sentiment_summary(self, hours: int = 24) -> Dict[str, Any]:
        """
        Get sentiment summary statistics

        Args:
            hours: Time window in hours

        Returns:
            Summary statistics dictionary
        """
        try:
            with self.get_session() as session:
                cutoff_time = datetime.utcnow() - timedelta(hours=hours)
                
                insights = session.execute(
                    select(NewsInsight).where(NewsInsight.analyzed_at >= cutoff_time)
                ).scalars().all()
                
                if not insights:
                    return {
                        "total_articles": 0,
                        "average_sentiment": 0.0,
                        "positive_count": 0,
                        "negative_count": 0,
                        "neutral_count": 0,
                    }
                
                total = len(insights)
                avg_sentiment = sum(i.sentiment_score for i in insights) / total
                positive = sum(1 for i in insights if i.sentiment_label == "positive")
                negative = sum(1 for i in insights if i.sentiment_label == "negative")
                neutral = sum(1 for i in insights if i.sentiment_label == "neutral")
                
                return {
                    "total_articles": total,
                    "average_sentiment": round(avg_sentiment, 4),
                    "positive_count": positive,
                    "negative_count": negative,
                    "neutral_count": neutral,
                    "positive_percentage": round(positive / total * 100, 2),
                    "negative_percentage": round(negative / total * 100, 2),
                    "neutral_percentage": round(neutral / total * 100, 2),
                }
        except SQLAlchemyError as e:
            logger.error(f"Failed to get sentiment summary: {e}")
            return {}

    def cleanup_old_data(self, days: int = 30) -> Dict[str, int]:
        """
        Clean up old analytics data

        Args:
            days: Number of days to keep

        Returns:
            Dictionary with counts of deleted records
        """
        try:
            cutoff_date = datetime.utcnow() - timedelta(days=days)
            deleted_counts = {
                "articles": 0,
                "social_posts": 0,
                "analytics_records": 0,
                "news_insights": 0,
                "asset_trends": 0,
            }
            
            with self.get_session() as session:
                # Delete old articles
                articles_deleted = session.query(Article).filter(
                    Article.created_at < cutoff_date
                ).delete()
                deleted_counts["articles"] = articles_deleted
                
                # Delete old social posts
                posts_deleted = session.query(SocialPost).filter(
                    SocialPost.created_at < cutoff_date
                ).delete()
                deleted_counts["social_posts"] = posts_deleted
                
                # Delete old analytics records
                records_deleted = session.query(AnalyticsRecord).filter(
                    AnalyticsRecord.created_at < cutoff_date
                ).delete()
                deleted_counts["analytics_records"] = records_deleted
                
                # Delete old news insights (legacy)
                news_deleted = session.query(NewsInsight).filter(
                    NewsInsight.created_at < cutoff_date
                ).delete()
                deleted_counts["news_insights"] = news_deleted
                
                # Delete old asset trends (legacy)
                trends_deleted = session.query(AssetTrend).filter(
                    AssetTrend.created_at < cutoff_date
                ).delete()
                deleted_counts["asset_trends"] = trends_deleted
                
                logger.info(f"Cleaned up old data: {deleted_counts}")
                return deleted_counts
        except SQLAlchemyError as e:
            logger.error(f"Failed to cleanup old data: {e}")
            return {
                "articles": 0,
                "social_posts": 0,
                "analytics_records": 0,
                "news_insights": 0,
                "asset_trends": 0,
            }
