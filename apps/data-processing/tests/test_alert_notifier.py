"""Tests for AlertNotifier module."""

import unittest
from unittest.mock import patch, MagicMock
from datetime import datetime
from src.alert_notifier import AlertNotifier
from src.anomaly_detector import AnomalyResult


class TestAlertNotifier(unittest.TestCase):

    def setUp(self):
        # Patch environment variables
        self.env_patcher = patch.dict(
            "os.environ",
            {
                "TELEGRAM_BOT_TOKEN": "test_token",
                "TELEGRAM_CHANNEL_ID": "test_chat_id",
                "ALERT_WEBHOOK_URL": "http://test.webhook.com",
            },
        )
        self.env_patcher.start()
        self.notifier = AlertNotifier()

    def tearDown(self):
        self.env_patcher.stop()

    @patch("requests.Session.post")
    def test_notify_anomaly_telegram(self, mock_post):
        # Setup mock response
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_post.return_value = mock_response

        # Create an anomaly result
        result = AnomalyResult(
            is_anomaly=True,
            severity_score=0.9,
            metric_name="volume",
            current_value=150000.0,
            baseline_mean=50000.0,
            baseline_std=10000.0,
            z_score=10.0,
            timestamp=datetime.now(),
        )

        # Notify
        self.notifier.notify_anomaly(result)

        # Verify Telegram call
        self.assertTrue(
            any("api.telegram.org" in call.args[0] for call in mock_post.call_args_list)
        )

        # Verify Webhook call
        self.assertTrue(
            any("test.webhook.com" in call.args[0] for call in mock_post.call_args_list)
        )

    @patch("requests.Session.post")
    def test_no_notification_if_not_anomaly(self, mock_post):
        # Create a non-anomaly result
        result = AnomalyResult(
            is_anomaly=False,
            severity_score=0.1,
            metric_name="volume",
            current_value=51000.0,
            baseline_mean=50000.0,
            baseline_std=10000.0,
            z_score=0.1,
            timestamp=datetime.now(),
        )

        # Notify
        self.notifier.notify_anomaly(result)

        # Verify no calls to requests.post
        mock_post.assert_not_called()


if __name__ == "__main__":
    unittest.main()
