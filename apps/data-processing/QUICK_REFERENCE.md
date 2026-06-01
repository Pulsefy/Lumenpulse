# Quick Reference: Indexer Lag & Failed Sources Alerting

## 📋 What's New

Added comprehensive alerting system to detect:
- **Indexer Lag**: When ingestion falls behind the latest Stellar ledger
- **Source Failures**: When data sources (news, social, blockchain) fail repeatedly
- **Pipeline Issues**: When multiple data sources stall simultaneously

---

## 📁 New Files

### Core Implementation
| File | Lines | Purpose |
|------|-------|---------|
| `src/metrics/indexer_lag.py` | 407 | Collect and track lag metrics |
| `src/metrics/alerting_rules.py` | 407 | Define and evaluate alert rules |
| `src/metrics/ingestion_monitoring.py` | 270 | Orchestrate monitoring job |
| `src/metrics/__init__.py` | 50 | Module exports |

### Testing & Demo
| File | Lines | Purpose |
|------|-------|---------|
| `tests/test_metrics_alerting.py` | 380 | Unit tests (30+ cases) |
| `demo_indexer_lag_alerting.py` | 320 | Interactive demo (6 scenarios) |

### Documentation
| File | Pages | Purpose |
|------|-------|---------|
| `ALERTING_RUNBOOK.md` | 40+ | Complete operations guide |
| `ALERTING_INTEGRATION_GUIDE.md` | 15+ | Integration instructions |
| `IMPLEMENTATION_SUMMARY.md` | 10+ | What was delivered |

---

## 🚀 Quick Start

### 1. Verify Installation
```bash
# Run tests
pytest tests/test_metrics_alerting.py -v

# Run demo
python demo_indexer_lag_alerting.py
```

### 2. Integrate with Scheduler
Update `src/scheduler.py`:
```python
from src.metrics.ingestion_monitoring import initialize_monitoring_job

# In Scheduler.__init__():
self.monitoring_job = initialize_monitoring_job()
self.scheduler.add_job(
    self.monitoring_job.run,
    IntervalTrigger(minutes=5),
    id='ingestion_lag_monitoring'
)
```

### 3. Add Fetcher Failure Hooks
In each fetcher (stellar_fetcher.py, news_fetcher.py, etc.):
```python
from src.metrics.ingestion_monitoring import record_fetcher_failure

try:
    # existing code
except Exception as e:
    record_fetcher_failure('source_name', 'error_type', str(e))
```

### 4. Set Environment Variables
```bash
export DATABASE_URL="postgresql://..."

# Optional (Telegram alerts)
export TELEGRAM_BOT_TOKEN="..."
export TELEGRAM_CHANNEL_ID="..."
```

---

## 📊 Metrics Collected

### Stellar Network
- **Metric**: `stellar_ledger_lag`
- **Thresholds**: ⚠️ 60s (warning) → 🚨 300s (critical)
- **Source**: Horizon API

### Data Sources (per table)
| Table | Warning | Critical |
|-------|---------|----------|
| articles | 1 hour | 2 hours |
| social_posts | 30 min | 1 hour |
| analytics_records | 10 min | 30 min |
| contract_events | 5 min | 15 min |

### Source Failures
- **Trigger**: 3+ failures in 5 minutes
- **Failure Types**: timeout, connection_error, auth_error, rate_limited, etc.

---

## 🚨 Alert Rules

### 1. Critical Indexer Lag
```
Trigger: stellar_ledger_lag > 600 seconds (10 minutes)
Severity: CRITICAL
Title: 🚨 CRITICAL: Indexer Lag Detected
```

### 2. Warning Indexer Lag
```
Trigger: stellar_ledger_lag > 120 seconds (2 minutes)
Severity: WARNING
Title: ⚠️ WARNING: Elevated Indexer Lag
```

### 3. Data Source Failure
```
Trigger: 3+ failures in 5 minutes
Severity: WARNING
Title: ⚠️ WARNING: {source_name} Failing
Example: news_fetcher, social_fetcher, stellar_fetcher, price_fetcher
```

### 4. Pipeline Falling Behind
```
Trigger: 2+ tables with data >1 hour old
Severity: CRITICAL
Title: 🚨 CRITICAL: Ingestion Pipeline Falling Behind
```

---

## 📋 Key Classes

### IndexerLagMonitor
```python
from src.metrics import IndexerLagMonitor

monitor = IndexerLagMonitor(postgres_service, stellar_fetcher)

# Measure metrics
monitor.measure_stellar_ledger_lag()
monitor.measure_ingestion_lag('articles', 'created_at')

# Track failures
monitor.record_source_failure('news_fetcher', 'timeout', 'Connection timeout')

# Get results
summary = monitor.get_summary()
critical_metrics = monitor.get_critical_metrics()
```

### AlertRulesEngine
```python
from src.metrics import AlertRulesEngine

engine = AlertRulesEngine()
engine.add_handler(log_alert_handler)  # Add logging
engine.add_handler(telegram_handler)   # Optional: Telegram

# Evaluate
alerts = engine.evaluate(metrics)
```

### IngestionLagMonitoringJob
```python
from src.metrics import initialize_monitoring_job

# Initialize (call once at startup)
job = initialize_monitoring_job()

# Run (call periodically, e.g., every 5 min)
job.run()

# Get status
status = job.get_health_status()
```

---

## 📍 Alert Flow

```
1. Data Source Error
   ↓
2. Fetcher calls record_fetcher_failure()
   ↓
3. Monitoring Job runs (every 5 min)
   ↓
4. IndexerLagMonitor collects metrics
   ↓
5. AlertRulesEngine evaluates conditions
   ↓
6. Alert triggered (if conditions met)
   ↓
7. Alert Handlers dispatch:
   ├─ Structured JSON log (logs/alerts.log)
   ├─ Telegram message (if configured)
   └─ Webhook POST (if configured)
```

---

## 🧪 Testing

### Run All Tests
```bash
pytest tests/test_metrics_alerting.py -v
```

### Run Specific Test
```bash
pytest tests/test_metrics_alerting.py::TestIndexerLagMonitor -v
pytest tests/test_metrics_alerting.py::TestAlertRules -v
```

### Run Demo
```bash
python demo_indexer_lag_alerting.py
```

### Manual Test
```bash
# Test monitoring job
python -c "from src.metrics.ingestion_monitoring import IngestionLagMonitoringJob; job = IngestionLagMonitoringJob(); job.run()"

# Check logs
tail -f logs/alerts.log
```

---

## 🔧 Configuration

### Environment Variables
```bash
# Required
DATABASE_URL=postgresql://user:pass@localhost:5432/lumenpulse

# Optional: Telegram
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
TELEGRAM_CHANNEL_ID=1234567890

# Optional: Webhooks
ALERT_WEBHOOK_URLS=https://example.com/alerts,https://other.com/alerts

# Optional: Monitoring
MONITORING_INTERVAL_MINUTES=5
```

### Customizing Thresholds
```python
from src.metrics.alerting_rules import IndexerLagCriticalRule

# Custom threshold (default 600 seconds)
rule = IndexerLagCriticalRule(threshold_seconds=900)
engine.add_rule(rule)
```

---

## 📚 Documentation

| Document | Content |
|----------|---------|
| `ALERTING_RUNBOOK.md` | Complete operations guide with procedures |
| `ALERTING_INTEGRATION_GUIDE.md` | Integration steps with code examples |
| `IMPLEMENTATION_SUMMARY.md` | Overview of what was delivered |
| `demo_indexer_lag_alerting.py` | Runnable code examples |

---

## 🐛 Troubleshooting

### Alerts Not Triggering
1. Check monitoring job is running: `ps aux | grep monitoring`
2. Verify DATABASE_URL is set: `echo $DATABASE_URL`
3. Check alert logs: `tail -f logs/alerts.log`
4. Run manually: `python -m src.metrics.ingestion_monitoring`

### Database Connection Error
1. Verify PostgreSQL is running: `pg_isready -h localhost`
2. Test connection: `psql $DATABASE_URL -c "SELECT 1"`
3. Check credentials in DATABASE_URL
4. Check firewall rules for port 5432

### No Lag Metrics
1. Verify Stellar Horizon API is accessible: `curl https://horizon.stellar.org/`
2. Check network connectivity: `ping horizon.stellar.org`
3. Verify system clock is synced: `date`
4. Check database has recent records

---

## 💡 Best Practices

1. **Run monitoring job every 5 minutes** - Balances timeliness vs overhead
2. **Monitor the monitor** - Watch logs/alerts.log for errors
3. **Adjust thresholds gradually** - Start conservative, reduce false positives
4. **Add context to failures** - Include error messages for debugging
5. **Escalate only critical** - Reserve critical alerts for immediate action
6. **Keep runbook updated** - Document any custom modifications

---

## 🔗 Related Files

- `src/scheduler.py` - Where monitoring job runs
- `src/ingestion/stellar_fetcher.py` - Stellar data source
- `src/ingestion/news_fetcher.py` - News data source
- `src/ingestion/social_fetcher.py` - Social data source
- `src/alertbot.py` - Telegram alert integration
- `src/db/models.py` - Database schema

---

## 📞 Support

**For integration help**: See `ALERTING_INTEGRATION_GUIDE.md`
**For operations**: See `ALERTING_RUNBOOK.md`
**For examples**: Run `python demo_indexer_lag_alerting.py`
**For testing**: Run `pytest tests/test_metrics_alerting.py -v`

---

## ✅ Acceptance Criteria - Status

- ✅ **Lag metrics produced**: Stellar ledger + all table lags
- ✅ **Alerts configured**: 4 rules, log-based dispatch (MVP)
- ✅ **Runbook documented**: 1000+ LOC operational guide

**Ready for production integration.**

---

Last Updated: 2024-12-19
