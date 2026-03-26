#!/usr/bin/env python3
"""
Historical Backfill Script for LumenPulse Analytics Pipeline

This script backfills historical data for the last N days to ensure
fresh deployments have populated charts and analytics data.

Usage:
    python scripts/backfill.py --days 7
    python scripts/backfill.py --days 30 --dry-run
"""

import argparse
import sys
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Any
import os

# Add the data processing src directory to Python path
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'apps', 'data-processing', 'src'))

# Import existing fetchers and analyzers
from ingestion.news_fetcher import fetch_news
from ingestion.stellar_fetcher import get_asset_volume, get_network_overview
from analytics.market_analyzer import MarketAnalyzer, MarketData

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
    ]
)
logger = logging.getLogger(__name__)


class HistoricalBackfill:
    """
    Handles historical data backfill for analytics pipeline.
    
    Features:
    - Fetch news and on-chain data for specified time periods
    - Process data through existing analyzers
    - Store results for each time window
    - Support dry-run mode for testing
    """
    
    def __init__(self, dry_run: bool = False):
        self.dry_run = dry_run
        self.results = []
        
    def backfill_period(self, start_date: datetime, end_date: datetime) -> Dict[str, Any]:
        """
        Backfill data for a specific time period.
        
        Args:
            start_date: Start of the time period
            end_date: End of the time period
            
        Returns:
            Dictionary with backfill results for this period
        """
        logger.info(f"Processing period: {start_date.date()} to {end_date.date()}")
        
        if self.dry_run:
            logger.info(f"[DRY-RUN] Would fetch data for {start_date.date()} to {end_date.date()}")
            return {
                "start_date": start_date.isoformat(),
                "end_date": end_date.isoformat(),
                "dry_run": True,
                "status": "planned"
            }
        
        try:
            # Step 1: Fetch news data for this period
            logger.info(f"Fetching news for {start_date.date()} to {end_date.date()}")
            # Note: The existing fetch_news doesn't support date ranges, 
            # so we'll fetch recent news and filter by date
            news_articles = fetch_news(limit=50)  # Get more for historical coverage
            
            # Filter news by date range
            filtered_news = [
                article for article in news_articles
                if start_date <= article.published_at <= end_date
            ]
            
            logger.info(f"Found {len(filtered_news)} news articles in date range")
            
            # Step 2: Fetch on-chain data for this period
            logger.info(f"Fetching Stellar data for {start_date.date()} to {end_date.date()}")
            
            # Calculate hours between dates for volume fetch
            hours_diff = int((end_date - start_date).total_seconds() / 3600)
            volume_hours = min(max(hours_diff, 24), 168)  # Between 1h and 7 days
            
            # Get volume data (using existing function)
            volume_data = get_asset_volume("XLM", hours=volume_hours)
            
            # Get network stats
            network_stats = get_network_overview()
            
            # Step 3: Process through market analyzer
            logger.info(f"Analyzing market data for {start_date.date()} to {end_date.date()}")
            
            # Calculate sentiment from news (simplified - would use sentiment analyzer)
            sentiment_score = 0.0
            if filtered_news:
                # Mock sentiment calculation (replace with actual sentiment analysis)
                sentiment_score = min(len(filtered_news) * 0.1, 1.0)
            
            # Create market data for analysis
            market_data = MarketData(
                sentiment_score=sentiment_score,
                volume_change=0.0  # Would calculate from historical data
            )
            
            # Analyze market trend
            trend, health_score, metrics = MarketAnalyzer.analyze_trend(market_data)
            
            # Step 4: Generate explanation
            explanation = MarketAnalyzer.get_explanation(health_score, trend)
            
            result = {
                "start_date": start_date.isoformat(),
                "end_date": end_date.isoformat(),
                "news_count": len(filtered_news),
                "volume_data": volume_data,
                "network_stats": network_stats,
                "market_analysis": {
                    "trend": trend.value,
                    "health_score": health_score,
                    "sentiment_score": sentiment_score,
                    "metrics": metrics,
                    "explanation": explanation
                },
                "status": "completed",
                "processed_at": datetime.now().isoformat()
            }
            
            logger.info(f"Successfully processed period: {start_date.date()} to {end_date.date()}")
            logger.info(f"  - News articles: {len(filtered_news)}")
            logger.info(f"  - XLM Volume: {volume_data.get('total_volume', 0):.2f}")
            logger.info(f"  - Market Trend: {trend.value.upper()}")
            logger.info(f"  - Health Score: {health_score:.2f}")
            
            return result
            
        except Exception as e:
            error_msg = f"Error processing period {start_date.date()} to {end_date.date()}: {e}"
            logger.error(error_msg)
            return {
                "start_date": start_date.isoformat(),
                "end_date": end_date.isoformat(),
                "error": str(e),
                "status": "failed",
                "processed_at": datetime.now().isoformat()
            }
    
    def backfill_days(self, days: int) -> List[Dict[str, Any]]:
        """
        Backfill data for the last N days.
        
        Args:
            days: Number of days to backfill
            
        Returns:
            List of backfill results for each day
        """
        logger.info(f"Starting historical backfill for last {days} days")
        
        results = []
        now = datetime.now()
        
        # Process each day
        for day_offset in range(days):
            # Calculate date range for this day
            end_date = now - timedelta(days=day_offset)
            start_date = end_date - timedelta(hours=24)  # 24-hour window
            
            # Process this day
            result = self.backfill_period(start_date, end_date)
            results.append(result)
            
            # Small delay to be nice to APIs
            if not self.dry_run:
                import time
                time.sleep(1)
        
        # Summary
        successful = sum(1 for r in results if r.get("status") == "completed")
        failed = sum(1 for r in results if r.get("status") == "failed")
        
        logger.info(f"Backfill completed for {days} days")
        logger.info(f"  - Successful: {successful}")
        logger.info(f"  - Failed: {failed}")
        logger.info(f"  - Success Rate: {(successful/days)*100:.1f}%")
        
        return results
    
    def generate_summary(self, results: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Generate a summary of the backfill operation.
        
        Args:
            results: List of backfill results
            
        Returns:
            Summary dictionary
        """
        successful = sum(1 for r in results if r.get("status") == "completed")
        failed = sum(1 for r in results if r.get("status") == "failed")
        total_news = sum(r.get("news_count", 0) for r in results)
        total_volume = sum(r.get("volume_data", {}).get("total_volume", 0) for r in results)
        
        summary = {
            "total_periods": len(results),
            "successful": successful,
            "failed": failed,
            "success_rate": (successful / len(results)) * 100 if results else 0,
            "total_news_articles": total_news,
            "total_volume_xlm": total_volume,
            "average_volume_per_day": total_volume / successful if successful > 0 else 0,
            "backfill_duration_hours": len(results) * 24,
            "completed_at": datetime.now().isoformat()
        }
        
        if self.dry_run:
            summary["dry_run"] = True
        
        return summary


def parse_arguments():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="Historical backfill script for LumenPulse analytics pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python scripts/backfill.py --days 7              # Backfill last 7 days
  python scripts/backfill.py --days 30 --dry-run   # Dry run for 30 days
  python scripts/backfill.py --days 1 --verbose     # Verbose output for 1 day
        """
    )
    
    parser.add_argument(
        "--days", 
        type=int, 
        required=True,
        help="Number of days to backfill (e.g., 7 for last week)"
    )
    
    parser.add_argument(
        "--dry-run", 
        action="store_true",
        help="Print planned operations without executing them"
    )
    
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable verbose logging output"
    )
    
    return parser.parse_args()


def main():
    """Main entry point for the backfill script."""
    args = parse_arguments()
    
    # Configure logging level
    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)
        logger.debug("Verbose logging enabled")
    
    # Validate arguments
    if args.days <= 0:
        logger.error("Number of days must be positive")
        sys.exit(1)
    
    if args.days > 365:
        logger.warning("Backfilling more than 365 days may take a very long time")
    
    logger.info("=" * 60)
    logger.info("LUMENPULSE HISTORICAL BACKFILL")
    logger.info("=" * 60)
    logger.info(f"Configuration:")
    logger.info(f"  - Days to backfill: {args.days}")
    logger.info(f"  - Dry run mode: {args.dry_run}")
    logger.info(f"  - Verbose logging: {args.verbose}")
    logger.info(f"  - Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    logger.info("")
    
    try:
        # Initialize backfill processor
        backfill = HistoricalBackfill(dry_run=args.dry_run)
        
        # Execute backfill
        results = backfill.backfill_days(args.days)
        
        # Generate and display summary
        summary = backfill.generate_summary(results)
        
        logger.info("")
        logger.info("=" * 60)
        logger.info("BACKFILL SUMMARY")
        logger.info("=" * 60)
        logger.info(f"Total Periods Processed: {summary['total_periods']}")
        logger.info(f"Successful: {summary['successful']}")
        logger.info(f"Failed: {summary['failed']}")
        logger.info(f"Success Rate: {summary['success_rate']:.1f}%")
        logger.info(f"Total News Articles: {summary['total_news_articles']}")
        logger.info(f"Total XLM Volume: {summary['total_volume_xlm']:,.2f}")
        logger.info(f"Average Volume per Day: {summary['average_volume_per_day']:,.2f}")
        logger.info(f"Backfill Duration: {summary['backfill_duration_hours']} hours")
        logger.info(f"Completed at: {summary['completed_at']}")
        
        if args.dry_run:
            logger.info("")
            logger.info("DRY RUN COMPLETED - No actual data was processed")
            logger.info("Run without --dry-run to execute the backfill")
        
        # Exit with appropriate code
        if summary['failed'] > 0:
            logger.warning(f"Backfill completed with {summary['failed']} failures")
            sys.exit(1)
        else:
            logger.info("Backfill completed successfully")
            sys.exit(0)
            
    except KeyboardInterrupt:
        logger.info("Backfill interrupted by user")
        sys.exit(130)
    except Exception as e:
        logger.error(f"Unexpected error during backfill: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
