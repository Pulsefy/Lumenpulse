"""
Unit tests for InteractiveAlertBot class.

Tests cover:
- Command handlers (/status, /price, /sentiment, /trend, /silence, etc.)
- Subscription management functionality
- Database integration for subscriptions and commands
- Message processing and error handling
"""

import unittest
from unittest.mock import patch, MagicMock, Mock
from datetime import datetime, timezone, timedelta
import json

from src.interactive_alertbot import InteractiveAlertBot
from src.database import DatabaseService
from src.db.models import TelegramSubscription, TelegramCommand


class TestInteractiveAlertBot(unittest.TestCase):
    """Test InteractiveAlertBot class"""

    def setUp(self):
        """Set up test bot instance"""
        self.bot = InteractiveAlertBot(
            telegram_bot_token="test_token_123",
            dry_run=True,  # Use dry-run mode for testing
        )
        
        # Mock database service
        self.mock_db_service = Mock(spec=DatabaseService)
        self.mock_postgres = Mock()
        self.mock_db_service.postgres_service = self.mock_postgres
        self.bot.database = self.mock_db_service

        # Mock analyzers
        self.mock_market_analyzer = Mock()
        self.mock_trend_analyzer = Mock()
        self.bot.market_analyzer = self.mock_market_analyzer
        self.bot.trend_analyzer = self.mock_trend_analyzer

    def test_init_with_token(self):
        """Test initialization with token"""
        bot = InteractiveAlertBot(telegram_bot_token="test_token")
        self.assertTrue(bot.is_configured)
        self.assertEqual(bot.bot_token, "test_token")

    def test_init_without_token(self):
        """Test initialization without token"""
        bot = InteractiveAlertBot()
        self.assertFalse(bot.is_configured)

    def test_command_handlers_mapping(self):
        """Test that all expected command handlers are registered"""
        expected_commands = {
            '/start', '/help', '/status', '/price', '/sentiment', 
            '/trend', '/silence', '/subscribe', '/unsubscribe', '/settings'
        }
        actual_commands = set(self.bot.command_handlers.keys())
        self.assertEqual(expected_commands, actual_commands)

    @patch.object(InteractiveAlertBot, 'send_message')
    def test_process_update_with_message(self, mock_send):
        """Test processing a message update"""
        update = {
            "update_id": 123,
            "message": {
                "message_id": 456,
                "chat": {"id": 789, "type": "private"},
                "from": {"first_name": "Test", "username": "testuser"},
                "text": "/start"
            }
        }

        # Mock subscription creation
        mock_subscription = Mock(spec=TelegramSubscription)
        mock_subscription.chat_id = 789
        self.mock_postgres.get_telegram_subscription.return_value = None
        self.mock_postgres.create_telegram_subscription.return_value = mock_subscription

        result = self.bot.process_update(update)
        
        self.assertTrue(result)
        mock_send.assert_called_once()

    @patch.object(InteractiveAlertBot, 'send_message')
    def test_process_update_with_callback(self, mock_send):
        """Test processing a callback query update"""
        update = {
            "update_id": 123,
            "callback_query": {
                "id": "callback123",
                "message": {
                    "message_id": 456,
                    "chat": {"id": 789, "type": "private"}
                },
                "data": "test_callback"
            }
        }

        result = self.bot.process_update(update)
        
        # Currently returns False as callback handling is not implemented
        self.assertFalse(result)

    @patch.object(InteractiveAlertBot, 'send_message')
    def test_process_command_unknown(self, mock_send):
        """Test processing unknown command"""
        user_info = {"chat_type": "private"}
        result = self.bot._process_command(789, "/unknown", user_info)
        
        self.assertFalse(result)
        mock_send.assert_called_once_with(789, "❌ Unknown command. Use /help for available commands.")

    @patch.object(InteractiveAlertBot, 'send_message')
    @patch.object(InteractiveAlertBot, '_ensure_subscription')
    def test_handle_start_command(self, mock_ensure_subscription, mock_send):
        """Test /start command handler"""
        mock_ensure_subscription.return_value = Mock(spec=TelegramSubscription)
        
        response = self.bot._handle_start(789, "", {"chat_type": "private"})
        
        self.assertIn("Welcome to LumenPulse", response)
        self.assertIn("/help", response)

    @patch.object(InteractiveAlertBot, 'send_message')
    def test_handle_help_command(self, mock_send):
        """Test /help command handler"""
        response = self.bot._handle_help(789, "", {"chat_type": "private"})
        
        self.assertIn("LumenPulse Bot Commands", response)
        self.assertIn("/status", response)
        self.assertIn("/price", response)

    @patch.object(InteractiveAlertBot, 'send_message')
    def test_handle_status_command_with_data(self, mock_send):
        """Test /status command with analytics data"""
        # Mock database response
        latest_data = {
            "sentiment_data": {
                "average_compound_score": 0.75,
                "sentiment_distribution": {
                    "positive": 0.6,
                    "negative": 0.2,
                    "neutral": 0.2
                },
                "total_analyzed": 50
            },
            "timestamp": "2026-04-24T10:30:00Z"
        }
        
        self.mock_db_service.get_latest_analytics.return_value = latest_data
        
        response = self.bot._handle_status(789, "", {"chat_type": "private"})
        
        self.assertIn("Market Status", response)
        self.assertIn("0.75", response)
        self.assertIn("Positive", response)

    @patch.object(InteractiveAlertBot, 'send_message')
    def test_handle_status_command_no_data(self, mock_send):
        """Test /status command with no analytics data"""
        self.mock_db_service.get_latest_analytics.return_value = {}
        
        response = self.bot._handle_status(789, "", {"chat_type": "private"})
        
        self.assertIn("Unable to fetch current market data", response)

    @patch.object(InteractiveAlertBot, 'send_message')
    def test_handle_price_command_default(self, mock_send):
        """Test /price command with default asset"""
        response = self.bot._handle_price(789, "", {"chat_type": "private"})
        
        self.assertIn("XLM Price Information", response)
        self.assertIn("$0.1234", response)

    @patch.object(InteractiveAlertBot, 'send_message')
    def test_handle_price_command_with_asset(self, mock_send):
        """Test /price command with specific asset"""
        response = self.bot._handle_price(789, "BTC", {"chat_type": "private"})
        
        self.assertIn("BTC Price Information", response)

    @patch.object(InteractiveAlertBot, 'send_message')
    def test_handle_sentiment_command_with_analyzer(self, mock_send):
        """Test /sentiment command with market analyzer"""
        # Mock market analyzer response
        sentiment_result = {
            "average_compound_score": 0.65,
            "sentiment_distribution": {
                "positive": 0.55,
                "negative": 0.25,
                "neutral": 0.20
            },
            "confidence": 0.85,
            "total_analyzed": 30
        }
        
        self.mock_market_analyzer.get_latest_sentiment.return_value = sentiment_result
        
        response = self.bot._handle_sentiment(789, "", {"chat_type": "private"})
        
        self.assertIn("Market Sentiment: Positive", response)
        self.assertIn("0.65", response)
        self.assertIn("85.0%", response)

    @patch.object(InteractiveAlertBot, 'send_message')
    def test_handle_sentiment_command_no_analyzer(self, mock_send):
        """Test /sentiment command without market analyzer"""
        self.bot.market_analyzer = None
        
        response = self.bot._handle_sentiment(789, "", {"chat_type": "private"})
        
        self.assertIn("Unable to fetch sentiment data", response)

    @patch.object(InteractiveAlertBot, 'send_message')
    def test_handle_trend_command_with_analyzer(self, mock_send):
        """Test /trend command with trend analyzer"""
        # Mock trend analyzer response
        trend_result = {
            "direction": "bullish",
            "strength": 0.75
        }
        
        self.mock_trend_analyzer.get_latest_trends.return_value = trend_result
        
        response = self.bot._handle_trend(789, "", {"chat_type": "private"})
        
        self.assertIn("Market Trend Analysis", response)
        self.assertIn("Bullish", response)
        self.assertIn("75.0%", response)

    @patch.object(InteractiveAlertBot, 'send_message')
    def test_handle_silence_command_default(self, mock_send):
        """Test /silence command with default duration"""
        # Mock subscription
        mock_subscription = Mock(spec=TelegramSubscription)
        mock_subscription.chat_id = 789
        mock_subscription.is_silenced = False
        mock_subscription.silence_until = None
        
        self.mock_postgres.get_telegram_subscription.return_value = mock_subscription
        self.mock_postgres.update_telegram_subscription.return_value = mock_subscription
        
        response = self.bot._handle_silence(789, "", {"chat_type": "private"})
        
        self.assertIn("Alerts Silenced", response)
        self.assertIn("1 hour", response)

    @patch.object(InteractiveAlertBot, 'send_message')
    def test_handle_silence_command_with_hours(self, mock_send):
        """Test /silence command with specific hours"""
        # Mock subscription
        mock_subscription = Mock(spec=TelegramSubscription)
        mock_subscription.chat_id = 789
        mock_subscription.is_silenced = False
        mock_subscription.silence_until = None
        
        self.mock_postgres.get_telegram_subscription.return_value = mock_subscription
        self.mock_postgres.update_telegram_subscription.return_value = mock_subscription
        
        response = self.bot._handle_silence(789, "6", {"chat_type": "private"})
        
        self.assertIn("Alerts Silenced", response)
        self.assertIn("6 hours", response)

    @patch.object(InteractiveAlertBot, 'send_message')
    def test_handle_silence_command_invalid_hours(self, mock_send):
        """Test /silence command with invalid hours"""
        response = self.bot._handle_silence(789, "invalid", {"chat_type": "private"})
        
        self.assertIn("Invalid hours", response)

    @patch.object(InteractiveAlertBot, 'send_message')
    def test_handle_subscribe_command_all(self, mock_send):
        """Test /subscribe command for all alerts"""
        # Mock subscription
        mock_subscription = Mock(spec=TelegramSubscription)
        mock_subscription.chat_id = 789
        mock_subscription.is_active = False
        mock_subscription.sentiment_alerts = False
        mock_subscription.price_alerts = False
        mock_subscription.trend_alerts = False
        mock_subscription.news_alerts = False
        
        self.mock_postgres.get_telegram_subscription.return_value = mock_subscription
        self.mock_postgres.update_telegram_subscription.return_value = mock_subscription
        
        response = self.bot._handle_subscribe(789, "all", {"chat_type": "private"})
        
        self.assertIn("Subscribed to all alerts", response)
        self.assertTrue(mock_subscription.is_active)
        self.assertTrue(mock_subscription.sentiment_alerts)
        self.assertTrue(mock_subscription.price_alerts)
        self.assertTrue(mock_subscription.trend_alerts)
        self.assertTrue(mock_subscription.news_alerts)

    @patch.object(InteractiveAlertBot, 'send_message')
    def test_handle_subscribe_command_specific(self, mock_send):
        """Test /subscribe command for specific alert type"""
        # Mock subscription
        mock_subscription = Mock(spec=TelegramSubscription)
        mock_subscription.chat_id = 789
        mock_subscription.sentiment_alerts = False
        
        self.mock_postgres.get_telegram_subscription.return_value = mock_subscription
        self.mock_postgres.update_telegram_subscription.return_value = mock_subscription
        
        response = self.bot._handle_subscribe(789, "sentiment", {"chat_type": "private"})
        
        self.assertIn("Subscribed to sentiment alerts", response)
        self.assertTrue(mock_subscription.sentiment_alerts)

    @patch.object(InteractiveAlertBot, 'send_message')
    def test_handle_unsubscribe_command_all(self, mock_send):
        """Test /unsubscribe command for all alerts"""
        # Mock subscription
        mock_subscription = Mock(spec=TelegramSubscription)
        mock_subscription.chat_id = 789
        mock_subscription.is_active = True
        mock_subscription.sentiment_alerts = True
        mock_subscription.price_alerts = True
        mock_subscription.trend_alerts = True
        mock_subscription.news_alerts = True
        
        self.mock_postgres.get_telegram_subscription.return_value = mock_subscription
        self.mock_postgres.update_telegram_subscription.return_value = mock_subscription
        
        response = self.bot._handle_unsubscribe(789, "all", {"chat_type": "private"})
        
        self.assertIn("Unsubscribed from all alerts", response)
        self.assertFalse(mock_subscription.is_active)
        self.assertFalse(mock_subscription.sentiment_alerts)
        self.assertFalse(mock_subscription.price_alerts)
        self.assertFalse(mock_subscription.trend_alerts)
        self.assertFalse(mock_subscription.news_alerts)

    @patch.object(InteractiveAlertBot, 'send_message')
    def test_handle_settings_command(self, mock_send):
        """Test /settings command"""
        # Mock subscription
        mock_subscription = Mock(spec=TelegramSubscription)
        mock_subscription.chat_id = 789
        mock_subscription.is_active = True
        mock_subscription.is_silenced = False
        mock_subscription.sentiment_alerts = True
        mock_subscription.price_alerts = False
        mock_subscription.trend_alerts = True
        mock_subscription.news_alerts = False
        mock_subscription.silence_until = None
        
        self.mock_postgres.get_telegram_subscription.return_value = mock_subscription
        
        response = self.bot._handle_settings(789, "", {"chat_type": "private"})
        
        self.assertIn("Your Subscription Settings", response)
        self.assertIn("Active", response)
        self.assertIn("Sentiment", response)
        self.assertIn("Trends", response)

    def test_ensure_subscription_creates_new(self):
        """Test _ensure_subscription creates new subscription when none exists"""
        self.mock_postgres.get_telegram_subscription.return_value = None
        
        user_info = {
            'chat_type': 'private',
            'username': 'testuser',
            'first_name': 'Test',
            'last_name': 'User'
        }
        
        subscription = self.bot._ensure_subscription(789, user_info)
        
        self.assertIsNotNone(subscription)
        self.mock_postgres.create_telegram_subscription.assert_called_once()

    def test_ensure_subscription_updates_existing(self):
        """Test _ensure_subscription updates existing subscription"""
        # Mock existing subscription
        mock_subscription = Mock(spec=TelegramSubscription)
        mock_subscription.chat_id = 789
        mock_subscription.last_interaction = datetime.now(timezone.utc) - timedelta(hours=1)
        
        self.mock_postgres.get_telegram_subscription.return_value = mock_subscription
        
        user_info = {'chat_type': 'private'}
        
        subscription = self.bot._ensure_subscription(789, user_info)
        
        self.assertEqual(subscription, mock_subscription)
        self.mock_postgres.update_telegram_subscription.assert_called_once()

    def test_send_alert_to_subscribers(self):
        """Test sending alerts to subscribers"""
        # Mock subscribers
        mock_sub1 = Mock(spec=TelegramSubscription)
        mock_sub1.chat_id = 789
        mock_sub1.is_silenced = False
        mock_sub1.silence_until = None
        
        mock_sub2 = Mock(spec=TelegramSubscription)
        mock_sub2.chat_id = 790
        mock_sub2.is_silenced = True
        mock_sub2.silence_until = datetime.now(timezone.utc) + timedelta(hours=1)
        
        self.mock_postgres.get_active_subscribers.return_value = [mock_sub1, mock_sub2]
        
        with patch.object(self.bot, 'send_message', return_value=True) as mock_send:
            result = self.bot.send_alert_to_subscribers("Test alert", "sentiment")
            
            self.assertEqual(result, 1)  # Only one non-silenced subscriber
            mock_send.assert_called_once_with(789, "Test alert")

    def test_check_and_alert_with_threshold(self):
        """Test check_and_alert when threshold is exceeded"""
        sentiment_data = {
            "average_compound_score": 0.75,
            "sentiment_distribution": {"positive": 0.6, "negative": 0.2, "neutral": 0.2},
            "total_analyzed": 50
        }
        
        # Mock subscribers
        mock_sub = Mock(spec=TelegramSubscription)
        mock_sub.chat_id = 789
        mock_sub.is_silenced = False
        self.mock_postgres.get_active_subscribers.return_value = [mock_sub]
        
        with patch.object(self.bot, 'send_message', return_value=True):
            result = self.bot.check_and_alert(0.85, sentiment_data)
            
            self.assertTrue(result)

    def test_check_and_alert_below_threshold(self):
        """Test check_and_alert when score is below threshold"""
        sentiment_data = {"total_analyzed": 50}
        
        result = self.bot.check_and_alert(0.5, sentiment_data)
        
        self.assertFalse(result)

    def test_format_alert_message(self):
        """Test alert message formatting"""
        sentiment_data = {
            "average_compound_score": 0.75,
            "sentiment_distribution": {
                "positive": 0.6,
                "negative": 0.2,
                "neutral": 0.2
            },
            "total_analyzed": 50,
            "trend_direction": "bullish"
        }
        
        timestamp = datetime(2026, 4, 24, 10, 30, tzinfo=timezone.utc)
        
        message = self.bot._format_alert_message(0.85, sentiment_data, timestamp)
        
        self.assertIn("High Sentiment Alert", message)
        self.assertIn("0.85", message)
        self.assertIn("Bullish", message)
        self.assertIn("📈", message)
        self.assertIn("2026-04-24 10:30:00 UTC", message)


class TestTelegramWebhookService(unittest.TestCase):
    """Test TelegramWebhookService class"""

    def setUp(self):
        """Set up test webhook service"""
        self.mock_bot = Mock(spec=InteractiveAlertBot)
        self.mock_bot.bot_token = "test_token"
        self.mock_bot.process_update.return_value = True
        
        from src.telegram_webhook import TelegramWebhookService
        self.webhook_service = TelegramWebhookService(
            bot=self.mock_bot,
            polling_interval=1,  # Short interval for testing
        )

    @patch('requests.post')
    def test_setup_webhook_success(self, mock_post):
        """Test successful webhook setup"""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"ok": True, "result": True}
        mock_post.return_value = mock_response
        
        result = self.webhook_service.setup_webhook("https://example.com/webhook")
        
        self.assertTrue(result)
        mock_post.assert_called_once()

    @patch('requests.post')
    def test_setup_webhook_failure(self, mock_post):
        """Test webhook setup failure"""
        mock_response = Mock()
        mock_response.status_code = 400
        mock_response.json.return_value = {"ok": False, "description": "Bad request"}
        mock_post.return_value = mock_response
        
        result = self.webhook_service.setup_webhook("https://example.com/webhook")
        
        self.assertFalse(result)

    def test_process_webhook_update(self):
        """Test processing webhook update"""
        update = {
            "update_id": 123,
            "message": {
                "message_id": 456,
                "chat": {"id": 789},
                "text": "/start"
            }
        }
        
        result = self.webhook_service.process_webhook_update(update)
        
        self.assertTrue(result)
        self.mock_bot.process_update.assert_called_once_with(update)

    def test_process_webhook_update_error(self):
        """Test processing webhook update with error"""
        self.mock_bot.process_update.side_effect = Exception("Test error")
        
        update = {"update_id": 123}
        
        result = self.webhook_service.process_webhook_update(update)
        
        self.assertFalse(result)


if __name__ == "__main__":
    unittest.main()
