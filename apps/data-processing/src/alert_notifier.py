import os
import time
import requests


class AlertNotifier:
    def __init__(self):
        self.telegram_bot_token = os.getenv('TELEGRAM_BOT_TOKEN')
        self.telegram_channel_id = os.getenv('TELEGRAM_CHANNEL_ID')
        self.webhook_urls = self._load_webhook_urls()
        self.max_retries = int(os.getenv('WEBHOOK_MAX_RETRIES', '3'))
        self.base_backoff_seconds = float(os.getenv('WEBHOOK_BACKOFF_SECONDS', '1'))

    def _load_webhook_urls(self):
        urls = []

        single_url = os.getenv('ALERT_WEBHOOK_URL')
        if single_url:
            urls.append(single_url)

        registry = os.getenv('ALERT_WEBHOOK_URLS', '')
        if registry:
            urls.extend([url.strip() for url in registry.split(',') if url.strip()])

        return list(dict.fromkeys(urls))

    def notify_anomaly(self, result):
        if not getattr(result, 'is_anomaly', False):
            return

        payload = {
            'event': 'high_priority_insight',
            'type': 'anomaly',
            'metric_name': result.metric_name,
            'severity_score': result.severity_score,
            'current_value': result.current_value,
            'baseline_mean': result.baseline_mean,
            'baseline_std': result.baseline_std,
            'z_score': result.z_score,
            'timestamp': result.timestamp.isoformat() if result.timestamp else None,
        }

        self._send_telegram(payload)
        self._send_webhooks(payload)

    def _send_telegram(self, payload):
        if not self.telegram_bot_token or not self.telegram_channel_id:
            return

        text = (
            '🚨 High-Priority Insight\n'
            f"Metric: {payload['metric_name']}\n"
            f"Severity: {payload['severity_score']}\n"
            f"Current: {payload['current_value']}\n"
            f"Z-Score: {payload['z_score']}"
        )

        requests.post(
            f"https://api.telegram.org/bot{self.telegram_bot_token}/sendMessage",
            json={
                'chat_id': self.telegram_channel_id,
                'text': text,
            },
            timeout=10,
        )

    def _send_webhooks(self, payload):
        for url in self.webhook_urls:
            self._post_with_retry(url, payload)

    def _post_with_retry(self, url, payload):
        for attempt in range(self.max_retries):
            try:
                response = requests.post(url, json=payload, timeout=10)
                if response.status_code < 400:
                    return True
            except requests.RequestException:
                pass

            if attempt < self.max_retries - 1:
                time.sleep(self.base_backoff_seconds * (2 ** attempt))

        return False
