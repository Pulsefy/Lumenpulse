"""
Unit tests for AlertBot class.

Tests cover:
- send_alert() with mocked requests (success, rate limiting, auth failures, network errors)
- Threshold logic (triggers at score > 0.8, not at <= 0.8)
- Message formatting and truncation
- Configuration handling
"""
import unittest
from unittest.mock import patch, MagicMock
from datetime import datetime, timezone
import json

from src.alertbot import AlertBot


class TestAlertBotConfiguration(unittest.TestCase):
    """Test AlertBot configuration and initialization"""
    
    def test_init_with_explicit_credentials(self):
        """Test initialization with explicit token and channel ID"""
        bot = AlertBot(
            telegram_bot_token="test_token_123",
            telegram_channel_id="@test_channel"
        )
        self.assertTrue(bot.is_configured)
        self.assertEqual(bot.bot_token, "test_token_123")
        self.assertEqual(bot.channel_id, "@test_channel")
    
    @patch.dict('os.environ', {'TELEGRAM_BOT_TOKEN': 'env_token', 'TELEGRAM_CHANNEL_ID': '-100123456'})
    def test_init_from_environment(self):
        """Test initialization from environment variables"""
        bot = AlertBot()
        self.assertTrue(bot.is_configured)
        self.assertEqual(bot.bot_token, "env_token")
        self.assertEqual(bot.channel_id, "-100123456")
    
    @patch.dict('os.environ', {}, clear=True)
    def test_init_missing_config(self):
        """Test initialization with missing configuration"""
        # Clear any existing env vars
        bot = AlertBot(telegram_bot_token=None, telegram_channel_id=None)
        self.assertFalse(bot.is_configured)
    
    def test_dry_run_mode(self):
        """Test dry-run mode initialization"""
        bot = AlertBot(
            telegram_bot_token="test_token",
            telegram_channel_id="@channel",
            dry_run=True
        )
        self.assertTrue(bot.dry_run)
        self.assertTrue(bot.is_configured)


class TestSendAlert(unittest.TestCase):
    """Test send_alert() method with mocked requests"""
    
    def setUp(self):
        """Set up test bot instance"""
        self.bot = AlertBot(
            telegram_bot_token="test_token_123",
            telegram_channel_id="@test_channel"
        )
    
    @patch('src.alertbot.requests.post')
    def test_send_alert_success(self, mock_post):
        """Test successful alert send"""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_post.return_value = mock_response
        
        result = self.bot.send_alert("Test message")
        
        self.assertTrue(result)
        mock_post.assert_called_once()
        
        # Verify request payload
        call_args = mock_post.call_args
        self.assertIn("chat_id", call_args.kwargs.get("json", {}))
        self.assertIn("text", call_args.kwargs.get("json", {}))
    
    @patch('src.alertbot.requests.post')
    def test_send_alert_rate_limited_with_retry(self, mock_post):
        """Test rate limiting (429) triggers retry with backoff"""
        # First call returns 429, second succeeds
        mock_429 = MagicMock()
        mock_429.status_code = 429
        mock_429.json.return_value = {"parameters": {"retry_after": 1}}
        
        mock_200 = MagicMock()
        mock_200.status_code = 200
        
        mock_post.side_effect = [mock_429, mock_200]
        
        result = self.bot.send_alert("Test message")
        
        self.assertTrue(result)
        self.assertEqual(mock_post.call_count, 2)
    
    @patch('src.alertbot.requests.post')
    def test_send_alert_rate_limited_max_retries(self, mock_post):
        """Test rate limiting exhausts all retries"""
        mock_429 = MagicMock()
        mock_429.status_code = 429
        mock_429.json.return_value = {"parameters": {"retry_after": 0.1}}
        
        mock_post.return_value = mock_429
        
        result = self.bot.send_alert("Test message")
        
        self.assertFalse(result)
        # Initial attempt + MAX_RETRIES
        self.assertEqual(mock_post.call_count, AlertBot.MAX_RETRIES + 1)
    
    @patch('src.alertbot.requests.post')
    def test_send_alert_auth_failure_401(self, mock_post):
        """Test authentication failure (401) does not retry"""
        mock_response = MagicMock()
        mock_response.status_code = 401
        mock_response.json.return_value = {"description": "Unauthorized"}
        mock_post.return_value = mock_response
        
        result = self.bot.send_alert("Test message")
        
        self.assertFalse(result)
        self.assertEqual(mock_post.call_count, 1)  # No retry
    
    @patch('src.alertbot.requests.post')
    def test_send_alert_auth_failure_403(self, mock_post):
        """Test forbidden error (403) does not retry"""
        mock_response = MagicMock()
        mock_response.status_code = 403
        mock_response.json.return_value = {"description": "Forbidden"}
        mock_post.return_value = mock_response
        
        result = self.bot.send_alert("Test message")
        
        self.assertFalse(result)
        self.assertEqual(mock_post.call_count, 1)  # No retry
    
    @patch('src.alertbot.requests.post')
    def test_send_alert_connection_error(self, mock_post):
        """Test connection error handling"""
        import requests
        mock_post.side_effect = requests.exceptions.ConnectionError("Network unreachable")
        
        result = self.bot.send_alert("Test message")
        
        self.assertFalse(result)
    
    @patch('src.alertbot.requests.post')
    def test_send_alert_timeout(self, mock_post):
        """Test timeout with retry"""
        import requests
        
        # First timeout, then success
        mock_200 = MagicMock()
        mock_200.status_code = 200
        
        mock_post.side_effect = [
            requests.exceptions.Timeout("Request timed out"),
            mock_200
        ]
        
        result = self.bot.send_alert("Test message")
        
        self.assertTrue(result)
        self.assertEqual(mock_post.call_count, 2)
    
    def test_send_alert_dry_run(self):
        """Test dry-run mode does not make HTTP requests"""
        bot = AlertBot(
            telegram_bot_token="test_token",
            telegram_channel_id="@channel",
            dry_run=True
        )
        
        with patch('src.alertbot.requests.post') as mock_post:
            result = bot.send_alert("Test message")
            
            self.assertTrue(result)  # Dry run returns True
            mock_post.assert_not_called()  # No actual request made
    
    def test_send_alert_unconfigured(self):
        """Test unconfigured bot logs but returns False"""
        bot = AlertBot(telegram_bot_token=None, telegram_channel_id=None)
        
        with patch('src.alertbot.requests.post') as mock_post:
            result = bot.send_alert("Test message")
            
            self.assertFalse(result)
            mock_post.assert_not_called()


class TestMessageTruncation(unittest.TestCase):
    """Test message truncation for Telegram's character limit"""
    
    def setUp(self):
        self.bot = AlertBot(
            telegram_bot_token="test_token",
            telegram_channel_id="@channel"
        )
    
    def test_short_message_not_truncated(self):
        """Test short messages pass through unchanged"""
        short_msg = "This is a short message"
        result = self.bot._truncate_message(short_msg)
        self.assertEqual(result, short_msg)
    
    def test_long_message_truncated(self):
        """Test messages exceeding limit are truncated"""
        long_msg = "A" * 5000  # Exceeds 4096 limit
        result = self.bot._truncate_message(long_msg)
        
        self.assertLessEqual(len(result), AlertBot.MAX_MESSAGE_LENGTH)
        self.assertIn("truncated", result.lower())
    
    def test_exactly_max_length_not_truncated(self):
        """Test message exactly at limit is not truncated"""
        exact_msg = "A" * AlertBot.MAX_MESSAGE_LENGTH
        result = self.bot._truncate_message(exact_msg)
        self.assertEqual(result, exact_msg)


class TestCheckAndAlert(unittest.TestCase):
    """Test check_and_alert() threshold logic"""
    
    def setUp(self):
        self.bot = AlertBot(
            telegram_bot_token="test_token",
            telegram_channel_id="@channel"
        )
        self.sample_sentiment_data = {
            "average_compound_score": 0.75,
            "sentiment_distribution": {
                "positive": 0.65,
                "negative": 0.15,
                "neutral": 0.20
            },
            "trend_direction": "bullish",
            "total_analyzed": 50
        }
    
    @patch.object(AlertBot, 'send_alert', return_value=True)
    def test_alert_triggers_above_threshold(self, mock_send):
        """Test alert triggers when score > 0.8"""
        result = self.bot.check_and_alert(0.85, self.sample_sentiment_data)
        
        self.assertTrue(result)
        mock_send.assert_called_once()
    
    @patch.object(AlertBot, 'send_alert', return_value=True)
    def test_alert_triggers_at_0_81(self, mock_send):
        """Test alert triggers at score 0.81 (just above threshold)"""
        result = self.bot.check_and_alert(0.81, self.sample_sentiment_data)
        
        self.assertTrue(result)
        mock_send.assert_called_once()
    
    @patch.object(AlertBot, 'send_alert', return_value=True)
    def test_no_alert_at_threshold(self, mock_send):
        """Test NO alert at exactly 0.8 (threshold is > not >=)"""
        result = self.bot.check_and_alert(0.8, self.sample_sentiment_data)
        
        self.assertFalse(result)
        mock_send.assert_not_called()
    
    @patch.object(AlertBot, 'send_alert', return_value=True)
    def test_no_alert_below_threshold(self, mock_send):
        """Test NO alert when score < 0.8"""
        result = self.bot.check_and_alert(0.5, self.sample_sentiment_data)
        
        self.assertFalse(result)
        mock_send.assert_not_called()
    
    @patch.object(AlertBot, 'send_alert', return_value=True)
    def test_no_alert_at_zero(self, mock_send):
        """Test NO alert when score is 0"""
        result = self.bot.check_and_alert(0.0, self.sample_sentiment_data)
        
        self.assertFalse(result)
        mock_send.assert_not_called()
    
    @patch.object(AlertBot, 'send_alert', return_value=True)
    def test_no_alert_negative_score(self, mock_send):
        """Test NO alert when score is negative"""
        result = self.bot.check_and_alert(-0.5, self.sample_sentiment_data)
        
        self.assertFalse(result)
        mock_send.assert_not_called()


class TestMessageFormatting(unittest.TestCase):
    """Test alert message formatting"""
    
    def setUp(self):
        self.bot = AlertBot(
            telegram_bot_token="test_token",
            telegram_channel_id="@channel"
        )
    
    def test_message_contains_score(self):
        """Test formatted message contains the score"""
        sentiment_data = {
            "average_compound_score": 0.75,
            "sentiment_distribution": {"positive": 0.6, "negative": 0.2, "neutral": 0.2},
            "trend_direction": "bullish",
            "total_analyzed": 30
        }
        
        message = self.bot._format_alert_message(0.85, sentiment_data)
        
        self.assertIn("0.85", message)
    
    def test_message_contains_trend(self):
        """Test formatted message contains trend direction"""
        sentiment_data = {
            "average_compound_score": 0.75,
            "sentiment_distribution": {"positive": 0.6, "negative": 0.2, "neutral": 0.2},
            "trend_direction": "bullish",
            "total_analyzed": 30
        }
        
        message = self.bot._format_alert_message(0.85, sentiment_data)
        
        self.assertIn("Bullish", message)
        self.assertIn("📈", message)
    
    def test_message_contains_timestamp(self):
        """Test formatted message contains timestamp"""
        timestamp = datetime(2026, 1, 25, 10, 30, 0, tzinfo=timezone.utc)
        sentiment_data = {
            "average_compound_score": 0.75,
            "sentiment_distribution": {"positive": 0.6, "negative": 0.2, "neutral": 0.2},
            "trend_direction": "neutral",
            "total_analyzed": 30
        }
        
        message = self.bot._format_alert_message(0.85, sentiment_data, timestamp)
        
        self.assertIn("2026-01-25", message)
        self.assertIn("10:30:00", message)
    
    def test_message_contains_alert_header(self):
        """Test message has alert header"""
        sentiment_data = {
            "average_compound_score": 0.75,
            "sentiment_distribution": {"positive": 0.6, "negative": 0.2, "neutral": 0.2},
            "total_analyzed": 30
        }
        
        message = self.bot._format_alert_message(0.85, sentiment_data)
        
        self.assertIn("🚨", message)
        self.assertIn("High Sentiment Alert", message)
    
    def test_message_shows_anomalies_when_present(self):
        """Test message includes anomaly count when detected"""
        sentiment_data = {
            "average_compound_score": 0.75,
            "sentiment_distribution": {"positive": 0.6, "negative": 0.2, "neutral": 0.2},
            "total_analyzed": 30,
            "anomalies_detected": 2
        }
        
        message = self.bot._format_alert_message(0.85, sentiment_data)
        
        self.assertIn("Anomalies detected: 2", message)


class TestThreadSafety(unittest.TestCase):
    """Test thread safety of AlertBot"""
    
    def test_has_lock(self):
        """Test AlertBot has a threading lock"""
        bot = AlertBot(
            telegram_bot_token="test_token",
            telegram_channel_id="@channel"
        )
        self.assertIsNotNone(bot._lock)


if __name__ == '__main__':
    unittest.main()
