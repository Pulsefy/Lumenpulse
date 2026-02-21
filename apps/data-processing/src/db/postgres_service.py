"""
PostgreSQL service for persisting analytics data
"""

import logging
import os
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
from contextlib import contextmanager

from sqlalchemy import create_engine, select, and_, desc
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.exc import SQLAlchemyError

from .models import Base, NewsInsight, AssetTrend

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
                autocommit=False, autoflush=False, bind=self.engine
            )
            logger.info("PostgreSQL service initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize PostgreSQL service: {e}")
            raise

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

    # News Insights Methods

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

    # Asset Trends Methods

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
            deleted_counts = {"news_insights": 0, "asset_trends": 0}
            
            with self.get_session() as session:
                # Delete old news insights
                news_deleted = session.query(NewsInsight).filter(
                    NewsInsight.created_at < cutoff_date
                ).delete()
                deleted_counts["news_insights"] = news_deleted
                
                # Delete old asset trends
                trends_deleted = session.query(AssetTrend).filter(
                    AssetTrend.created_at < cutoff_date
                ).delete()
                deleted_counts["asset_trends"] = trends_deleted
                
                logger.info(f"Cleaned up old data: {deleted_counts}")
                return deleted_counts
        except SQLAlchemyError as e:
            logger.error(f"Failed to cleanup old data: {e}")
            return {"news_insights": 0, "asset_trends": 0}
