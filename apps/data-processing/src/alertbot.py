"""
Telegram Alert Bot module - Sends notifications when market sentiment exceeds threshold.

This module provides the AlertBot class that integrates with Telegram's Bot API
to send alerts when the MarketAnalyzer detects high sentiment scores (>0.8).
"""

import os
import time
import logging
import threading
from datetime import datetime, timezone
from typing import Optional, Dict, Any
from src.utils.http_client import RobustHTTPClient

# Load environment variables from .env file if present
try:
    from dotenv import load_dotenv

    # Try loading from multiple possible locations
    load_dotenv()  # Current directory
    load_dotenv(
        dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env")
    )  # data-processing root
    load_dotenv(
        dotenv_path=os.path.join(os.path.dirname(__file__), "..", "..", "..", ".env")
    )  # project root
except ImportError:
    pass  # python-dotenv not installed, rely on system env vars

logger = logging.getLogger(__name__)


class AlertBot:
    """
    Telegram bot for sending market sentiment alerts.

    Sends notifications via Telegram Bot API when sentiment score exceeds
    the configured threshold (default: 0.8).

    Features:
    - Thread-safe send operations
    - Exponential backoff for rate limiting (429 responses)
    - Graceful error handling for auth and network failures
    - Configurable dry-run mode for testing
    - Message truncation for Telegram's 4096 char limit

    Environment Variables:
        TELEGRAM_BOT_TOKEN: Bot token from @BotFather
        TELEGRAM_CHANNEL_ID: Target channel/chat ID (numeric or @channel_name)
    """

    # Telegram API configuration
    API_BASE_URL = "https://api.telegram.org/bot{token}/sendMessage"
    MAX_MESSAGE_LENGTH = 4096

    # Retry configuration
    MAX_RETRIES = 3
    INITIAL_RETRY_DELAY = 1.0  # seconds
    MAX_RETRY_DELAY = 10.0  # seconds
    REQUEST_TIMEOUT = 10  # seconds

    # Alert threshold
    ALERT_THRESHOLD = 0.8

    def __init__(
        self,
        telegram_bot_token: Optional[str] = None,
        telegram_channel_id: Optional[str] = None,
        dry_run: bool = False,
    ):
        """
        Initialize the AlertBot.

        Args:
            telegram_bot_token: Telegram bot token (falls back to TELEGRAM_BOT_TOKEN env var)
            telegram_channel_id: Target channel/chat ID (falls back to TELEGRAM_CHANNEL_ID env var)
            dry_run: If True, log messages instead of sending them (useful for testing)
        """
        self.bot_token = telegram_bot_token or os.getenv("TELEGRAM_BOT_TOKEN")
        self.channel_id = telegram_channel_id or os.getenv("TELEGRAM_CHANNEL_ID")
        self.dry_run = dry_run
        self._lock = threading.Lock()
        self.http_client = RobustHTTPClient(timeout=self.REQUEST_TIMEOUT)

        # Validate configuration
        self._configured = bool(self.bot_token and self.channel_id)

        if not self._configured:
            logger.warning(
                "AlertBot not configured: missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID. "
                "Alerts will be logged but not sent."
            )
        elif dry_run:
            logger.info(
                "AlertBot initialized in dry-run mode (messages will be logged, not sent)"
            )
        else:
            logger.info(
                f"AlertBot initialized for channel: {self._mask_channel_id(self.channel_id)}"
            )

    @staticmethod
    def _mask_channel_id(channel_id: str) -> str:
        """Mask channel ID for logging (show first 4 chars only)."""
        if not channel_id:
            return "<none>"
        if len(channel_id) <= 4:
            return channel_id
        return f"{channel_id[:4]}..."

    def _truncate_message(self, message: str) -> str:
        """
        Truncate message to fit Telegram's character limit.

        Args:
            message: Original message text

        Returns:
            Truncated message with ellipsis if needed
        """
        if len(message) <= self.MAX_MESSAGE_LENGTH:
            return message

        # Leave room for ellipsis indicator
        truncation_marker = "\n\n... (message truncated)"
        max_content_length = self.MAX_MESSAGE_LENGTH - len(truncation_marker)

        logger.warning(
            f"Message truncated from {len(message)} to {self.MAX_MESSAGE_LENGTH} characters"
        )
        return message[:max_content_length] + truncation_marker

    def _send_request(self, message: str) -> bool:
        """
        Send message to Telegram using RobustHTTPClient.
        """
        url = self.API_BASE_URL.format(token=self.bot_token)
        payload = {"chat_id": self.channel_id, "text": message, "parse_mode": "HTML"}

        try:
            response = self.http_client.post(url, json=payload)
            if response.status_code == 200:
                logger.info("Alert sent successfully to Telegram")
                return True
            return False
        except Exception as e:
            logger.error(f"Failed to send Telegram alert: {e}")
            return False

    def send_alert(self, message: str) -> bool:
        """
        Send an alert message to Telegram.

        Thread-safe method that sends a message to the configured Telegram channel.
        Handles rate limiting with exponential backoff and logs all operations.

        Args:
            message: The alert message to send (supports HTML formatting)

        Returns:
            True if message was sent successfully, False otherwise
        """
        with self._lock:
            # Truncate if necessary
            message = self._truncate_message(message)

            # Handle unconfigured state
            if not self._configured:
                logger.info(f"[DRY-RUN/UNCONFIGURED] Alert message:\n{message}")
                return False

            # Handle dry-run mode
            if self.dry_run:
                logger.info(f"[DRY-RUN] Would send alert:\n{message}")
                return True

            return self._send_request(message)

    def _format_alert_message(
        self,
        score: float,
        sentiment_data: Dict[str, Any],
        timestamp: Optional[datetime] = None,
    ) -> str:
        """
        Format a sentiment alert message.

        Args:
            score: The sentiment score that triggered the alert
            sentiment_data: Dictionary containing sentiment analysis details
            timestamp: Alert timestamp (defaults to current UTC time)

        Returns:
            Formatted alert message with HTML markup
        """
        if timestamp is None:
            timestamp = datetime.now(timezone.utc)

        # Determine trend direction
        trend_direction = sentiment_data.get("trend_direction", "Unknown")
        if isinstance(trend_direction, str):
            trend_display = trend_direction.capitalize()
        else:
            trend_display = str(trend_direction)

        # Add trend emoji
        trend_emoji = (
            "📈"
            if "bull" in trend_display.lower()
            else ("📉" if "bear" in trend_display.lower() else "➡️")
        )

        # Extract metrics
        avg_sentiment = sentiment_data.get("average_compound_score", 0)
        sentiment_dist = sentiment_data.get("sentiment_distribution", {})
        positive_ratio = sentiment_dist.get("positive", 0)
        negative_ratio = sentiment_dist.get("negative", 0)
        news_count = sentiment_data.get("total_analyzed", 0)

        # Calculate confidence (based on sample size and score strength)
        confidence = min(100, max(0, int(abs(score) * 100 * min(news_count / 20, 1))))

        # Format timestamp
        time_str = timestamp.strftime("%Y-%m-%d %H:%M:%S UTC")

        # Build message
        message = f"""🚨 <b>High Sentiment Alert</b>

<b>Score:</b> {score:.2f}
<b>Trend:</b> {trend_display} {trend_emoji}
<b>Confidence:</b> {confidence}%
<b>Timestamp:</b> {time_str}

<b>Details:</b>
• Average sentiment: {avg_sentiment:.2f}
• Positive ratio: {positive_ratio:.1%}
• Negative ratio: {negative_ratio:.1%}
• News analyzed: {news_count}"""

        # Add anomaly info if present
        anomalies_count = sentiment_data.get("anomalies_detected", 0)
        if anomalies_count > 0:
            message += f"\n• ⚠️ Anomalies detected: {anomalies_count}"

        return message

    def check_and_alert(
        self,
        analyzer_score: float,
        sentiment_data: Dict[str, Any],
        timestamp: Optional[datetime] = None,
    ) -> bool:
        """
        Check if sentiment score exceeds threshold and send alert if so.

        Args:
            analyzer_score: The sentiment/health score from MarketAnalyzer
            sentiment_data: Dictionary containing sentiment analysis details
            timestamp: Optional timestamp for the alert

        Returns:
            True if alert was triggered and sent successfully, False otherwise
        """
        if analyzer_score <= self.ALERT_THRESHOLD:
            logger.debug(
                f"Score {analyzer_score:.2f} below threshold {self.ALERT_THRESHOLD}, no alert"
            )
            return False

        logger.info(
            f"Score {analyzer_score:.2f} exceeds threshold {self.ALERT_THRESHOLD}, triggering alert"
        )

        message = self._format_alert_message(analyzer_score, sentiment_data, timestamp)
        return self.send_alert(message)

    @property
    def is_configured(self) -> bool:
        """Check if the bot is properly configured."""
        return self._configured
