#!/usr/bin/env python3
"""
Migration script from analytics.jsonl to PostgreSQL database

This script reads historical data from analytics.jsonl and migrates it to the
PostgreSQL database, creating proper records in the analytics_records table.

Usage:
    python scripts/migrate_jsonl_to_db.py
    python scripts/migrate_jsonl_to_db.py --file data/analytics.jsonl

GitHub Issue: #456
Author: LumenPulse Team
"""

import os
import sys
import json
import argparse
import logging
from datetime import datetime, timezone
from pathlib import Path

# Add the src directory to the Python path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from dotenv import load_dotenv
from db import PostgresService

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)


class JsonlToDbMigrator:
    """
    Migrates data from analytics.jsonl to PostgreSQL database
    """

    def __init__(self, db_service: PostgresService):
        """
        Initialize the migrator

        Args:
            db_service: PostgreSQL service instance
        """
        self.db_service = db_service
        self.stats = {
            "total_records": 0,
            "migrated_records": 0,
            "failed_records": 0,
            "skipped_records": 0,
        }

    def migrate_file(self, file_path: str) -> dict:
        """
        Migrate a JSONL file to the database

        Args:
            file_path: Path to the JSONL file

        Returns:
            Migration statistics dictionary
        """
        logger.info("=" * 60)
        logger.info("JSONL TO DATABASE MIGRATION")
        logger.info("=" * 60)
        logger.info(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        logger.info(f"Input file: {file_path}")
        logger.info("")

        if not os.path.exists(file_path):
            logger.error(f"File not found: {file_path}")
            return self.stats

        try:
            with open(file_path, "r") as f:
                for line_num, line in enumerate(f, 1):
                    line = line.strip()
                    if not line:
                        continue

                    self.stats["total_records"] += 1

                    try:
                        record = json.loads(line)
                        self._migrate_record(record, line_num)
                        self.stats["migrated_records"] += 1

                        if self.stats["migrated_records"] % 100 == 0:
                            logger.info(f"Migrated {self.stats['migrated_records']} records...")

                    except json.JSONDecodeError as e:
                        logger.warning(f"Line {line_num}: Invalid JSON - {e}")
                        self.stats["failed_records"] += 1
                    except Exception as e:
                        logger.warning(f"Line {line_num}: Migration failed - {e}")
                        self.stats["failed_records"] += 1

        except Exception as e:
            logger.error(f"Failed to read file: {e}")

        # Print summary
        logger.info("")
        logger.info("=" * 60)
        logger.info("MIGRATION COMPLETE")
        logger.info("=" * 60)
        logger.info(f"Total records: {self.stats['total_records']}")
        logger.info(f"Migrated: {self.stats['migrated_records']}")
        logger.info(f"Failed: {self.stats['failed_records']}")
        logger.info(f"Skipped: {self.stats['skipped_records']}")

        return self.stats

    def _migrate_record(self, record: dict, line_num: int):
        """
        Migrate a single record from JSONL to database

        Args:
            record: Record dictionary from JSONL
            line_num: Line number for logging
        """
        # Parse timestamp
        timestamp_str = record.get("timestamp")
        if not timestamp_str:
            logger.warning(f"Line {line_num}: Missing timestamp, skipping")
            self.stats["skipped_records"] += 1
            return

        try:
            timestamp = datetime.fromisoformat(timestamp_str.replace("Z", "+00:00"))
        except (ValueError, AttributeError) as e:
            logger.warning(f"Line {line_num}: Invalid timestamp format - {e}")
            self.stats["skipped_records"] += 1
            return

        # Migrate sentiment data
        sentiment_data = record.get("sentiment_data", {})
        if sentiment_data:
            self._migrate_sentiment_data(sentiment_data, timestamp, line_num)

        # Migrate trends data
        trends = record.get("trends", [])
        if trends:
            self._migrate_trends_data(trends, timestamp, line_num)

    def _migrate_sentiment_data(self, sentiment_data: dict, timestamp: datetime, line_num: int):
        """
        Migrate sentiment data to analytics_records

        Args:
            sentiment_data: Sentiment data dictionary
            timestamp: Record timestamp
            line_num: Line number for logging
        """
        try:
            # Save total_items as a record
            if "total_items" in sentiment_data:
                self.db_service.save_analytics_record(
                    record_type="sentiment_summary",
                    metric_name="total_items",
                    value=float(sentiment_data["total_items"]),
                    timestamp=timestamp,
                    extra_data={"source": "jsonl_migration", "line_num": line_num},
                )

            # Save average_compound_score
            if "average_compound_score" in sentiment_data:
                self.db_service.save_analytics_record(
                    record_type="sentiment_summary",
                    metric_name="average_compound_score",
                    value=sentiment_data["average_compound_score"],
                    timestamp=timestamp,
                    extra_data={"source": "jsonl_migration", "line_num": line_num},
                )

            # Save positive_count
            if "positive_count" in sentiment_data:
                self.db_service.save_analytics_record(
                    record_type="sentiment_summary",
                    metric_name="positive_count",
                    value=float(sentiment_data["positive_count"]),
                    timestamp=timestamp,
                    extra_data={"source": "jsonl_migration", "line_num": line_num},
                )

            # Save negative_count
            if "negative_count" in sentiment_data:
                self.db_service.save_analytics_record(
                    record_type="sentiment_summary",
                    metric_name="negative_count",
                    value=float(sentiment_data["negative_count"]),
                    timestamp=timestamp,
                    extra_data={"source": "jsonl_migration", "line_num": line_num},
                )

            # Save neutral_count
            if "neutral_count" in sentiment_data:
                self.db_service.save_analytics_record(
                    record_type="sentiment_summary",
                    metric_name="neutral_count",
                    value=float(sentiment_data["neutral_count"]),
                    timestamp=timestamp,
                    extra_data={"source": "jsonl_migration", "line_num": line_num},
                )

            # Save sentiment distribution
            sentiment_distribution = sentiment_data.get("sentiment_distribution", {})
            if sentiment_distribution:
                for sentiment_type, percentage in sentiment_distribution.items():
                    self.db_service.save_analytics_record(
                        record_type="sentiment_summary",
                        metric_name=f"{sentiment_type}_percentage",
                        value=percentage * 100 if percentage <= 1 else percentage,
                        timestamp=timestamp,
                        extra_data={"source": "jsonl_migration", "line_num": line_num},
                    )

        except Exception as e:
            logger.warning(f"Line {line_num}: Failed to migrate sentiment data - {e}")

    def _migrate_trends_data(self, trends: list, timestamp: datetime, line_num: int):
        """
        Migrate trends data to analytics_records

        Args:
            trends: List of trend dictionaries
            timestamp: Record timestamp
            line_num: Line number for logging
        """
        try:
            for trend in trends:
                metric_name = trend.get("metric_name")
                if not metric_name:
                    continue

                # Parse trend timestamp if available
                trend_timestamp = timestamp
                if "timestamp" in trend:
                    try:
                        trend_timestamp = datetime.fromisoformat(
                            trend["timestamp"].replace("Z", "+00:00")
                        )
                    except (ValueError, AttributeError):
                        pass  # Use record timestamp as fallback

                self.db_service.save_analytics_record(
                    record_type="trend",
                    metric_name=metric_name,
                    value=trend.get("current_value", 0.0),
                    previous_value=trend.get("previous_value"),
                    change_percentage=trend.get("change_percentage"),
                    trend_direction=trend.get("trend_direction"),
                    timestamp=trend_timestamp,
                    extra_data={
                        "source": "jsonl_migration",
                        "line_num": line_num,
                        "score": trend.get("score"),
                    },
                )

        except Exception as e:
            logger.warning(f"Line {line_num}: Failed to migrate trends data - {e}")


def parse_args():
    """Parse command line arguments"""
    parser = argparse.ArgumentParser(
        description="Migrate analytics.jsonl data to PostgreSQL database",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python scripts/migrate_jsonl_to_db.py
  python scripts/migrate_jsonl_to_db.py --file data/analytics.jsonl
  python scripts/migrate_jsonl_to_db.py --file data/backfill/news_2026-01-23.json
        """,
    )

    parser.add_argument(
        "--file",
        type=str,
        default="data/analytics.jsonl",
        help="Path to JSONL file to migrate (default: data/analytics.jsonl)",
    )

    parser.add_argument(
        "--verbose", "-v", action="store_true", help="Enable verbose/debug logging"
    )

    return parser.parse_args()


def main():
    """Main entry point for the migration script"""
    # Load environment variables
    env_path = Path(__file__).parent.parent / ".env"
    load_dotenv(env_path)

    # Parse arguments
    args = parse_args()

    # Set logging level
    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    # Initialize database service
    try:
        db_service = PostgresService()
        logger.info(f"Connected to database: {db_service.database_url}")
    except Exception as e:
        logger.error(f"Failed to connect to database: {e}")
        sys.exit(1)

    # Run migration
    try:
        migrator = JsonlToDbMigrator(db_service)
        stats = migrator.migrate_file(args.file)

        # Exit with appropriate code
        if stats["failed_records"] > 0:
            logger.warning("Some records failed to migrate")
            sys.exit(1)

        sys.exit(0)

    except KeyboardInterrupt:
        logger.info("\nMigration interrupted by user")
        sys.exit(130)
    except Exception as e:
        logger.error(f"Migration failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
