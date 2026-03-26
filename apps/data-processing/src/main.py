"""
Main entry point for the data processing pipeline with both single-run and scheduled modes.
"""

import os
import sys
import logging
import signal
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from dotenv import load_dotenv

# Add the src directory to the Python path
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

# Import both pipeline and scheduler
from src.ingestion.news_fetcher import fetch_news
from src.ingestion.stellar_fetcher import get_asset_volume, get_network_overview
from src.validators import validate_news_article, validate_onchain_metric
from src.analytics.market_analyzer import MarketAnalyzer, MarketData
from src.analytics.market_analyzer import get_explanation
from src.sentiment import SentimentAnalyzer
from src.anomaly_detector import AnomalyDetector
from src.alert_notifier import notifier
from scheduler import AnalyticsScheduler

from src.utils.logger import setup_logger, CorrelationIdFilter
from src.utils.metrics import API_FAILURES_TOTAL, start_metrics_server
from pythonjsonlogger import jsonlogger

# Configure logging
logger = setup_logger(__name__)
os.makedirs("./logs", exist_ok=True)
file_handler = logging.FileHandler("./logs/data_processor.log")
formatter = jsonlogger.JsonFormatter(
    "%(asctime)s %(levelname)s %(name)s %(correlation_id)s %(message)s",
    rename_fields={"levelname": "level"}
)
file_handler.addFilter(CorrelationIdFilter())
file_handler.setFormatter(formatter)
logger.addHandler(file_handler)

# Module-level detector so it accumulates rolling window data across
# scheduled pipeline runs (meaningful baselines build up over time).
anomaly_detector = AnomalyDetector(window_size_hours=24, z_threshold=2.5)

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
        pipeline_start = time.perf_counter()

        # ── Step 1 & 2: Fetch news + on-chain data concurrently ──────
        print("1. FETCHING DATA (news + on-chain in parallel)")
        print("-" * 40)

        with ThreadPoolExecutor(max_workers=4) as io_pool:
            news_future = io_pool.submit(fetch_news, limit=5)
            vol_24h_future = io_pool.submit(get_asset_volume, "XLM", hours=24)
            vol_48h_future = io_pool.submit(get_asset_volume, "XLM", hours=48)
            network_future = io_pool.submit(get_network_overview)

            raw_news_articles = news_future.result()
            raw_volume_24h = vol_24h_future.result()
            raw_volume_48h = vol_48h_future.result()
            network_stats = network_future.result()

        fetch_elapsed = time.perf_counter() - pipeline_start
        print(f"All fetches completed in {fetch_elapsed:.2f}s (parallel)")

        # Validate and sanitize news articles
        news_articles = []
        for idx, article in enumerate(raw_news_articles):
            validated = validate_news_article(article)
            if validated:
                news_articles.append(validated.dict())
            else:
                logger.warning(f"Dropped invalid news article at index {idx}")

        print(f"Fetched {len(raw_news_articles)} raw → {len(news_articles)} validated articles")

        # ── Sentiment analysis (parallel for large batches) ──────────
        print("\n2. SENTIMENT ANALYSIS")
        print("-" * 40)

        sentiment_analyzer = SentimentAnalyzer()
        if news_articles:
            article_texts = [
                (a.get("title", "") + " " + a.get("summary", "")).strip()
                for a in news_articles
            ]
            sentiment_results = sentiment_analyzer.analyze_batch_parallel(article_texts)
            summary = sentiment_analyzer.get_sentiment_summary(sentiment_results)
            avg_sentiment = summary["average_compound_score"]
            print(f"Avg sentiment: {avg_sentiment:.4f} "
                  f"(+{summary['positive_count']} / "
                  f"-{summary['negative_count']} / "
                  f"~{summary['neutral_count']})")
        else:
            avg_sentiment = 0.0
            sentiment_results = []
            print("No valid articles, using neutral sentiment")

        # ── Validate on-chain metrics ────────────────────────────────
        print("\n3. STELLAR ON-CHAIN DATA")
        print("-" * 40)

        validated_volume_24h = validate_onchain_metric({
            "metric_id": "xlm_volume_24h",
            "value": raw_volume_24h.get("total_volume", 0.0),
            "timestamp": raw_volume_24h.get("end_time", ""),
            "chain": "stellar",
            "extra": raw_volume_24h,
        })
        if validated_volume_24h:
            volume_24h = validated_volume_24h.dict()
        else:
            logger.warning("Invalid on-chain metric for 24h volume, using defaults.")
            volume_24h = {"total_volume": 0.0, "transaction_count": 0}

        print(f"XLM Volume (24h): {volume_24h.get('total_volume', 0.0):,.2f}")
        print(f"Transactions: {volume_24h.get('transaction_count', 0)}")

        validated_volume_48h = validate_onchain_metric({
            "metric_id": "xlm_volume_48h",
            "value": raw_volume_48h.get("total_volume", 0.0),
            "timestamp": raw_volume_48h.get("end_time", ""),
            "chain": "stellar",
            "extra": raw_volume_48h,
        })
        if validated_volume_48h:
            volume_48h = validated_volume_48h.dict()
        else:
            logger.warning("Invalid on-chain metric for 48h volume, using defaults.")
            volume_48h = {"total_volume": 0.0}

        # Calculate volume change percentage
        if volume_48h["total_volume"] > 0:
            volume_change = (
                volume_24h["total_volume"] - volume_48h["total_volume"]
            ) / volume_48h["total_volume"]
            print(f"Volume Change (24h vs 48h): {volume_change:.2%}")
        else:
            volume_change = 0.0
            print("Insufficient data for volume change calculation")

        if network_stats:
            print(f"Latest Ledger: {network_stats.get('latest_ledger', 'N/A')}")
            print(f"Transaction Count: {network_stats.get('transaction_count', 0)}")

        # Step 4: Market Analysis
        print("\n4. MARKET ANALYSIS")
        print("-" * 40)

        # Create market data
        market_data = MarketData(
            sentiment_score=avg_sentiment, volume_change=volume_change
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

        # Step 5: Anomaly Detection
        print("\n5. ANOMALY DETECTION")
        print("-" * 40)

        current_volume = float(volume_24h["total_volume"])
        now = datetime.utcnow()

        # Feed current data point into the rolling window detector
        anomaly_detector.add_data_point(
            volume=current_volume,
            sentiment_score=avg_sentiment,
            timestamp=now,
        )

        # Run detection on both metrics
        volume_anomaly = anomaly_detector.detect_volume_anomaly(current_volume, now)
        sentiment_anomaly = anomaly_detector.detect_sentiment_anomaly(avg_sentiment, now)

        anomalies_found = []

        for result in [volume_anomaly, sentiment_anomaly]:
            status = "⚠️  ANOMALY" if result.is_anomaly else "✓  Normal"
            print(
                f"{status} | {result.metric_name.capitalize():<10} | "
                f"value={result.current_value:.4f} | "
                f"z={result.z_score:.2f} | "
                f"severity={result.severity_score:.2f}"
            )
            if result.is_anomaly:
                anomalies_found.append(result.to_dict())
                logger.warning(
                    f"Anomaly detected — metric={result.metric_name}, "
                    f"value={result.current_value:.4f}, "
                    f"z_score={result.z_score:.2f}, "
                    f"severity={result.severity_score:.2f}"
                )
        
        # Trigger alerts for detected anomalies
        if anomalies_found:
            notifier.notify_batch([volume_anomaly, sentiment_anomaly])

        window_stats = anomaly_detector.get_window_stats()
        print(f"Detector window: {window_stats['data_points_count']} data points")

        if not anomalies_found:
            print("No anomalies detected in current pipeline run.")

        # Step 6: Output summary
        total_elapsed = time.perf_counter() - pipeline_start
        print("\n6. PIPELINE SUMMARY")
        print("-" * 40)
        print(f"✓ News Articles Processed: {len(news_articles)}")
        print(f"✓ Sentiment Scores Computed: {len(sentiment_results)}")
        print(f"✓ XLM Volume Analyzed: {volume_24h['total_volume']:,.2f}")
        print(f"✓ Market Trend: {trend.value.upper()}")
        print(f"✓ Anomalies Detected: {len(anomalies_found)}")
        print(f"✓ Total Pipeline Time: {total_elapsed:.2f}s")
        print(f"✓ Analysis Complete: {datetime.now().strftime('%H:%M:%S')}")

        result = {
            "success": True,
            "news_count": len(news_articles),
            "volume_xlm": volume_24h["total_volume"],
            "market_trend": trend.value,
            "health_score": score,
            "anomalies": anomalies_found,
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
        API_FAILURES_TOTAL.labels(method="worker", endpoint="pipeline").inc()
        return {
            "success": False,
            "error": str(e),
            "timestamp": datetime.now().isoformat(),
        }


def start_scheduler():
    """Start the scheduled data processing service."""
    global scheduler

    # Start metrics server on port 9091 for background worker
    start_metrics_server(port=9091)

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