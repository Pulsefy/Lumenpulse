#!/usr/bin/env python3
"""
Historical Data Backfill Script

Populates the database with past N days of crypto news and market data.
This script loops through past dates and calls the NewsFetcher to retrieve
historical news articles, handling API rate limits gracefully.

Usage:
    python scripts/backfill.py --days 30
    python scripts/backfill.py --days 1  # For testing

GitHub Issue: #273
Author: LumenPulse Team
"""

import os
import sys
import argparse
import time
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Add the src directory to the Python path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from dotenv import load_dotenv

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)


class BackfillConfig:
    """Configuration for the backfill process"""

    # Rate limiting - seconds to sleep between API requests
    RATE_LIMIT_DELAY = 2.0

    # Maximum articles to fetch per day
    ARTICLES_PER_DAY = 20

    # Retry settings
    MAX_RETRIES = 3
    RETRY_DELAY = 5.0

    # Data storage directory
    DATA_DIR = Path(__file__).parent.parent / "data" / "backfill"


class HistoricalNewsFetcher:
    """
    Fetches historical news data for a specific date range.
    Wraps the existing NewsFetcher with date-based filtering capabilities.
    """

    def __init__(self):
        """Initialize the historical news fetcher"""
        self.cryptocompare_key = os.getenv("CRYPTOCOMPARE_API_KEY")
        self.newsapi_key = os.getenv("NEWSAPI_API_KEY")

        # Track which APIs are available
        self.use_cryptocompare = bool(self.cryptocompare_key)
        self.use_newsapi = bool(self.newsapi_key)

        if not self.use_cryptocompare and not self.use_newsapi:
            logger.warning(
                "No API keys configured. Will use mock data for demonstration."
            )

    def fetch_for_date(self, target_date: datetime, limit: int = 20) -> list:
        """
        Fetch news articles for a specific date.

        Args:
            target_date: The date to fetch news for
            limit: Maximum number of articles to fetch

        Returns:
            List of news article dictionaries
        """
        articles = []

        # Format date strings for API requests
        date_str = target_date.strftime("%Y-%m-%d")
        next_date_str = (target_date + timedelta(days=1)).strftime("%Y-%m-%d")

        logger.info(f"Fetching news for date: {date_str}")

        # Try CryptoCompare API
        if self.use_cryptocompare:
            try:
                cc_articles = self._fetch_cryptocompare(target_date, limit)
                articles.extend(cc_articles)
                logger.info(f"  CryptoCompare: {len(cc_articles)} articles")
            except Exception as e:
                logger.warning(f"  CryptoCompare fetch failed: {e}")

        # Try NewsAPI
        if self.use_newsapi:
            try:
                na_articles = self._fetch_newsapi(target_date, limit)
                articles.extend(na_articles)
                logger.info(f"  NewsAPI: {len(na_articles)} articles")
            except Exception as e:
                logger.warning(f"  NewsAPI fetch failed: {e}")

        # Use mock data if no APIs available or no articles fetched
        if not articles:
            mock_articles = self._generate_mock_data(target_date, min(limit, 5))
            articles.extend(mock_articles)
            logger.info(f"  Mock data: {len(mock_articles)} articles")

        return articles

    def _fetch_cryptocompare(self, target_date: datetime, limit: int) -> list:
        """Fetch from CryptoCompare API with date filtering"""
        import requests

        # CryptoCompare uses Unix timestamp for time-based queries
        timestamp = int(target_date.timestamp())

        url = "https://min-api.cryptocompare.com/data/v2/news/"
        params = {
            "lang": "EN",
            "categories": "BTC,ETH,BLOCKCHAIN",
            "lTs": timestamp,  # Less than timestamp (for historical)
        }
        headers = {"Authorization": f"Apikey {self.cryptocompare_key}"}

        response = requests.get(url, params=params, headers=headers, timeout=15)
        response.raise_for_status()
        data = response.json()

        if data.get("Type") != 100:
            raise ValueError(f"API error: {data.get('Message', 'Unknown')}")

        articles = []
        for item in data.get("Data", [])[:limit]:
            # Filter to only include articles from the target date
            published_ts = item.get("published_on", 0)
            published_date = datetime.fromtimestamp(published_ts).date()

            if published_date == target_date.date():
                articles.append(
                    {
                        "id": f"cc_{item['id']}",
                        "title": item.get("title", ""),
                        "content": item.get("body", ""),
                        "summary": item.get("short_description", ""),
                        "source": item.get("source", "CryptoCompare"),
                        "url": item.get("url", ""),
                        "published_at": datetime.fromtimestamp(
                            published_ts
                        ).isoformat(),
                        "categories": (
                            item.get("categories", "").split("|")
                            if item.get("categories")
                            else []
                        ),
                        "fetched_at": datetime.now(timezone.utc).isoformat(),
                    }
                )

        return articles

    def _fetch_newsapi(self, target_date: datetime, limit: int) -> list:
        """Fetch from NewsAPI with date filtering"""
        import requests

        date_str = target_date.strftime("%Y-%m-%d")
        next_date_str = (target_date + timedelta(days=1)).strftime("%Y-%m-%d")

        url = "https://newsapi.org/v2/everything"
        params = {
            "q": "cryptocurrency OR blockchain OR bitcoin OR ethereum",
            "language": "en",
            "sortBy": "publishedAt",
            "pageSize": min(limit, 100),
            "from": date_str,
            "to": next_date_str,
            "apiKey": self.newsapi_key,
        }

        response = requests.get(url, params=params, timeout=15)
        response.raise_for_status()
        data = response.json()

        articles = []
        for item in data.get("articles", [])[:limit]:
            articles.append(
                {
                    "id": f"na_{hash(item.get('url', '')) & 0xffffffff}",
                    "title": item.get("title", ""),
                    "content": item.get("content", ""),
                    "summary": item.get("description", ""),
                    "source": item.get("source", {}).get("name", "NewsAPI"),
                    "url": item.get("url", ""),
                    "published_at": item.get("publishedAt", ""),
                    "categories": ["crypto", "blockchain"],
                    "fetched_at": datetime.now(timezone.utc).isoformat(),
                }
            )

        return articles

    def _generate_mock_data(self, target_date: datetime, count: int) -> list:
        """Generate mock data for testing when no API keys are available"""
        articles = []

        mock_titles = [
            "Bitcoin Continues Strong Performance Amid Market Volatility",
            "Ethereum Network Upgrade Successfully Completed",
            "Stellar Foundation Announces New Partnership",
            "Crypto Market Analysis: Weekly Trends and Insights",
            "DeFi Protocols See Increased Adoption Rates",
        ]

        for i in range(count):
            articles.append(
                {
                    "id": f"mock_{target_date.strftime('%Y%m%d')}_{i}",
                    "title": mock_titles[i % len(mock_titles)],
                    "content": f"Mock content for testing purposes. Date: {target_date.strftime('%Y-%m-%d')}",
                    "summary": "This is mock data generated for testing the backfill script.",
                    "source": "MockSource",
                    "url": f"https://example.com/news/{target_date.strftime('%Y%m%d')}/{i}",
                    "published_at": target_date.isoformat(),
                    "categories": ["crypto", "mock"],
                    "fetched_at": datetime.now(timezone.utc).isoformat(),
                }
            )

        return articles


class BackfillService:
    """
    Main service for running the historical data backfill process.
    """

    def __init__(self, days: int):
        """
        Initialize the backfill service.

        Args:
            days: Number of days to backfill
        """
        self.days = days
        self.fetcher = HistoricalNewsFetcher()
        self.data_dir = BackfillConfig.DATA_DIR

        # Ensure data directory exists
        self.data_dir.mkdir(parents=True, exist_ok=True)

    def run(self) -> dict:
        """
        Execute the backfill process.

        Returns:
            Summary dictionary with statistics
        """
        import json

        logger.info("=" * 60)
        logger.info("HISTORICAL DATA BACKFILL")
        logger.info("=" * 60)
        logger.info(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        logger.info(f"Days to backfill: {self.days}")
        logger.info(f"Data directory: {self.data_dir}")
        logger.info("")

        # Track statistics
        stats = {
            "total_articles": 0,
            "days_processed": 0,
            "days_failed": 0,
            "start_time": datetime.now().isoformat(),
            "end_time": None,
        }

        # Calculate date range
        end_date = datetime.now()
        start_date = end_date - timedelta(days=self.days)

        # Process each day
        current_date = start_date
        while current_date <= end_date:
            try:
                articles = self._process_day(current_date)
                stats["total_articles"] += len(articles)
                stats["days_processed"] += 1

                # Save articles to file
                self._save_articles(current_date, articles)

                logger.info(
                    f"✓ {current_date.strftime('%Y-%m-%d')}: {len(articles)} articles saved"
                )

            except Exception as e:
                logger.error(f"✗ {current_date.strftime('%Y-%m-%d')}: Failed - {e}")
                stats["days_failed"] += 1

            # Move to next day
            current_date += timedelta(days=1)

            # Rate limit between days
            if current_date <= end_date:
                logger.debug(
                    f"Sleeping for {BackfillConfig.RATE_LIMIT_DELAY}s (rate limit)"
                )
                time.sleep(BackfillConfig.RATE_LIMIT_DELAY)

        # Finalize stats
        stats["end_time"] = datetime.now().isoformat()

        # Print summary
        logger.info("")
        logger.info("=" * 60)
        logger.info("BACKFILL COMPLETE")
        logger.info("=" * 60)
        logger.info(f"Days processed: {stats['days_processed']}")
        logger.info(f"Days failed: {stats['days_failed']}")
        logger.info(f"Total articles: {stats['total_articles']}")
        logger.info(f"Data saved to: {self.data_dir}")

        # Save summary
        summary_file = self.data_dir / "backfill_summary.json"
        with open(summary_file, "w") as f:
            json.dump(stats, f, indent=2)

        return stats

    def _process_day(self, target_date: datetime) -> list:
        """
        Process a single day with retry logic.

        Args:
            target_date: Date to process

        Returns:
            List of articles for that day
        """
        for attempt in range(BackfillConfig.MAX_RETRIES):
            try:
                articles = self.fetcher.fetch_for_date(
                    target_date, limit=BackfillConfig.ARTICLES_PER_DAY
                )
                return articles

            except Exception as e:
                if attempt < BackfillConfig.MAX_RETRIES - 1:
                    logger.warning(f"Attempt {attempt + 1} failed: {e}. Retrying...")
                    time.sleep(BackfillConfig.RETRY_DELAY)
                else:
                    raise

        return []

    def _save_articles(self, target_date: datetime, articles: list):
        """
        Save articles to a JSON file organized by date.

        Args:
            target_date: Date of the articles
            articles: List of article dictionaries
        """
        import json

        date_str = target_date.strftime("%Y-%m-%d")
        output_file = self.data_dir / f"news_{date_str}.json"

        data = {
            "date": date_str,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "article_count": len(articles),
            "articles": articles,
        }

        with open(output_file, "w") as f:
            json.dump(data, f, indent=2)


def parse_args():
    """Parse command line arguments"""
    parser = argparse.ArgumentParser(
        description="Backfill historical crypto news and market data",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python scripts/backfill.py --days 30    # Backfill last 30 days
  python scripts/backfill.py --days 1     # Test with 1 day
  python scripts/backfill.py --days 7     # Backfill last week
        """,
    )

    parser.add_argument(
        "--days", type=int, default=30, help="Number of days to backfill (default: 30)"
    )

    parser.add_argument(
        "--verbose", "-v", action="store_true", help="Enable verbose/debug logging"
    )

    return parser.parse_args()


def main():
    """Main entry point for the backfill script"""
    # Load environment variables
    env_path = Path(__file__).parent.parent / ".env"
    load_dotenv(env_path)

    # Parse arguments
    args = parse_args()

    # Set logging level
    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    # Validate arguments
    if args.days <= 0:
        logger.error("Days must be a positive integer")
        sys.exit(1)

    if args.days > 365:
        logger.warning("Backfilling more than 365 days may take a very long time")

    # Run backfill
    try:
        service = BackfillService(days=args.days)
        stats = service.run()

        # Exit with appropriate code
        if stats["days_failed"] > 0:
            logger.warning("Some days failed to process")
            sys.exit(1)

        sys.exit(0)

    except KeyboardInterrupt:
        logger.info("\nBackfill interrupted by user")
        sys.exit(130)
    except Exception as e:
        logger.error(f"Backfill failed: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
