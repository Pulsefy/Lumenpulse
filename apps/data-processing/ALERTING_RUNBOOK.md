# Indexer Lag & Failed Sources Alerting Runbook

## Overview

The Lumenpulse data-processing pipeline includes comprehensive alerting for:
- **Indexer Lag Detection**: Tracks how far behind we are from the latest Stellar ledger
- **Failed Data Sources**: Monitors repeated failures from news, social, and blockchain fetchers
- **Ingestion Pipeline Health**: Detects when multiple data sources fall behind simultaneously

This document provides operational guidance for running, monitoring, and responding to alerts.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Metrics Collected](#metrics-collected)
3. [Alert Rules](#alert-rules)
4. [Configuration](#configuration)
5. [Running the Monitoring Job](#running-the-monitoring-job)
6. [Alert Response Procedures](#alert-response-procedures)
7. [Troubleshooting](#troubleshooting)
8. [Testing](#testing)

---

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────────┐
│         Data Sources (Fetchers)                             │
│  ├─ Stellar Network (Horizon API)                           │
│  ├─ News API                                                │
│  ├─ Social Media APIs (Twitter, Reddit)                     │
│  └─ Price Data APIs                                         │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│    Ingestion Pipeline                                       │
│  ├─ stellar_fetcher.py (collects on-chain data)             │
│  ├─ news_fetcher.py                                         │
│  ├─ social_fetcher.py                                       │
│  └─ price_fetcher.py                                        │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│    Database (PostgreSQL)                                    │
│  ├─ analytics_records (metrics)                             │
│  ├─ articles (news)                                         │
│  ├─ social_posts                                            │
│  └─ contract_events (on-chain)                              │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│    Monitoring Job (ingestion_monitoring.py)                 │
│  ├─ Collects lag metrics                                    │
│  ├─ Tracks source failures                                  │
│  └─ Evaluates alerting rules                                │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│    Alert Dispatch                                           │
│  ├─ Log Handler (structured logs) ✓ MVP                     │
│  ├─ Telegram Handler (if configured)                        │
│  └─ Webhook Handler (if configured)                         │
└─────────────────────────────────────────────────────────────┘
```

### Key Files

- **`src/metrics/indexer_lag.py`**: Collects lag metrics from multiple sources
- **`src/metrics/alerting_rules.py`**: Defines alert rules and evaluation logic
- **`src/metrics/ingestion_monitoring.py`**: Main monitoring job orchestrator
- **`src/metrics/__init__.py`**: Module exports and public API

---

## Metrics Collected

The monitoring system collects the following metrics:

### 1. Stellar Ledger Lag
- **Metric Name**: `stellar_ledger_lag`
- **Definition**: Time (seconds) since the latest Stellar ledger closed
- **Source**: Horizon API (`get_network_stats()`)
- **Thresholds**:
  - ⚠️ WARNING: 60 seconds (1 minute)
  - 🚨 CRITICAL: 300 seconds (5 minutes)
- **Typical Cause**: Network delay, Horizon API issues, local system clock skew

### 2. Table Ingestion Lag
- **Tables Monitored**:
  - `articles` (news articles)
  - `social_posts` (social media posts)
  - `analytics_records` (computed metrics)
  - `contract_events` (on-chain events)

- **For each table**:
  - **Metric Name**: `{table_name}_ingestion_lag`
  - **Definition**: Time (seconds) since newest record in table
  - **Thresholds**:
    - Articles/Social: 30 min warning, 1 hour critical
    - Analytics: 10 min warning, 30 min critical
    - Contract Events: 5 min warning, 15 min critical

### 3. Data Source Failures
- **Tracked Failures**:
  - `connection_error`: Cannot connect to API
  - `timeout`: Request timeout
  - `auth_error`: Authentication/authorization failed
  - `rate_limited`: API rate limit exceeded
  - `empty_response`: API returned no data
  - `parse_error`: Response parsing failed
  - `database_error`: Database operation failed

- **Failure Tracking**:
  - Counts failures within a time window
  - Maintains consecutive failure count per source
  - Triggers alert after 3+ failures in 5 minutes

---

## Alert Rules

### Rule 1: Indexer Lag - CRITICAL

**Trigger Condition**: Stellar ledger lag > 600 seconds (10 minutes)

**Alert Title**: 🚨 CRITICAL: Indexer Lag Detected

**Alert Message**:
```
Stellar ledger ingestion lag has reached {lag_seconds} seconds.
The ingestion process is significantly behind the latest ledger close time.
```

**Severity**: CRITICAL

**Remediation Steps**:
1. Check Stellar Horizon connectivity (ping horizon.stellar.org)
2. Verify ingestion process is running (`ps aux | grep ingestion`)
3. Review ingestion logs for errors
4. Check database connection and performance
5. Restart ingestion process if needed

---

### Rule 2: Indexer Lag - WARNING

**Trigger Condition**: Stellar ledger lag > 120 seconds (2 minutes)

**Alert Title**: ⚠️ WARNING: Elevated Indexer Lag

**Alert Message**:
```
Stellar ledger ingestion lag is at {lag_seconds} seconds.
Performance is degraded but stable.
```

**Severity**: WARNING

**Remediation Steps**:
1. Monitor Stellar Horizon latency
2. Check ingestion process health
3. Review recent database operations
4. Consider horizontal scaling if persistent

---

### Rule 3: Data Source Failure

**Trigger Condition**: Same source fails 3+ times in 5 minutes

**Alert Title**: ⚠️ WARNING: {source_name} Failing

**Alert Message**:
```
Data source '{source_name}' has failed {failure_count} times in the last 5 minutes.
Latest failure: {failure_type} - {error_message}
```

**Severity**: WARNING

**Remediation Steps**:
1. Check data source API status (status page or ping)
2. Verify authentication credentials are valid
3. Check rate limiting status
4. Review network connectivity
5. Check firewall/proxy rules

**Example**: If `news_fetcher` fails 3 times:
```
⚠️ WARNING: news_fetcher Failing
Data source 'news_fetcher' has failed 3 times in the last 5 minutes.
Latest failure: timeout - Request exceeded 30s timeout connecting to newsapi.org
```

---

### Rule 4: Ingestion Pipeline Falling Behind

**Trigger Condition**: 2+ tables with stale data (>1 hour old)

**Alert Title**: 🚨 CRITICAL: Ingestion Pipeline Falling Behind

**Alert Message**:
```
Multiple data sources are significantly stale ({count} sources).
Stale sources: {list}.
Investigate ingestion pipeline performance immediately.
```

**Severity**: CRITICAL

**Remediation Steps**:
1. Check ingestion pipeline status
2. Verify all data sources are accessible
3. Review ingestion process logs
4. Check database performance and disk space
5. Restart ingestion pipeline if necessary
6. Escalate if issue persists after restart

---

## Configuration

### Environment Variables

```bash
# Database Connection
export DATABASE_URL="postgresql://user:password@localhost:5432/lumenpulse"

# Telegram Alerts (optional)
export TELEGRAM_BOT_TOKEN="YOUR_BOT_TOKEN"
export TELEGRAM_CHANNEL_ID="YOUR_CHANNEL_ID"

# Webhook Alerts (optional)
export ALERT_WEBHOOK_URLS="https://example.com/alerts,https://other.com/alerts"

# Monitoring Configuration (optional)
export MONITORING_INTERVAL_SECONDS="300"  # Run every 5 minutes
```

### Log Configuration

The monitoring system uses structured logging. Configure in `logging.conf` or `pyproject.toml`:

```python
import logging

# Get the alert logger
alert_logger = logging.getLogger("lumenpulse.alerts")
handler = logging.FileHandler("logs/alerts.log")
handler.setLevel(logging.WARNING)
formatter = logging.Formatter(
    '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
handler.setFormatter(formatter)
alert_logger.addHandler(handler)
```

---

## Running the Monitoring Job

### Option 1: Standalone Execution

```python
from src.metrics.ingestion_monitoring import IngestionLagMonitoringJob

# Initialize and run
job = IngestionLagMonitoringJob()
job.run()
```

### Option 2: Integrated with Scheduler

Update `src/scheduler.py`:

```python
from apscheduler.triggers.interval import IntervalTrigger
from src.metrics.ingestion_monitoring import IngestionLagMonitoringJob, initialize_monitoring_job

class Scheduler:
    def __init__(self):
        self.scheduler = BackgroundScheduler()
        
        # Initialize monitoring job
        self.monitoring_job = initialize_monitoring_job()
        
        # Schedule monitoring job every 5 minutes
        self.scheduler.add_job(
            self.monitoring_job.run,
            IntervalTrigger(minutes=5),
            id='ingestion_lag_monitoring',
            name='Ingestion Lag Monitoring'
        )
        
    def start(self):
        self.scheduler.start()
```

### Option 3: CLI Command

```bash
# Run monitoring job once
python -m src.metrics.ingestion_monitoring

# Run continuously every 5 minutes
while true; do
    python -m src.metrics.ingestion_monitoring
    sleep 300
done
```

### Option 4: Docker Container

Create `Dockerfile.monitoring`:

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .

CMD ["python", "-c", "from src.metrics.ingestion_monitoring import IngestionLagMonitoringJob; job = IngestionLagMonitoringJob(); job.run()"]
```

Run with:

```bash
docker build -f Dockerfile.monitoring -t lumenpulse-monitoring .
docker run -e DATABASE_URL="..." lumenpulse-monitoring
```

---

## Alert Response Procedures

### When You Receive an Alert

#### 1. Read the Alert

- Note the **severity** (INFO, WARNING, CRITICAL)
- Understand the **metric** (which lag or failure)
- Note the **timestamp**
- Review **remediation steps**

#### 2. Investigate

```bash
# Check if monitoring job is running
ps aux | grep -i monitoring
ps aux | grep -i scheduler

# Check ingestion process
ps aux | grep -i fetcher
ps aux | grep -i ingestion

# Check database connection
psql postgresql://user:password@localhost:5432/lumenpulse -c "SELECT COUNT(*) FROM articles;"

# Check recent logs
tail -f logs/alerts.log
tail -f logs/application.log
tail -f logs/ingestion.log
```

#### 3. Determine Root Cause

**For Stellar Ledger Lag**:
- Check Horizon API: `curl https://horizon.stellar.org/`
- Check network connectivity: `ping horizon.stellar.org`
- Check system clock: `date` (ensure synced)
- Check ingestion process logs: `grep ERROR logs/ingestion.log`

**For Article/Social Post Lag**:
- Check news API status
- Check rate limiting: `grep rate_limit logs/ingestion.log`
- Verify authentication: Check API keys in `.env`

**For Failed Data Source**:
- Identify which source is failing from alert message
- Check if source is temporarily down
- Verify credentials are still valid
- Check for API changes or deprecations

#### 4. Take Action

**Immediate Actions**:
- Investigate root cause
- Document findings
- Notify relevant teams

**Short-term Actions**:
- Restart affected component if safe
- Increase monitoring frequency
- Enable verbose logging

**Long-term Actions**:
- Fix underlying issue
- Add circuit breakers for failing sources
- Improve error handling
- Add redundancy

---

## Troubleshooting

### Issue: Alerts Not Being Received

**Symptoms**: Metrics show problems but no alerts sent

**Diagnosis**:
```python
from src.metrics.ingestion_monitoring import get_monitoring_job

job = get_monitoring_job()
if job is None:
    print("Monitoring job not initialized!")
else:
    # Check alert handlers
    print(f"Alert handlers: {len(job.alert_engine.alert_handlers)}")
    
    # Check active alerts
    alerts = job.alert_engine.get_active_alerts()
    print(f"Active alerts: {len(alerts)}")
```

**Solutions**:
- Verify monitoring job is running: `ps aux | grep monitoring`
- Check alert logger configuration
- Verify Telegram/Webhook credentials are set
- Enable debug logging: `logging.getLogger("lumenpulse").setLevel(logging.DEBUG)`

### Issue: False Positive Alerts

**Symptoms**: Alerts trigger when system is actually healthy

**Causes**:
- Threshold too sensitive
- Temporary network blip
- System clock out of sync

**Solutions**:
1. Adjust thresholds in `alerting_rules.py`:
   ```python
   IndexerLagCriticalRule(threshold_seconds=900)  # Increase to 15 min
   ```

2. Add cooldown logic to prevent alert storms:
   ```python
   rule.min_interval_between_alerts = timedelta(minutes=5)
   ```

3. Implement alert deduplication in handlers

### Issue: Database Connection Fails

**Symptoms**: Cannot measure ingestion lag

**Solutions**:
```bash
# Test database connection
psql $DATABASE_URL -c "SELECT 1"

# Check connection string
echo $DATABASE_URL

# Verify PostgreSQL is running
ps aux | grep postgres

# Check firewall rules
netstat -an | grep 5432
```

### Issue: Stellar Horizon Timeouts

**Symptoms**: Cannot measure Stellar ledger lag

**Solutions**:
```bash
# Test Horizon API
curl -I https://horizon.stellar.org/

# Check DNS resolution
nslookup horizon.stellar.org

# Check network connectivity
traceroute horizon.stellar.org

# Use alternate Horizon server
export STELLAR_HORIZON_URL="https://horizon-testnet.stellar.org"
```

---

## Testing

### Unit Tests

Run tests:
```bash
pytest tests/test_metrics/ -v
pytest tests/test_alerting_rules/ -v
```

Test monitoring job directly:
```python
from src.metrics.ingestion_monitoring import IngestionLagMonitoringJob
from unittest.mock import MagicMock

# Create mock database service
mock_postgres = MagicMock()
mock_postgres.get_session.return_value.__enter__.return_value.execute.return_value.fetchone.return_value = [...]

# Test job
job = IngestionLagMonitoringJob(postgres_service=mock_postgres)
job.run()
```

### Manual Testing

```bash
# 1. Start monitoring job
python -c "from src.metrics.ingestion_monitoring import IngestionLagMonitoringJob; IngestionLagMonitoringJob().run()"

# 2. Inject test failure
python -c "
from src.metrics.ingestion_monitoring import initialize_monitoring_job
job = initialize_monitoring_job()
job.record_source_failure('test_source', 'test_error', 'testing')
job.record_source_failure('test_source', 'test_error', 'testing')
job.record_source_failure('test_source', 'test_error', 'testing')
job.run()
"

# 3. Check alert logs
grep -i alert logs/alerts.log
```

### Integration Testing

```bash
# 1. Deploy to test environment
docker-compose -f docker-compose.yml up

# 2. Simulate lag by stopping fetchers
kill $(ps aux | grep fetcher | grep -v grep | awk '{print $2}')

# 3. Run monitoring job
docker exec lumenpulse-app python -m src.metrics.ingestion_monitoring

# 4. Check alerts were generated
docker logs lumenpulse-app | grep -i alert
```

---

## Monitoring Dashboard

### Accessing Metrics via API

```python
from src.metrics.ingestion_monitoring import get_monitoring_job

job = get_monitoring_job()
status = job.get_health_status()

print(f"Status: {status['status']}")
print(f"Critical Alerts: {len(status['active_alerts'])}")

for metric_name, metric_data in status['metrics'].items():
    print(f"{metric_name}: {metric_data['lag_seconds']}s ({metric_data['severity']})")
```

### Example API Endpoint

Add to `src/api/routes.py`:

```python
from fastapi import APIRouter
from src.metrics.ingestion_monitoring import get_monitoring_job

router = APIRouter()

@router.get("/health/ingestion")
def get_ingestion_health():
    job = get_monitoring_job()
    if job is None:
        return {"status": "unknown", "error": "Monitoring job not initialized"}
    return job.get_health_status()
```

---

## Performance Tuning

### Optimize Metric Collection

- Run monitoring job in separate process/thread
- Batch database queries
- Add caching layer for Horizon API calls
- Use connection pooling

### Reduce Alert Noise

- Increase thresholds for non-critical sources
- Add alert deduplication logic
- Implement alert severity grouping
- Add context-aware thresholding

### Scale Horizontally

- Run multiple monitoring instances
- Use distributed task queue (Celery, RQ)
- Implement consistent hashing for metric collection
- Add redundancy for critical alerts

---

## Support & Escalation

For issues:
1. Check this runbook
2. Review logs in `logs/alerts.log` and `logs/application.log`
3. Post diagnostics in `#data-processing` Slack channel
4. Escalate to @data-ops for infrastructure issues

---

**Last Updated**: 2024-12-19
**Version**: 1.0 (MVP)
**Maintainer**: Data Processing Team
