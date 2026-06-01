# Indexer Lag Alerting - Integration Guide

## Quick Start

This guide shows how to integrate the indexer lag alerting system into the existing Lumenpulse data-processing pipeline.

## 1. Environment Configuration

Add these to your `.env` file:

```bash
# Required: Database connection (already configured)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/lumenpulse

# Optional: Telegram alerts
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHANNEL_ID=your_channel_id_here

# Optional: Webhook alerts
ALERT_WEBHOOK_URLS=https://example.com/alerts,https://other.com/alerts

# Monitoring schedule (optional)
MONITORING_INTERVAL_MINUTES=5
```

## 2. Integrate with Scheduler

Update `src/scheduler.py`:

```python
from apscheduler.triggers.interval import IntervalTrigger
from src.metrics.ingestion_monitoring import IngestionLagMonitoringJob, initialize_monitoring_job

class MarketAnalyzer:
    """Main job that orchestrates the entire analysis pipeline"""

    def __init__(self):
        # ... existing initialization ...
        
        # Initialize monitoring job
        self.monitoring_job = initialize_monitoring_job()

class Scheduler:
    def __init__(self):
        self.scheduler = BackgroundScheduler()
        self.market_analyzer = MarketAnalyzer()
        
        # Existing jobs...
        
        # Add monitoring job - runs every 5 minutes
        self.scheduler.add_job(
            self.market_analyzer.monitoring_job.run,
            IntervalTrigger(minutes=5),
            id='ingestion_lag_monitoring',
            name='Ingestion Lag Monitoring',
            misfire_grace_time=60
        )
        
    def start(self):
        self.scheduler.start()
```

## 3. Hook Failures from Fetchers

Update each fetcher to report failures:

### `src/ingestion/stellar_fetcher.py`

```python
from src.metrics.ingestion_monitoring import record_fetcher_failure

class StellarDataFetcher:
    def get_network_stats(self):
        try:
            # existing code...
            return stats
        except ConnectionError as e:
            record_fetcher_failure('stellar_fetcher', 'connection_error', str(e))
            raise
        except TimeoutError as e:
            record_fetcher_failure('stellar_fetcher', 'timeout', str(e))
            raise
```

### `src/ingestion/news_fetcher.py`

```python
from src.metrics.ingestion_monitoring import record_fetcher_failure

class NewsFetcher:
    def fetch_all_news(self):
        try:
            # existing code...
            return news_items
        except requests.exceptions.Timeout as e:
            record_fetcher_failure('news_fetcher', 'timeout', str(e))
            raise
        except requests.exceptions.ConnectionError as e:
            record_fetcher_failure('news_fetcher', 'connection_error', str(e))
            raise
        except Exception as e:
            record_fetcher_failure('news_fetcher', 'api_error', str(e))
            raise
```

### `src/ingestion/social_fetcher.py`

```python
from src.metrics.ingestion_monitoring import record_fetcher_failure

class SocialFetcher:
    def fetch_posts(self):
        try:
            # existing code...
            return posts
        except requests.exceptions.Timeout as e:
            record_fetcher_failure('social_fetcher', 'timeout', str(e))
            raise
        except requests.exceptions.ConnectionError as e:
            record_fetcher_failure('social_fetcher', 'connection_error', str(e))
            raise
```

### `src/ingestion/price_fetcher.py`

```python
from src.metrics.ingestion_monitoring import record_fetcher_failure

class PriceFetcher:
    def fetch_prices(self):
        try:
            # existing code...
            return prices
        except Exception as e:
            record_fetcher_failure('price_fetcher', 'api_error', str(e))
            raise
```

## 4. API Endpoint for Health Status

Add to `src/api/routes.py`:

```python
from fastapi import APIRouter, HTTPException
from src.metrics.ingestion_monitoring import get_monitoring_job

router = APIRouter()

@router.get("/health/ingestion")
def get_ingestion_health():
    """Get ingestion pipeline health status."""
    job = get_monitoring_job()
    if job is None:
        raise HTTPException(status_code=503, detail="Monitoring job not initialized")
    
    status = job.get_health_status()
    return status

@router.get("/metrics/lag")
def get_lag_metrics():
    """Get current lag metrics."""
    job = get_monitoring_job()
    if job is None:
        raise HTTPException(status_code=503, detail="Monitoring job not initialized")
    
    return job.lag_monitor.get_summary()

@router.get("/alerts")
def get_active_alerts():
    """Get active alerts."""
    job = get_monitoring_job()
    if job is None:
        raise HTTPException(status_code=503, detail="Monitoring job not initialized")
    
    alerts = job.alert_engine.get_active_alerts()
    return {"alerts": [a.to_dict() for a in alerts]}
```

## 5. Log Configuration

Add to `logging.conf` or configure in code:

```python
import logging
import logging.config

LOGGING_CONFIG = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'standard': {
            'format': '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        },
        'json': {
            'format': '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        }
    },
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'level': 'INFO',
            'formatter': 'standard',
        },
        'alerts': {
            'class': 'logging.handlers.RotatingFileHandler',
            'level': 'WARNING',
            'formatter': 'standard',
            'filename': 'logs/alerts.log',
            'maxBytes': 10485760,  # 10MB
            'backupCount': 10,
        },
    },
    'loggers': {
        'lumenpulse.alerts': {
            'level': 'INFO',
            'handlers': ['console', 'alerts'],
        },
        'src.metrics': {
            'level': 'INFO',
            'handlers': ['console'],
        }
    }
}

logging.config.dictConfig(LOGGING_CONFIG)
```

## 6. Testing the Integration

### Test 1: Run monitoring job directly

```bash
python -c "from src.metrics.ingestion_monitoring import IngestionLagMonitoringJob; job = IngestionLagMonitoringJob(); job.run()"
```

### Test 2: Check logs for alerts

```bash
tail -f logs/alerts.log
```

### Test 3: Check API health endpoint

```bash
curl http://localhost:8000/health/ingestion
```

### Test 4: Run full test suite

```bash
pytest tests/test_metrics_alerting.py -v
```

## 7. Customizing Alert Rules

### Modify thresholds

```python
from src.metrics.alerting_rules import IndexerLagCriticalRule

# Create custom rule with different thresholds
rule = IndexerLagCriticalRule(threshold_seconds=900)  # 15 minutes instead of 10
```

### Add custom rule

```python
from src.metrics.alerting_rules import AlertRule, Alert, AlertSeverity

class CustomRule(AlertRule):
    def __init__(self):
        super().__init__(
            rule_name="my_custom_rule",
            description="My custom monitoring rule",
            severity=AlertSeverity.WARNING,
            remediation_steps=["Step 1", "Step 2"]
        )
    
    def evaluate(self, metrics):
        # Custom logic here
        if some_condition:
            return Alert(
                alert_id="my_alert_1",
                severity=self.severity,
                title="My Alert",
                message="Something happened",
                rule_name=self.rule_name,
                source="custom",
                timestamp=datetime.now(timezone.utc),
                metric_data={},
                remediation_steps=self.remediation_steps
            )
        return None

# Add to engine
from src.metrics.ingestion_monitoring import get_monitoring_job
job = get_monitoring_job()
job.alert_engine.add_rule(CustomRule())
```

## 8. Deployment

### Docker

Add to `Dockerfile`:

```dockerfile
# ... existing config ...

# Install monitoring dependencies
RUN pip install apscheduler

# Copy monitoring files
COPY src/metrics /app/src/metrics/

# Monitoring runs as part of scheduler
CMD ["python", "src/main.py"]
```

### Docker Compose

```yaml
services:
  data-processing:
    build: ./apps/data-processing
    environment:
      DATABASE_URL: postgres://user:pass@db:5432/lumenpulse
      TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN}
      TELEGRAM_CHANNEL_ID: ${TELEGRAM_CHANNEL_ID}
    depends_on:
      - db
```

## 9. Monitoring Dashboard

Create a simple dashboard to monitor system health:

```python
# dashboard.py
from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from src.metrics.ingestion_monitoring import get_monitoring_job

app = FastAPI()

@app.get("/dashboard", response_class=HTMLResponse)
def get_dashboard():
    job = get_monitoring_job()
    status = job.get_health_status() if job else {}
    
    # Build HTML dashboard
    html = f"""
    <html>
    <head>
        <title>Indexer Lag Dashboard</title>
        <style>
            body {{ font-family: Arial; margin: 20px; }}
            .healthy {{ color: green; }}
            .warning {{ color: orange; }}
            .critical {{ color: red; }}
        </style>
    </head>
    <body>
        <h1>Indexer Lag Monitor</h1>
        <p>Status: <span class="{status.get('status')}">{status.get('status')}</span></p>
        <h2>Metrics</h2>
        <ul>
    """
    
    for name, metric in status.get('metrics', {}).items():
        severity = metric['severity']
        html += f"<li class='{severity}'>{name}: {metric['lag_seconds']:.0f}s ({severity})</li>"
    
    html += """
        </ul>
        <h2>Active Alerts</h2>
        <ul>
    """
    
    for alert in status.get('active_alerts', []):
        html += f"<li class='{alert['severity']}'>{alert['title']}</li>"
    
    html += """
        </ul>
    </body>
    </html>
    """
    
    return html
```

## 10. Troubleshooting Integration

### Issue: Monitoring job not running

```bash
# Check scheduler is active
ps aux | grep scheduler

# Check logs for errors
tail -f logs/application.log | grep monitoring
```

### Issue: Alerts not triggering

```bash
# Verify monitoring job is initialized
python -c "from src.metrics.ingestion_monitoring import get_monitoring_job; print(get_monitoring_job())"

# Run monitoring manually
python -c "from src.metrics.ingestion_monitoring import IngestionLagMonitoringJob; IngestionLagMonitoringJob().run()"

# Check if rules are configured
python -c "from src.metrics.ingestion_monitoring import IngestionLagMonitoringJob; job = IngestionLagMonitoringJob(); print(len(job.alert_engine.rules))"
```

### Issue: Database connection errors

```bash
# Test database
psql $DATABASE_URL -c "SELECT 1"

# Check connection string
echo $DATABASE_URL

# Check PostgreSQL is running
pg_isready -h localhost
```

## References

- [ALERTING_RUNBOOK.md](./ALERTING_RUNBOOK.md) - Complete operational guide
- [src/metrics/](./src/metrics/) - Source code
- [tests/test_metrics_alerting.py](./tests/test_metrics_alerting.py) - Test suite
- [demo_indexer_lag_alerting.py](./demo_indexer_lag_alerting.py) - Demo script

## Support

For issues or questions:
1. Check the runbook and integration guide
2. Review logs in `logs/alerts.log`
3. Run tests to verify installation
4. Contact @data-ops team
