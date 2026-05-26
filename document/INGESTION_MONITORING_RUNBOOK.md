# Ingestion Monitoring Runbook (Lag + External Source Failures)

## Scope
Covers two MVP monitoring signals:
1. **Stellar ingestion falling behind** (lag)
2. **External news source failures** (fetch errors)

Acceptance criteria mapped:
- **Lag metrics produced** ✅
- **Alerts configured** ✅ (log-based acceptable for MVP, but Prometheus-backed metrics are added)
- **Runbook documented** ✅

---

## 1) Stellar ingestion lag detection
### What the metric means
`ingestion_lag_seconds{asset="<ASSET>",network="<NETWORK>"}`

- Computed by `apps/data-processing/src/ingestion/stellar_ingestion_checks.py`.
- Uses **Horizon latest ledger `closed_at` freshness** as a heuristic.
- If Horizon reports that the latest ledger close is older than the configured threshold, we mark ingestion as stale.

### Where the data comes from
- Horizon: `get_network_stats()` → `ledger_close_time` / `closed_at`.
- Data-processing runs the checks hourly via:
  - scheduler job id: `stellar_ingestion_quality_checks_hourly`
  - API manual trigger: `POST /ingestion/quality/run` (FastAPI)

### Quick PromQL checks
- Current lag (testnet):
  - `ingestion_lag_seconds{network="testnet"}`

- Check pass state (1/0):
  - `ingestion_quality_check_passed{check_id="missing_ledger_ranges_or_ingestion_lag",network="testnet"}`

### Alert
Configured in `prometheus-rules.yml`:
- `IngestionLagHigh`
  - fires when `ingestion_lag_seconds{network="testnet"} > 300` for 5m

### Triage steps
1. **Verify the lag persists**
   - confirm the alert is still firing
   - check `ingestion_lag_seconds` trend
2. **Verify Horizon connectivity**
   - restart data-processing workers if needed
3. **Verify ingestion pipeline health**
   - ensure scheduler/worker is running
   - ensure the hourly job is executing
4. **Run a manual quality check**
   - `POST http://<data-processing-host>:8000/ingestion/quality/run`
   - body example:
     ```json
     {
       "network": "testnet",
       "asset": "XLM",
       "ingestion_lag_seconds": 300,
       "duplicate_window_hours": 24,
       "drift_compare_window_hours": 24,
       "drift_ratio_threshold": 0.05,
       "drift_hours": "24,48",
       "manual_run_id": "manual-2026-05-26"
     }
     ```
5. **Remediation / Recovery**
   - If Horizon is fine but lag persists, investigate the ingestion/materialization step that feeds analytics storage.
   - After fixing, re-run the quality check.

### Expected recovery
- `ingestion_lag_seconds` returns below threshold
- `ingestion_quality_check_passed{check_id="missing_ledger_ranges_or_ingestion_lag"}` returns to `1`
- Alert clears automatically after the `for` window.

---

## 2) External news source failure detection
### Metrics
Backend emits:
- `lumenpulse_fetch_errors_total{source="news_provider",error_code="UNKNOWN"}`

This is wired in `apps/backend/src/news/news.service.ts` in the scheduled news fetch job.

### PromQL checks
- Fetch error rate (last 5 minutes):
  - `increase(lumenpulse_fetch_errors_total{source="news_provider"}[5m])`

### Alert
Configured in `prometheus-rules.yml`:
- `NewsFetchFailuresHigh`
  - MVP threshold: `increase(news_fetch_errors_total[5m]) > 10`

> Note: The backend metric name is currently `lumenpulse_fetch_errors_total`.
> If your Prometheus uses strict metric naming, update the alert expression accordingly.

### Triage steps
1. **Confirm errors are coming from the provider fetch**
   - check logs from the backend news fetch cron
2. **Verify external source availability**
   - API provider status / rate limits
3. **Retry / restart backend**
   - restart backend-api if failures persist
4. **Reduce rate / change provider**
   - if this is due to throttling, lower fetch frequency or adjust provider parameters

### Recovery
- Errors stop accumulating in `lumenpulse_fetch_errors_total`
- Alert clears after its evaluation window.

---

## 3) Runbook artifacts
### JSON report output (data-processing)
Quality checks persist JSON reports to:
- `./data/ingestion_reports/stellar_ingestion_quality_<timestamp>.json`

Inspect the report for detailed findings.

### Manual trigger (data-processing)
- `POST /ingestion/quality/run`

---

## 4) Future improvements (non-blocking)
- Use an explicit ingestion cursor (instead of Horizon freshness heuristic)
- Emit richer error codes per provider
- Add Grafana dashboard panels for lag + provider failure trends

