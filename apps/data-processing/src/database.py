"""
Database service module - stores analytics data
Supports both file-based storage (legacy) and PostgreSQL persistence
"""

import json
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)


class AnalyticsRecord:
    """Record of analytics data"""

    def __init__(
        self,
        timestamp: datetime,
        news_count: int,
        sentiment_data: Dict[str, Any],
        trends: List[Dict[str, Any]],
    ):
        self.timestamp = timestamp
        self.news_count = news_count
        self.sentiment_data = sentiment_data
        self.trends = trends

    def to_dict(self) -> Dict[str, Any]:
        return {
            "timestamp": self.timestamp.isoformat(),
            "news_count": self.news_count,
            "sentiment_data": self.sentiment_data,
            "trends": self.trends,
        }


class DatabaseService:
    """
    Stores and retrieves analytics data
    Supports both file-based storage and PostgreSQL
    """

    def __init__(
        self,
        storage_dir: str = "./data",
        use_postgres: bool = True,
        postgres_service: Optional[Any] = None,
    ):
        # File-based storage (legacy/fallback)
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.analytics_file = self.storage_dir / "analytics.jsonl"
        self.latest_file = self.storage_dir / "latest.json"
        
        # PostgreSQL storage
        self.use_postgres = use_postgres
        self.postgres_service = postgres_service
        
        if self.use_postgres and self.postgres_service:
            logger.info("DatabaseService initialized with PostgreSQL support")
        else:
            logger.info("DatabaseService initialized with file-based storage only")

    def save_analytics(self, record: AnalyticsRecord) -> bool:
        """
        Save analytics record to storage

        Args:
            record: AnalyticsRecord to save

        Returns:
            True if successful, False otherwise
        """
        success = True
        
        # Save to file-based storage (always for backward compatibility)
        try:
            # Append to JSONL file for historical data
            with open(self.analytics_file, "a") as f:
                f.write(json.dumps(record.to_dict()) + "\n")

            # Update latest.json for quick access
            with open(self.latest_file, "w") as f:
                json.dump(record.to_dict(), f, indent=2)

            logger.info(f"Analytics saved to file: {record.news_count} news items analyzed")
        except Exception as e:
            logger.error(f"Error saving analytics to file: {e}")
            success = False
        
        # Save to PostgreSQL if enabled
        if self.use_postgres and self.postgres_service:
            try:
                # Save sentiment data as news insights
                if record.sentiment_data and "results" in record.sentiment_data:
                    sentiment_results = record.sentiment_data["results"]
                    if sentiment_results:
                        saved_count = self.postgres_service.save_news_insights_batch(
                            [r.to_dict() if hasattr(r, "to_dict") else r for r in sentiment_results]
                        )
                        logger.info(f"Saved {saved_count} news insights to PostgreSQL")
                
                # Save trends as asset trends
                if record.trends:
                    for trend in record.trends:
                        trend_data = trend.to_dict() if hasattr(trend, "to_dict") else trend
                        self.postgres_service.save_asset_trend(
                            asset="XLM",  # Default asset
                            metric_name=trend_data.get("metric_name", "unknown"),
                            window="24h",  # Default window
                            trend_data=trend_data,
                        )
                    logger.info(f"Saved {len(record.trends)} trends to PostgreSQL")
                    
            except Exception as e:
                logger.error(f"Error saving analytics to PostgreSQL: {e}")
                # Don't fail if PostgreSQL save fails
        
        return success

    def get_latest_analytics(self) -> Dict[str, Any]:
        """
        Get the latest analytics record

        Returns:
            Latest analytics data or empty dict if not available
        """
        try:
            if self.latest_file.exists():
                with open(self.latest_file, "r") as f:
                    return json.load(f)
        except Exception as e:
            logger.error(f"Error reading latest analytics: {e}")

        return {}

    def get_analytics_history(self, limit: int = 24) -> List[Dict[str, Any]]:
        """
        Get historical analytics data

        Args:
            limit: Maximum number of records to return

        Returns:
            List of analytics records (most recent first)
        """
        records = []
        try:
            if self.analytics_file.exists():
                with open(self.analytics_file, "r") as f:
                    lines = f.readlines()
                    # Get last 'limit' records in reverse order
                    for line in reversed(lines[-limit:]):
                        records.append(json.loads(line))
        except Exception as e:
            logger.error(f"Error reading analytics history: {e}")

        return records

    def expose_metrics(self) -> Dict[str, Any]:
        """
        Expose all metrics for monitoring/API purposes

        Returns:
            Dictionary of all available metrics
        """
        latest = self.get_latest_analytics()
        history = self.get_analytics_history(limit=24)

        metrics = {
            "latest": latest,
            "history": history,
            "history_count": len(history),
            "last_updated": latest.get("timestamp") if latest else None,
        }
        
        # Add PostgreSQL metrics if available
        if self.use_postgres and self.postgres_service:
            try:
                pg_summary = self.postgres_service.get_sentiment_summary(hours=24)
                metrics["postgres_summary"] = pg_summary
            except Exception as e:
                logger.error(f"Error getting PostgreSQL metrics: {e}")
        
        return metrics

    def clear_old_data(self, days: int = 30) -> int:
        """
        Clear analytics data older than specified days

        Args:
            days: Number of days to keep

        Returns:
            Number of records deleted
        """
        deleted_count = 0
        
        # Clear file-based data
        try:
            from datetime import timedelta

            cutoff_date = datetime.utcnow() - timedelta(days=days)

            if not self.analytics_file.exists():
                return 0

            with open(self.analytics_file, "r") as f:
                lines = f.readlines()

            # Filter out old records
            new_lines = []
            for line in lines:
                try:
                    record = json.loads(line)
                    record_date = datetime.fromisoformat(record.get("timestamp", ""))
                    if record_date > cutoff_date:
                        new_lines.append(line)
                    else:
                        deleted_count += 1
                except:
                    new_lines.append(line)

            with open(self.analytics_file, "w") as f:
                f.writelines(new_lines)

            logger.info(f"Deleted {deleted_count} old analytics records from files")
        except Exception as e:
            logger.error(f"Error clearing old file data: {e}")
        
        # Clear PostgreSQL data
        if self.use_postgres and self.postgres_service:
            try:
                pg_deleted = self.postgres_service.cleanup_old_data(days=days)
                logger.info(f"Deleted old PostgreSQL data: {pg_deleted}")
            except Exception as e:
                logger.error(f"Error clearing old PostgreSQL data: {e}")
        
        return deleted_count
