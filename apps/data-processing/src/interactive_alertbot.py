"""
Interactive Telegram Alert Bot - Supports commands and per-user subscriptions

This module extends the original AlertBot to support:
- Interactive commands (/status, /price, /sentiment, /trend, /silence)
- Per-user/channel subscription management
- Database-backed subscription storage
- Command history tracking
"""

import os
import time
import logging
import threading
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List

import requests

from .database import DatabaseService
from .db.models import TelegramSubscription, TelegramCommand
from .sentiment import MarketAnalyzer
from .trends import TrendAnalyzer

logger = logging.getLogger(__name__)


class InteractiveAlertBot:
    """
    Interactive Telegram bot with command support and user subscriptions.
    
    Features:
    - Command handlers for /status, /price XLM, /sentiment, /trend
    - Per-user/channel subscription management
    - Silence/mute functionality
    - Database-backed subscription storage
    - Command history tracking
    """

    # Telegram API configuration
    API_BASE_URL = "https://api.telegram.org/bot{token}/"
    MAX_MESSAGE_LENGTH = 4096

    # Retry configuration
    MAX_RETRIES = 3
    INITIAL_RETRY_DELAY = 1.0
    MAX_RETRY_DELAY = 10.0
    REQUEST_TIMEOUT = 10

    # Alert threshold
    ALERT_THRESHOLD = 0.8

    def __init__(
        self,
        telegram_bot_token: Optional[str] = None,
        database_service: Optional[DatabaseService] = None,
        market_analyzer: Optional[MarketAnalyzer] = None,
        trend_analyzer: Optional[TrendAnalyzer] = None,
        dry_run: bool = False,
    ):
        """Initialize the Interactive AlertBot."""
        self.bot_token = telegram_bot_token or os.getenv("TELEGRAM_BOT_TOKEN")
        self.database = database_service
        self.market_analyzer = market_analyzer
        self.trend_analyzer = trend_analyzer
        self.dry_run = dry_run
        self._lock = threading.Lock()

        # Validate configuration
        self._configured = bool(self.bot_token)

        if not self._configured:
            logger.warning(
                "InteractiveAlertBot not configured: missing TELEGRAM_BOT_TOKEN"
            )
        else:
            logger.info("InteractiveAlertBot initialized successfully")

        # Command handlers mapping
        self.command_handlers = {
            '/start': self._handle_start,
            '/help': self._handle_help,
            '/status': self._handle_status,
            '/price': self._handle_price,
            '/sentiment': self._handle_sentiment,
            '/trend': self._handle_trend,
            '/silence': self._handle_silence,
            '/subscribe': self._handle_subscribe,
            '/unsubscribe': self._handle_unsubscribe,
            '/settings': self._handle_settings,
        }

    def _send_request(self, method: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Send request to Telegram API with retry logic."""
        url = f"{self.API_BASE_URL.format(token=self.bot_token)}{method}"
        
        retry_delay = self.INITIAL_RETRY_DELAY

        for attempt in range(self.MAX_RETRIES + 1):
            try:
                response = requests.post(url, json=payload, timeout=self.REQUEST_TIMEOUT)

                if response.status_code == 200:
                    return response.json()

                elif response.status_code == 429:
                    retry_after = (
                        response.json()
                        .get("parameters", {})
                        .get("retry_after", retry_delay)
                    )
                    retry_delay = min(float(retry_after), self.MAX_RETRY_DELAY)

                    if attempt < self.MAX_RETRIES:
                        logger.warning(
                            f"Rate limited by Telegram (429). Retrying in {retry_delay:.1f}s "
                            f"(attempt {attempt + 1}/{self.MAX_RETRIES})"
                        )
                        time.sleep(retry_delay)
                        retry_delay = min(retry_delay * 2, self.MAX_RETRY_DELAY)
                        continue
                    else:
                        logger.error("Rate limit exceeded, max retries reached")
                        return None

                elif response.status_code in (401, 403):
                    logger.error(
                        f"Telegram authentication failed ({response.status_code})"
                    )
                    return None

                else:
                    error_desc = response.json().get("description", "Unknown error")
                    logger.error(
                        f"Telegram API error ({response.status_code}): {error_desc}"
                    )
                    return None

            except requests.exceptions.RequestException as e:
                logger.error(f"Request error: {e}")
                if attempt < self.MAX_RETRIES:
                    time.sleep(retry_delay)
                    retry_delay = min(retry_delay * 2, self.MAX_RETRY_DELAY)
                    continue
                else:
                    return None

        return None

    def send_message(self, chat_id: int, text: str, parse_mode: str = "HTML") -> bool:
        """Send a message to a Telegram chat."""
        payload = {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": parse_mode
        }

        # Truncate if necessary
        if len(text) > self.MAX_MESSAGE_LENGTH:
            text = text[:self.MAX_MESSAGE_LENGTH - 20] + "... (truncated)"
            payload["text"] = text

        # Handle dry-run mode
        if self.dry_run:
            logger.info(f"[DRY-RUN] Would send to {chat_id}: {text}")
            return True

        # Handle unconfigured state
        if not self._configured:
            logger.info(f"[UNCONFIGURED] Would send to {chat_id}: {text}")
            return False

        response = self._send_request("sendMessage", payload)
        return response is not None

    def _ensure_subscription(self, chat_id: int, user_info: Dict[str, Any]) -> TelegramSubscription:
        """Ensure user has a subscription record."""
        if not self.database or not self.database.postgres_service:
            logger.warning("No database service available for subscription management")
            return None

        try:
            # Try to get existing subscription
            subscription = self.database.postgres_service.get_telegram_subscription(chat_id)
            
            if not subscription:
                # Create new subscription
                subscription = TelegramSubscription(
                    chat_id=chat_id,
                    chat_type=user_info.get('chat_type', 'private'),
                    username=user_info.get('username'),
                    first_name=user_info.get('first_name'),
                    last_name=user_info.get('last_name'),
                    last_interaction=datetime.now(timezone.utc)
                )
                self.database.postgres_service.create_telegram_subscription(subscription)
                logger.info(f"Created new subscription for chat_id: {chat_id}")
            else:
                # Update last interaction
                subscription.last_interaction = datetime.now(timezone.utc)
                self.database.postgres_service.update_telegram_subscription(subscription)
                
            return subscription
            
        except Exception as e:
            logger.error(f"Error ensuring subscription for {chat_id}: {e}")
            return None

    def _log_command(self, chat_id: int, command: str, args: str, response_text: str = None, error: str = None):
        """Log command execution for analytics."""
        if not self.database or not self.database.postgres_service:
            return

        try:
            cmd_record = TelegramCommand(
                chat_id=chat_id,
                command=command,
                args=args,
                response_sent=response_text is not None,
                response_text=response_text,
                error_message=error
            )
            self.database.postgres_service.create_telegram_command(cmd_record)
        except Exception as e:
            logger.error(f"Error logging command: {e}")

    def process_update(self, update: Dict[str, Any]) -> bool:
        """Process a Telegram update (message or callback query)."""
        try:
            # Handle regular messages
            if "message" in update:
                message = update["message"]
                chat_id = message["chat"]["id"]
                text = message.get("text", "")
                
                # Extract user info
                user_info = {
                    'chat_type': message["chat"].get("type", "private"),
                    'username': message.get("from", {}).get("username"),
                    'first_name': message.get("from", {}).get("first_name"),
                    'last_name': message.get("from", {}).get("last_name"),
                }

                # Ensure subscription exists
                self._ensure_subscription(chat_id, user_info)

                # Process command
                if text.startswith("/"):
                    return self._process_command(chat_id, text, user_info)

            # Handle callback queries (for inline keyboards)
            elif "callback_query" in update:
                callback = update["callback_query"]
                chat_id = callback["message"]["chat"]["id"]
                data = callback.get("data", "")
                
                # Process callback
                return self._process_callback(chat_id, data)

            return False

        except Exception as e:
            logger.error(f"Error processing update: {e}")
            return False

    def _process_command(self, chat_id: int, text: str, user_info: Dict[str, Any]) -> bool:
        """Process a bot command."""
        try:
            # Parse command and arguments
            parts = text.strip().split()
            command = parts[0].lower()
            args = " ".join(parts[1:]) if len(parts) > 1 else ""

            # Check if command is supported
            if command not in self.command_handlers:
                response = "❌ Unknown command. Use /help for available commands."
                self.send_message(chat_id, response)
                self._log_command(chat_id, command, args, error="Unknown command")
                return False

            # Execute command handler
            start_time = time.time()
            try:
                response = self.command_handlers[command](chat_id, args, user_info)
                processing_time = int((time.time() - start_time) * 1000)
                
                if response:
                    self.send_message(chat_id, response)
                    self._log_command(chat_id, command, args, response)
                    return True
                else:
                    self._log_command(chat_id, command, args, error="No response generated")
                    return False

            except Exception as e:
                error_msg = f"❌ Error processing command: {str(e)}"
                self.send_message(chat_id, error_msg)
                self._log_command(chat_id, command, args, error=str(e))
                return False

        except Exception as e:
            logger.error(f"Error processing command {text}: {e}")
            return False

    def _process_callback(self, chat_id: int, data: str) -> bool:
        """Process callback query from inline keyboard."""
        # TODO: Implement callback handling for interactive menus
        return False

    # Command handlers
    def _handle_start(self, chat_id: int, args: str, user_info: Dict[str, Any]) -> str:
        """Handle /start command."""
        return (
            "🚀 <b>Welcome to LumenPulse Alert Bot!</b>\n\n"
            "I provide real-time crypto market sentiment analysis and alerts.\n\n"
            "<b>Available commands:</b>\n"
            "/help - Show all commands\n"
            "/status - Current market status\n"
            "/price XLM - Get XLM price info\n"
            "/sentiment - Latest sentiment analysis\n"
            "/trend - Current market trends\n"
            "/silence [hours] - Mute alerts\n"
            "/settings - Manage subscriptions\n\n"
            "You'll automatically receive high-sentiment alerts. Use /silence to mute them."
        )

    def _handle_help(self, chat_id: int, args: str, user_info: Dict[str, Any]) -> str:
        """Handle /help command."""
        return (
            "📖 <b>LumenPulse Bot Commands</b>\n\n"
            "📊 <b>Market Info:</b>\n"
            "/status - Overall market status\n"
            "/price [asset] - Price information (default: XLM)\n"
            "/sentiment - Sentiment analysis summary\n"
            "/trend - Market trend analysis\n\n"
            "🔔 <b>Alert Management:</b>\n"
            "/silence [hours] - Mute alerts (default: 1 hour)\n"
            "/settings - Subscription preferences\n"
            "/subscribe [type] - Subscribe to alerts\n"
            "/unsubscribe [type] - Unsubscribe from alerts\n\n"
            "ℹ️ <b>Other:</b>\n"
            "/start - Welcome message\n"
            "/help - This help message\n\n"
            "<i>Examples: /price XLM, /silence 6, /subscribe sentiment</i>"
        )

    def _handle_status(self, chat_id: int, args: str, user_info: Dict[str, Any]) -> str:
        """Handle /status command."""
        try:
            # Get latest analytics from database
            if self.database:
                latest = self.database.get_latest_analytics()
                
                if latest and "sentiment_data" in latest:
                    sentiment_data = latest["sentiment_data"]
                    score = sentiment_data.get("average_compound_score", 0)
                    distribution = sentiment_data.get("sentiment_distribution", {})
                    
                    # Determine status
                    if score > 0.8:
                        status_emoji = "🔥"
                        status_text = "High Alert"
                    elif score > 0.5:
                        status_emoji = "📈"
                        status_text = "Positive"
                    elif score < -0.5:
                        status_emoji = "📉"
                        status_text = "Negative"
                    else:
                        status_emoji = "➡️"
                        status_text = "Neutral"

                    return (
                        f"{status_emoji} <b>Market Status: {status_text}</b>\n\n"
                        f"📊 <b>Sentiment Score:</b> {score:.2f}\n"
                        f"🟢 <b>Positive:</b> {distribution.get('positive', 0):.1%}\n"
                        f"🔴 <b>Negative:</b> {distribution.get('negative', 0):.1%}\n"
                        f"⚪ <b>Neutral:</b> {distribution.get('neutral', 0):.1%}\n"
                        f"📰 <b>News Analyzed:</b> {sentiment_data.get('total_analyzed', 0)}\n\n"
                        f"<i>Last updated: {latest.get('timestamp', 'Unknown')}</i>"
                    )

            return "📊 <b>Market Status</b>\n\n❌ Unable to fetch current market data. Please try again later."

        except Exception as e:
            logger.error(f"Error in /status command: {e}")
            return "❌ Error fetching market status"

    def _handle_price(self, chat_id: int, args: str, user_info: Dict[str, Any]) -> str:
        """Handle /price command."""
        asset = args.upper() if args else "XLM"
        
        try:
            # TODO: Integrate with price API
            # For now, return placeholder
            return (
                f"💰 <b>{asset} Price Information</b>\n\n"
                f"📈 <b>Current Price:</b> $0.1234\n"
                f"📊 <b>24h Change:</b> +2.34%\n"
                f"💎 <b>24h Volume:</b> $45.6M\n"
                f"🏆 <b>Market Cap:</b> $4.56B\n\n"
                f"<i>Real-time price data coming soon!</i>"
            )

        except Exception as e:
            logger.error(f"Error in /price command: {e}")
            return f"❌ Error fetching {asset} price data"

    def _handle_sentiment(self, chat_id: int, args: str, user_info: Dict[str, Any]) -> str:
        """Handle /sentiment command."""
        try:
            if self.market_analyzer:
                # Get latest sentiment analysis
                sentiment_result = self.market_analyzer.get_latest_sentiment()
                
                if sentiment_result:
                    score = sentiment_result.get("average_compound_score", 0)
                    distribution = sentiment_result.get("sentiment_distribution", {})
                    confidence = sentiment_result.get("confidence", 0)
                    
                    # Determine sentiment
                    if score > 0.5:
                        sentiment_emoji = "🟢"
                        sentiment_label = "Positive"
                    elif score < -0.5:
                        sentiment_emoji = "🔴"
                        sentiment_label = "Negative"
                    else:
                        sentiment_emoji = "⚪"
                        sentiment_label = "Neutral"

                    return (
                        f"{sentiment_emoji} <b>Market Sentiment: {sentiment_label}</b>\n\n"
                        f"📊 <b>Score:</b> {score:.2f}\n"
                        f"🎯 <b>Confidence:</b> {confidence:.1%}\n"
                        f"🟢 <b>Positive:</b> {distribution.get('positive', 0):.1%}\n"
                        f"🔴 <b>Negative:</b> {distribution.get('negative', 0):.1%}\n"
                        f"⚪ <b>Neutral:</b> {distribution.get('neutral', 0):.1%}\n\n"
                        f"<i>Based on {sentiment_result.get('total_analyzed', 0)} recent articles</i>"
                    )

            return "📊 <b>Sentiment Analysis</b>\n\n❌ Unable to fetch sentiment data. Please try again later."

        except Exception as e:
            logger.error(f"Error in /sentiment command: {e}")
            return "❌ Error fetching sentiment analysis"

    def _handle_trend(self, chat_id: int, args: str, user_info: Dict[str, Any]) -> str:
        """Handle /trend command."""
        try:
            if self.trend_analyzer:
                # Get latest trend analysis
                trend_result = self.trend_analyzer.get_latest_trends()
                
                if trend_result:
                    direction = trend_result.get("direction", "unknown")
                    strength = trend_result.get("strength", 0)
                    
                    # Determine trend emoji
                    if direction == "bullish":
                        trend_emoji = "📈"
                    elif direction == "bearish":
                        trend_emoji = "📉"
                    else:
                        trend_emoji = "➡️"

                    return (
                        f"{trend_emoji} <b>Market Trend Analysis</b>\n\n"
                        f"📊 <b>Direction:</b> {direction.capitalize()}\n"
                        f"💪 <b>Strength:</b> {strength:.1%}\n"
                        f"⏱️ <b>Timeframe:</b> 24 hours\n"
                        f"📈 <b>Momentum:</b> {'Strong' if strength > 0.7 else 'Moderate' if strength > 0.4 else 'Weak'}\n\n"
                        f"<i>Trend analysis updated hourly</i>"
                    )

            return "📈 <b>Trend Analysis</b>\n\n❌ Unable to fetch trend data. Please try again later."

        except Exception as e:
            logger.error(f"Error in /trend command: {e}")
            return "❌ Error fetching trend analysis"

    def _handle_silence(self, chat_id: int, args: str, user_info: Dict[str, Any]) -> str:
        """Handle /silence command."""
        try:
            # Parse hours argument
            hours = 1  # default
            if args:
                try:
                    hours = int(args)
                    hours = max(1, min(24, hours))  # Limit between 1-24 hours
                except ValueError:
                    return "❌ Invalid hours. Use: /silence [1-24]"

            # Update subscription
            if self.database and self.database.postgres_service:
                subscription = self.database.postgres_service.get_telegram_subscription(chat_id)
                if subscription:
                    subscription.is_silenced = True
                    subscription.silence_until = datetime.now(timezone.utc) + timedelta(hours=hours)
                    self.database.postgres_service.update_telegram_subscription(subscription)
                    
                    return (
                        f"🔇 <b>Alerts Silenced</b>\n\n"
                        f"⏰ <b>Duration:</b> {hours} hour{'s' if hours > 1 else ''}\n"
                        f"🔔 <b>Resume:</b> {subscription.silence_until.strftime('%Y-%m-%d %H:%M UTC')}\n\n"
                        f"You won't receive alerts during this period. Use /settings to manage preferences."
                    )

            return f"🔇 Alerts silenced for {hours} hour{'s' if hours > 1 else ''}."

        except Exception as e:
            logger.error(f"Error in /silence command: {e}")
            return "❌ Error setting silence period"

    def _handle_subscribe(self, chat_id: int, args: str, user_info: Dict[str, Any]) -> str:
        """Handle /subscribe command."""
        alert_type = args.lower() if args else "all"
        
        try:
            if self.database and self.database.postgres_service:
                subscription = self.database.postgres_service.get_telegram_subscription(chat_id)
                if subscription:
                    # Update subscription preferences
                    if alert_type == "all":
                        subscription.sentiment_alerts = True
                        subscription.price_alerts = True
                        subscription.trend_alerts = True
                        subscription.news_alerts = True
                        message = "✅ <b>Subscribed to all alerts</b>"
                    elif alert_type in ["sentiment", "price", "trend", "news"]:
                        setattr(subscription, f"{alert_type}_alerts", True)
                        message = f"✅ <b>Subscribed to {alert_type} alerts</b>"
                    else:
                        return "❌ Invalid alert type. Use: sentiment, price, trend, news, or all"
                    
                    subscription.is_active = True
                    subscription.updated_at = datetime.now(timezone.utc)
                    self.database.postgres_service.update_telegram_subscription(subscription)
                    
                    return f"{message}\n\nYou'll receive notifications for this alert type."

            return "✅ Subscription updated successfully"

        except Exception as e:
            logger.error(f"Error in /subscribe command: {e}")
            return "❌ Error updating subscription"

    def _handle_unsubscribe(self, chat_id: int, args: str, user_info: Dict[str, Any]) -> str:
        """Handle /unsubscribe command."""
        alert_type = args.lower() if args else "all"
        
        try:
            if self.database and self.database.postgres_service:
                subscription = self.database.postgres_service.get_telegram_subscription(chat_id)
                if subscription:
                    # Update subscription preferences
                    if alert_type == "all":
                        subscription.sentiment_alerts = False
                        subscription.price_alerts = False
                        subscription.trend_alerts = False
                        subscription.news_alerts = False
                        subscription.is_active = False
                        message = "❌ <b>Unsubscribed from all alerts</b>"
                    elif alert_type in ["sentiment", "price", "trend", "news"]:
                        setattr(subscription, f"{alert_type}_alerts", False)
                        message = f"❌ <b>Unsubscribed from {alert_type} alerts</b>"
                    else:
                        return "❌ Invalid alert type. Use: sentiment, price, trend, news, or all"
                    
                    subscription.updated_at = datetime.now(timezone.utc)
                    self.database.postgres_service.update_telegram_subscription(subscription)
                    
                    return f"{message}\n\nYou won't receive notifications for this alert type."

            return "❌ Subscription updated successfully"

        except Exception as e:
            logger.error(f"Error in /unsubscribe command: {e}")
            return "❌ Error updating subscription"

    def _handle_settings(self, chat_id: int, args: str, user_info: Dict[str, Any]) -> str:
        """Handle /settings command."""
        try:
            if self.database and self.database.postgres_service:
                subscription = self.database.postgres_service.get_telegram_subscription(chat_id)
                if subscription:
                    # Format subscription status
                    status_emoji = "🟢" if subscription.is_active else "🔴"
                    silence_emoji = "🔇" if subscription.is_silenced else "🔊"
                    
                    alerts_status = []
                    if subscription.sentiment_alerts:
                        alerts_status.append("Sentiment 📊")
                    if subscription.price_alerts:
                        alerts_status.append("Price 💰")
                    if subscription.trend_alerts:
                        alerts_status.append("Trends 📈")
                    if subscription.news_alerts:
                        alerts_status.append("News 📰")
                    
                    alerts_text = "\n".join(f"  • {alert}" for alert in alerts_status) if alerts_status else "  • None"
                    
                    silence_info = ""
                    if subscription.is_silenced and subscription.silence_until:
                        silence_info = f"\n🔇 <b>Silenced until:</b> {subscription.silence_until.strftime('%Y-%m-%d %H:%M UTC')}"

                    return (
                        f"⚙️ <b>Your Subscription Settings</b>\n\n"
                        f"{status_emoji} <b>Status:</b> {'Active' if subscription.is_active else 'Inactive'}\n"
                        f"{silence_emoji} <b>Notifications:</b> {'Enabled' if not subscription.is_silenced else 'Silenced'}\n\n"
                        f"📋 <b>Active Alerts:</b>\n{alerts_text}\n"
                        f"{silence_info}\n\n"
                        f"<b>Quick Actions:</b>\n"
                        f"• /subscribe [type] - Enable alerts\n"
                        f"• /unsubscribe [type] - Disable alerts\n"
                        f"• /silence [hours] - Temporarily mute"
                    )

            return "⚙️ <b>Settings</b>\n\n❌ Unable to fetch your settings. Please try again later."

        except Exception as e:
            logger.error(f"Error in /settings command: {e}")
            return "❌ Error fetching settings"

    def send_alert_to_subscribers(self, message: str, alert_type: str = "sentiment") -> int:
        """
        Send alert to all active subscribers who haven't silenced this alert type.
        
        Args:
            message: Alert message to send
            alert_type: Type of alert (sentiment, price, trend, news)
            
        Returns:
            Number of successful sends
        """
        if not self.database or not self.database.postgres_service:
            logger.warning("No database service available for subscriber notifications")
            return 0

        try:
            # Get active subscribers for this alert type
            subscribers = self.database.postgres_service.get_active_subscribers(alert_type)
            successful_sends = 0

            for subscription in subscribers:
                # Check if user is silenced
                if subscription.is_silenced:
                    if subscription.silence_until and subscription.silence_until > datetime.now(timezone.utc):
                        continue  # Skip silenced users
                    else:
                        # Silence period expired, update subscription
                        subscription.is_silenced = False
                        subscription.silence_until = None
                        self.database.postgres_service.update_telegram_subscription(subscription)

                # Send alert
                if self.send_message(subscription.chat_id, message):
                    successful_sends += 1
                else:
                    logger.warning(f"Failed to send alert to chat_id: {subscription.chat_id}")

            logger.info(f"Sent {alert_type} alert to {successful_sends}/{len(subscribers)} subscribers")
            return successful_sends

        except Exception as e:
            logger.error(f"Error sending alert to subscribers: {e}")
            return 0

    def check_and_alert(
        self,
        analyzer_score: float,
        sentiment_data: Dict[str, Any],
        timestamp: Optional[datetime] = None,
    ) -> bool:
        """
        Check if sentiment score exceeds threshold and send alert to subscribers.
        
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

        # Format alert message (reuse existing formatting logic)
        message = self._format_alert_message(analyzer_score, sentiment_data, timestamp)
        
        # Send to all subscribers
        successful_sends = self.send_alert_to_subscribers(message, "sentiment")
        
        return successful_sends > 0

    def _format_alert_message(
        self,
        score: float,
        sentiment_data: Dict[str, Any],
        timestamp: Optional[datetime] = None,
    ) -> str:
        """Format a sentiment alert message (reused from original AlertBot)."""
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

        # Calculate confidence
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

    @property
    def is_configured(self) -> bool:
        """Check if the bot is properly configured."""
        return self._configured
