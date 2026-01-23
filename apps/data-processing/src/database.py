"""
Database service module - stores analytics data
"""
import json
import logging
from typing import Dict, Any, List
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)


class AnalyticsRecord:
    """Record of analytics data"""
    def __init__(self, timestamp: datetime, news_count: int, sentiment_data: Dict[str, Any], trends: List[Dict[str, Any]]):
        self.timestamp = timestamp
        self.news_count = news_count
        self.sentiment_data = sentiment_data
        self.trends = trends

    def to_dict(self) -> Dict[str, Any]:
        return {
            "timestamp": self.timestamp.isoformat(),
            "news_count": self.news_count,
            "sentiment_data": self.sentiment_data,
            "trends": self.trends
        }


class DatabaseService:
    """Stores and retrieves analytics data"""

    def __init__(self, storage_dir: str = "./data"):
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.analytics_file = self.storage_dir / "analytics.jsonl"
        self.latest_file = self.storage_dir / "latest.json"

    def save_analytics(self, record: AnalyticsRecord) -> bool:
        """
        Save analytics record to storage
        
        Args:
            record: AnalyticsRecord to save
            
        Returns:
            True if successful, False otherwise
        """
        try:
            # Append to JSONL file for historical data
            with open(self.analytics_file, 'a') as f:
                f.write(json.dumps(record.to_dict()) + '\n')

            # Update latest.json for quick access
            with open(self.latest_file, 'w') as f:
                json.dump(record.to_dict(), f, indent=2)

            logger.info(f"Analytics saved: {record.news_count} news items analyzed")
            return True
        except Exception as e:
            logger.error(f"Error saving analytics: {e}")
            return False

    def get_latest_analytics(self) -> Dict[str, Any]:
        """
        Get the latest analytics record
        
        Returns:
            Latest analytics data or empty dict if not available
        """
        try:
            if self.latest_file.exists():
                with open(self.latest_file, 'r') as f:
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
                with open(self.analytics_file, 'r') as f:
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

        return {
            "latest": latest,
            "history": history,
            "history_count": len(history),
            "last_updated": latest.get("timestamp") if latest else None
        }

    def clear_old_data(self, days: int = 30) -> int:
        """
        Clear analytics data older than specified days
        
        Args:
            days: Number of days to keep
            
        Returns:
            Number of records deleted
        """
        try:
            from datetime import timedelta
            cutoff_date = datetime.utcnow() - timedelta(days=days)
            
            if not self.analytics_file.exists():
                return 0

            deleted_count = 0
            with open(self.analytics_file, 'r') as f:
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

            with open(self.analytics_file, 'w') as f:
                f.writelines(new_lines)

            logger.info(f"Deleted {deleted_count} old analytics records")
            return deleted_count
        except Exception as e:
            logger.error(f"Error clearing old data: {e}")
            return 0
