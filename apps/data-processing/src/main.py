"""
Main entry point for the data processing pipeline with both single-run and scheduled modes.
"""

import os
import sys
import logging
import signal
from datetime import datetime
from dotenv import load_dotenv

# Add the src directory to the Python path
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

# Import both pipeline and scheduler
from src.ingestion.news_fetcher import fetch_news
from src.ingestion.stellar_fetcher import get_asset_volume, get_network_overview
from src.analytics.market_analyzer import MarketAnalyzer, MarketData
from src.analytics.market_analyzer import get_explanation
from scheduler import AnalyticsScheduler

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[
        logging.FileHandler("./logs/data_processor.log"),
        logging.StreamHandler(sys.stdout),
    ],
)

logger = logging.getLogger(__name__)

# Global scheduler instance
scheduler = None


def setup_signal_handlers():
    """Setup signal handlers for graceful shutdown"""

    def signal_handler(sig, frame):
        logger.info("Received shutdown signal, cleaning up...")
        if scheduler:
            scheduler.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)


def run_data_pipeline():
    """Run a single execution of the complete data processing pipeline."""
    print("=" * 60)
    print("DATA PROCESSING PIPELINE")
    print("=" * 60)
    print(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()

    try:
        # Step 1: Fetch news data
        print("1. FETCHING CRYPTO NEWS")
        print("-" * 40)
        news_articles = fetch_news(limit=5)
        print(f"Fetched {len(news_articles)} news articles")

        # Calculate average sentiment (mock - in real scenario, use sentiment engine)
        if news_articles:
            # Mock sentiment calculation (replace with actual sentiment analysis)
            mock_sentiment = 0.3  # Placeholder
            print(f"Mock sentiment score: {mock_sentiment:.2f}")
        else:
            mock_sentiment = 0.0
            print("No news articles fetched, using neutral sentiment")

        # Step 2: Fetch Stellar on-chain data
        print("\n2. FETCHING STELLAR ON-CHAIN DATA")
        print("-" * 40)

        # Get XLM volume for last 24 hours
        volume_24h = get_asset_volume("XLM", hours=24)
        print(f"XLM Volume (24h): {volume_24h['total_volume']:,.2f}")
        print(f"Transactions: {volume_24h['transaction_count']}")

        # Get XLM volume for last 48 hours for comparison
        volume_48h = get_asset_volume("XLM", hours=48)

        # Calculate volume change percentage
        if volume_48h["total_volume"] > 0:
            volume_change = (
                volume_24h["total_volume"] - volume_48h["total_volume"]
            ) / volume_48h["total_volume"]
            print(f"Volume Change (24h vs 48h): {volume_change:.2%}")
        else:
            volume_change = 0.0
            print("Insufficient data for volume change calculation")

        # Get network overview
        network_stats = get_network_overview()
        if network_stats:
            print(f"Latest Ledger: {network_stats.get('latest_ledger', 'N/A')}")
            print(f"Transaction Count: {network_stats.get('transaction_count', 0)}")

        # Step 3: Market Analysis
        print("\n3. MARKET ANALYSIS")
        print("-" * 40)

        # Create market data
        market_data = MarketData(
            sentiment_score=mock_sentiment, volume_change=volume_change
        )

        # Analyze market trend
        trend, score, metrics = MarketAnalyzer.analyze_trend(market_data)

        print(f"Market Health Score: {score:.2f}")
        print(f"Trend: {trend.value.upper()}")
        print(f"Sentiment Component: {metrics['sentiment_component']:.2f}")
        print(f"Volume Component: {metrics['volume_component']:.2f}")

        # Generate explanation
        explanation = get_explanation(score, trend)
        print(f"\nAnalysis: {explanation}")

        # Step 4: Output summary
        print("\n4. PIPELINE SUMMARY")
        print("-" * 40)
        print(f"✓ News Articles Processed: {len(news_articles)}")
        print(f"✓ XLM Volume Analyzed: {volume_24h['total_volume']:,.2f}")
        print(f"✓ Market Trend: {trend.value.upper()}")
        print(f"✓ Analysis Complete: {datetime.now().strftime('%H:%M:%S')}")

        result = {
            "success": True,
            "news_count": len(news_articles),
            "volume_xlm": volume_24h["total_volume"],
            "market_trend": trend.value,
            "health_score": score,
            "timestamp": datetime.now().isoformat(),
        }

        logger.info(f"Pipeline completed successfully: {result}")
        return result

    except Exception as e:
        error_msg = f"Pipeline Error: {e}"
        print(f"\n❌ {error_msg}")
        import traceback

        traceback.print_exc()
        logger.error(error_msg, exc_info=True)
        return {
            "success": False,
            "error": str(e),
            "timestamp": datetime.now().isoformat(),
        }


def start_scheduler():
    """Start the scheduled data processing service."""
    global scheduler

    logger.info("=" * 70)
    logger.info("LumenPulse Data Processing Service Starting")
    logger.info("=" * 70)

    try:
        # Initialize and start the scheduler
        scheduler = AnalyticsScheduler(run_data_pipeline)
        setup_signal_handlers()

        # Option to run immediately on startup (useful for testing)
        run_on_startup = os.getenv("RUN_IMMEDIATELY", "false").lower() == "true"

        if run_on_startup:
            logger.info("Running analyzer immediately on startup...")
            scheduler.run_immediately()

        # Start the scheduler
        scheduler.start()

        logger.info("Data processing service is running. Press Ctrl+C to stop.")
        logger.info("The Market Analyzer will run automatically every hour.")

        # Keep the application running
        import time

        while True:
            time.sleep(1)

    except Exception as e:
        logger.error(f"Fatal error in data processing service: {e}", exc_info=True)
        if scheduler:
            scheduler.stop()
        sys.exit(1)


def main():
    """Main entry point - handles both CLI modes"""
    load_dotenv()

    # Create logs directory if it doesn't exist
    os.makedirs("./logs", exist_ok=True)

    # Check command line arguments
    if len(sys.argv) > 1:
        command = sys.argv[1].lower()

        if command == "run":
            # Run pipeline once and exit
            return run_data_pipeline()
        elif command == "serve":
            # Start scheduled service
            start_scheduler()
        elif command == "help":
            print("Usage:")
            print("  python pipeline.py run     - Run pipeline once")
            print("  python pipeline.py serve   - Start scheduled service")
            print("  python pipeline.py help    - Show this help")
            return {"help": True}
        else:
            print(f"Unknown command: {command}")
            print("Use 'python pipeline.py help' for usage instructions")
            return {"error": f"Unknown command: {command}"}
    else:
        # Default: run once (original behavior)
        result = run_data_pipeline()
        print("\n" + "=" * 60)
        print("PIPELINE COMPLETE")
        print("=" * 60)
        return result


if __name__ == "__main__":
    result = main()
    if result and result.get("help"):
        sys.exit(0)
    elif result and not result.get("success", True):
        sys.exit(1)
