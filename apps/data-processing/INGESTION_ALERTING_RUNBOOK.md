# Ingestion Alerting Runbook (Issue #745)

Operational guide for indexer lag and external source failure alerts in `apps/data-processing`.

## What is monitored

| Signal | Metric | Source |
|--------|--------|--------|
| Horizon ledger freshness | `lumenpulse_indexer_lag_seconds{metric_name="stellar_ledger_lag"}` | Stellar Horizon latest ledger `closed_at` |
| Pipeline analytics freshness | `lumenpulse_indexer_lag_seconds{metric_name="pipeline_analytics_lag"}` | Latest `analytics_records.created_at` in PostgreSQL |
| External source health | `lumenpulse_source_health{source=...}` | Last fetch success (`1`) or failure (`0`) |
| Source failures | `lumenpulse_source_failures_total{source,failure_type}` | News, Horizon, price feed fetch errors |

Log alerts are emitted by logger `lumenpulse.ingestion_alerts` with prefix `INGESTION_ALERT`.

## Default thresholds

| Metric | Warning | Critical |
|--------|---------|----------|
| Stellar ledger lag | 60s | 300s |
| Pipeline analytics lag | 1h | 2h |

Override with environment variables:

- `STELLAR_LEDGER_LAG_WARNING_SECONDS`
- `STELLAR_LEDGER_LAG_CRITICAL_SECONDS`
- `PIPELINE_ANALYTICS_LAG_WARNING_SECONDS`
- `PIPELINE_ANALYTICS_LAG_CRITICAL_SECONDS`
- `INGESTION_ALERT_INTERVAL_MINUTES` (scheduler cadence, default `5`)

## How checks run

1. **Scheduler** — job `ingestion_lag_alerting` every 5 minutes (`src/scheduler.py`).
2. **Pipeline** — after each successful `run_data_pipeline()` run (`src/main.py`).
3. **API** — manual trigger:
   - `POST /ingestion/alerting/run`
   - `GET /ingestion/alerting/status`

## Verify locally

```bash
cd apps/data-processing
python -c "from src.ingestion.ingestion_alerting import run_ingestion_alerting_cycle; print(run_ingestion_alerting_cycle())"
```

Watch logs for `INGESTION_ALERT` or `INGESTION_METRIC` entries:

```bash
grep INGESTION_ALERT logs/data_processor.log
```

Prometheus metrics are exposed on the data-processing metrics port (default `9090`) when the metrics server is started.

## Alert: Stellar ledger lag (warning/critical)

**Symptoms**

- Log: `Indexer lag alert: stellar_ledger_lag`
- Metric `lumenpulse_indexer_lag_seconds` above threshold

**Remediation**

1. Confirm Horizon connectivity for the configured network (`STELLAR_NETWORK`).
2. Check RPC/Horizon provider health (see RPC benchmark job logs).
3. Ensure ingestion workers and scheduler are running.
4. Re-run `POST /ingestion/alerting/run` after recovery.

## Alert: Pipeline analytics lag

**Symptoms**

- Log: `Indexer lag alert: pipeline_analytics_lag`
- No recent rows in `analytics_records`

**Remediation**

1. Confirm PostgreSQL is reachable (`DATABASE_URL`).
2. Verify scheduler job `market_analyzer_hourly` is executing.
3. Inspect pipeline logs for fetch or persistence errors.
4. Manually run the pipeline once to backfill analytics.

## Alert: External source failure

**Symptoms**

- Log: `External source failure: <source>`
- `lumenpulse_source_failures_total` increasing
- `lumenpulse_source_health{source="..."} == 0`

**Sources**

- `news` — CryptoCompare / NewsAPI
- `stellar_horizon` — Horizon ledger and volume fetches
- `price_feed` — asset price provider

**Remediation**

1. Validate API keys (`CRYPTOCOMPARE_API_KEY`, `NEWSAPI_API_KEY`) and network egress.
2. Check upstream rate limits or outages.
3. Retry with `python src/main.py` or wait for the next scheduled pipeline run.
4. Confirm `lumenpulse_source_health` returns to `1` after a successful fetch.

## Escalation

If lag remains critical for more than 15 minutes after remediation:

1. Page on-call via existing webhook/Telegram alert channels (`ALERT_WEBHOOK_URL`, `TELEGRAM_BOT_TOKEN`).
2. Capture the latest `/ingestion/alerting/status` JSON and attach to the incident ticket.
3. Coordinate with backend team if Soroban indexer cursor lag is suspected (see `apps/backend/src/soroban-events/`).
