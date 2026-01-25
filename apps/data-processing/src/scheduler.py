"""
Job scheduler module - schedules and manages background jobs
"""
import logging
from datetime import datetime
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.job import Job

from fetchers import NewsFetcher
from sentiment import SentimentAnalyzer
from trends import TrendCalculator
from database import DatabaseService, AnalyticsRecord
from anomaly_detector import AnomalyDetector, AnomalyResult
from alertbot import AlertBot

logger = logging.getLogger(__name__)


class MarketAnalyzer:
    """Main job that orchestrates the entire analysis pipeline"""

    def __init__(self):
        self.fetcher = NewsFetcher()
        self.sentiment_analyzer = SentimentAnalyzer()
        self.trend_calculator = TrendCalculator()
        self.db_service = DatabaseService()
        self.anomaly_detector = AnomalyDetector(window_size_hours=24, z_threshold=2.5)
        self.alert_bot = AlertBot()

    def run(self):
        """
        Execute the full analysis pipeline:
        1. Fetch News
        2. Analyze Sentiment
        3. Calculate Trend
        4. Save to DB
        """
        try:
            logger.info("=" * 60)
            logger.info("Starting MarketAnalyzer job")
            logger.info(f"Timestamp: {datetime.utcnow().isoformat()}")
            
            # Step 1: Fetch News
            logger.info("Step 1: Fetching news...")
            news_items = self.fetcher.fetch_all_news()
            
            if not news_items:
                logger.warning("No news items fetched")
                return

            # Step 2: Analyze Sentiment
            logger.info(f"Step 2: Analyzing sentiment for {len(news_items)} articles...")
            news_texts = [f"{item.title} {item.content}" for item in news_items]
            sentiment_results = self.sentiment_analyzer.analyze_batch(news_texts)
            sentiment_summary = self.sentiment_analyzer.get_sentiment_summary(sentiment_results)
            
            # Step 3: Calculate Trends
            logger.info("Step 3: Calculating trends...")
            trends = self.trend_calculator.calculate_all_trends(sentiment_summary)
            trends_dict = [trend.to_dict() for trend in trends]
            
            # Step 4: Detect Anomalies
            logger.info("Step 4: Detecting market anomalies...")
            
            # Get volume data (mock for demo - in real implementation, fetch actual volume)
            current_volume = 1000.0  # This would come from Stellar fetcher
            current_sentiment = sentiment_summary.get('average_compound_score', 0)
            
            # Detect anomalies
            anomalies = self.anomaly_detector.detect_anomalies(
                volume=current_volume,
                sentiment_score=current_sentiment
            )
            
            # Log anomaly results
            anomaly_alerts = []
            for anomaly in anomalies:
                if anomaly.is_anomaly:
                    logger.warning(f"🚨 ANOMALY DETECTED: {anomaly.metric_name} "
                                 f"(Severity: {anomaly.severity_score:.2f}, "
                                 f"Z-Score: {anomaly.z_score:.2f})")
                    anomaly_alerts.append(anomaly.to_dict())
                else:
                    logger.debug(f"Normal {anomaly.metric_name} behavior "
                               f"(Z-Score: {anomaly.z_score:.2f})")
            
            # Step 5: Save to Database
            logger.info("Step 5: Saving analytics to database...")
            
            # Enhance record with anomaly data
            enhanced_sentiment_data = sentiment_summary.copy()
            enhanced_sentiment_data['anomalies_detected'] = len([a for a in anomalies if a.is_anomaly])
            enhanced_sentiment_data['anomaly_details'] = [a.to_dict() for a in anomalies]
            
            # Step 5.5: Check for high sentiment alerts
            # Determine trend direction from calculated trends
            trend_direction = "Unknown"
            if trends:
                primary_trend = trends[0]
                trend_direction = getattr(primary_trend, 'trend_direction', 'Unknown')
            
            alert_sentiment_data = enhanced_sentiment_data.copy()
            alert_sentiment_data['trend_direction'] = trend_direction
            alert_sentiment_data['total_analyzed'] = len(news_items)
            
            self.alert_bot.check_and_alert(
                analyzer_score=current_sentiment,
                sentiment_data=alert_sentiment_data,
                timestamp=datetime.utcnow()
            )
            
            record = AnalyticsRecord(
                timestamp=datetime.utcnow(),
                news_count=len(news_items),
                sentiment_data=enhanced_sentiment_data,
                trends=trends_dict
            )
            
            success = self.db_service.save_analytics(record)
            
            if success:
                logger.info("✓ Analytics job completed successfully")
                logger.info(f"  - News items: {len(news_items)}")
                logger.info(f"  - Average sentiment: {sentiment_summary.get('average_compound_score', 0):.4f}")
                logger.info(f"  - Positive: {sentiment_summary.get('sentiment_distribution', {}).get('positive', 0):.1%}")
                logger.info(f"  - Negative: {sentiment_summary.get('sentiment_distribution', {}).get('negative', 0):.1%}")
                logger.info(f"  - Anomalies detected: {len(anomaly_alerts)}")
            else:
                logger.error("✗ Failed to save analytics to database")
            
            logger.info("=" * 60)
        except Exception as e:
            logger.error(f"Error in MarketAnalyzer job: {e}", exc_info=True)


class AnalyticsScheduler:
    """Manages the APScheduler scheduler for analytics jobs"""

    def __init__(self):
        self.scheduler = BackgroundScheduler()
        self.analyzer = MarketAnalyzer()

    def start(self):
        """Start the scheduler"""
        try:
            # Add the MarketAnalyzer job to run every hour
            job = self.scheduler.add_job(
                func=self.analyzer.run,
                trigger=IntervalTrigger(hours=1),
                id='market_analyzer_hourly',
                name='Market Analyzer - Hourly Analytics',
                replace_existing=True
            )
            
            self.scheduler.start()
            logger.info("✓ Analytics scheduler started")
            logger.info(f"  - Job: {job.name}")
            logger.info(f"  - Schedule: Every 1 hour")
            logger.info(f"  - Next run: {job.next_run_time}")
        except Exception as e:
            logger.error(f"Error starting scheduler: {e}")
            raise

    def run_immediately(self):
        """Run the analyzer job immediately (useful for testing)"""
        logger.info("Running MarketAnalyzer immediately...")
        self.analyzer.run()

    def stop(self):
        """Stop the scheduler"""
        try:
            self.scheduler.shutdown(wait=True)
            logger.info("✓ Analytics scheduler stopped")
        except Exception as e:
            logger.error(f"Error stopping scheduler: {e}")

    def get_jobs(self) -> list:
        """Get list of scheduled jobs"""
        return self.scheduler.get_jobs()

    def get_job_status(self, job_id: str) -> dict:
        """Get status of a specific job"""
        job = self.scheduler.get_job(job_id)
        if job:
            return {
                "id": job.id,
                "name": job.name,
                "next_run_time": job.next_run_time,
                "trigger": str(job.trigger)
            }
        return None
