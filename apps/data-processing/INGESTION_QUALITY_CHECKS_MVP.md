# Ingestion Quality Checks (Testnet) — MVP

This folder adds automated checks to detect ingestion gaps, duplicates, and drift so analytics/API consumers do not silently degrade.

## What was added

### 1) Automated checks

Implemented in:

- `apps/data-processing/src/ingestion/stellar_ingestion_checks.py`

Checks (low-noise + idempotent, safe to re-run):

1. **Missing ledger ranges / ingestion lag (best-effort)**
   - Uses Horizon `latest ledger closed_at` timestamp.
   - Fails only when the latest ledger close is older than a configured threshold.

2. **Duplicate events (best-effort)**
   - This repository’s current pipeline persists **aggregated** analytics records (not raw tx/event stream).
   - The check groups recent `analytics_records` by:
     `(record_type, asset, metric_name, window, timestamp bucket)`
   - If identical groups appear more than once, the check reports a warning.
   - When PostgreSQL isn’t available, the check is skipped (to avoid noise).

3. **Drift between raw events and materialized views (best-effort)**
   - “Materialized views” are approximated by persisted `analytics_records` for on-chain volume.
   - For each configured horizon (e.g. 24h, 48h):
     - fetch **raw** volume from Horizon (`get_asset_volume`)
     - compare with **stored** volume metrics
   - Reports warning-level drift when relative difference exceeds a threshold.
   - If no matching stored records exist, the check is skipped (low-noise).

### 2) Scheduled + manual execution

- Scheduled hourly from:
  - `apps/data-processing/src/scheduler.py`
  - Job id: `stellar_ingestion_quality_checks_hourly`

- Manual run via API:
  - `apps/data-processing/src/api/ingestion_quality_routes.py`
  - Endpoint: **POST** `/ingestion/quality/run`

### 3) Report output

Each run writes a persisted JSON report:

- `./data/ingestion_reports/stellar_ingestion_quality_<timestamp>.json`

It also prints a concise summary to logs/stdout.

## How to run

### A) CLI (manual)

From the repo root:

```bash
python apps/data-processing/src/ingestion/run_ingestion_quality_checks.py --network testnet --asset XLM
```

Useful environment variables (all optional):

- `STELLAR_NETWORK` (default: `testnet`)
- `ONCHAIN_ASSET` (default: `XLM`)
- `INGESTION_LAG_SECONDS` (default: `300`)
- `DUPLICATE_WINDOW_HOURS` (default: `24`)
- `DRIFT_COMPARE_WINDOW_HOURS` (default: `24`)
- `DRIFT_RATIO_THRESHOLD` (default: `0.05`)
- `DRIFT_HOURS_LIST` (default: `24,48`)

### B) API manual run

When the FastAPI server is running, call:

**POST** `/ingestion/quality/run`

Body example:

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

Response includes `summary`, `findings`, and `exit_code`.

## Remediation / Backfill guidance

### 1) If ingestion lag fails

Symptoms:

- check id: `missing_ledger_ranges_or_ingestion_lag` with `passed=false`

Actions:

1. Verify Horizon connectivity and that the ingestion workers/scheduler are running.
2. Ensure the job that produces on-chain aggregates is deployed and not stuck.
3. Re-run the quality checks after restoring ingestion.
4. If you have an ingestion cursor system later, backfill the missing ledger interval.

This MVP only has Horizon freshness as a signal (no persistent ledger cursor exists yet),
so backfilling is pipeline-specific.

### 2) If duplicates are reported

Symptoms:

- check id: `duplicate_events` with `duplicate_groups > 0`

Actions:

1. Confirm whether ingestion runs are idempotent.
2. Re-run ingestion with idempotent upserts (so re-materialization overwrites rather than appends).
3. After fixing, re-run quality checks.

Because this repo persists aggregates, duplicates refer to repeated stored analytics record groups.

### 3) If drift is reported

Symptoms:

- check id: `drift_between_raw_and_materialized_views` with drift reports per horizon.

Actions:

1. Re-run the on-chain aggregation/materialization step for the affected windows.
2. Use idempotent writes (overwrite or upsert) keyed by `(asset, metric_name, window, timestamp-bucket)`.
3. Re-run quality checks; drift should clear when stored values match fresh Horizon calculations.

## Verifying recovery

A run is considered healthy when:

- ingestion lag passes the configured threshold
- drift warnings resolve for configured horizons

To verify:

1. Run quality checks again (CLI or API)
2. Confirm the latest JSON report shows `summary.passed=true`

## Notes / Testnet focus

- The checks default to `network=testnet` and only use Horizon testnet/mainnet endpoints as supported by the existing fetcher.
- No mainnet-only assumptions are made.
