# LumenPulse ETL & Data Pipeline Runbook

## Overview
This runbook describes the Extract, Transform, Load (ETL) jobs that power LumenPulse's data layer, including market analytics, Soroban event ingestion, and portfolio reconciliation. It is designed for contributors joining the data layer to quickly understand job dependencies, inputs, outputs, and how to recover from failures.

## Core ETL Jobs

### 1. Market Analyzer Pipeline (Data Processing)
- **Schedule:** Hourly (via APScheduler in `apps/data-processing/src/scheduler.py`)
- **Description:** Orchestrates the fetching of news, sentiment analysis, stellar on-chain volume, and market anomaly detection.
- **Inputs:** 
  - News APIs (CoinGecko, CryptoCompare, NewsAPI)
  - Social Media (Twitter/X)
  - Stellar Horizon API (XLM Volume, network stats)
  - Price Feeds
- **Outputs:** 
  - PostgreSQL (`news_insights` and `asset_trends` tables)
  - Telegram Alerts (if anomalies are detected)
- **Dependencies:** PostgreSQL, External APIs
- **Recovery & Replay:** 
  - **Manual Run:** Run the pipeline immediately via CLI:
    ```bash
    python apps/data-processing/src/main.py run
    ```
  - **Historical Backfill:** Use the backfill script to populate missing historical data.
    ```bash
    cd apps/data-processing
    python scripts/backfill.py --days 7
    ```

### 2. Model Retraining (Data Processing)
- **Schedule:** Daily at 02:00 UTC
- **Description:** Automates the retraining of ML models (e.g., sentiment forecaster) based on recent data points.
- **Inputs:** Historical analytics from PostgreSQL
- **Outputs:** Updated model weights (`.pkl` files or model registry)
- **Recovery & Replay:** Can be triggered manually via API or by invoking `trigger_retraining(force=True)` on the scheduler.

### 3. Soroban Event Indexer (Backend)
- **Schedule:** Every 30 seconds (`apps/backend/src/soroban-events/soroban-event-indexer.service.ts`)
- **Description:** Incremental sync that fetches Soroban smart contract events from the testnet indexer.
- **Inputs:** Soroban RPC (`getEvents`)
- **Outputs:** `soroban_events` table (PostgreSQL), `ProjectRegistry` state sync
- **Dependencies:** Soroban RPC, Postgres
- **Recovery & Replay:** 
  - The indexer uses a cursor (`GLOBAL_CURSOR_KEY` in the `soroban_indexer_cursor` table) to resume automatically from the last successful ledger.
  - **Historical Backfill:** Use the provided python script if a massive replay is needed, or the backend service's `backfill(fromLedger)` method.
    ```bash
    python apps/data-processing/scripts/backfill_contract_events.py --contract-ids <ID> --start-ledger <START> --end-ledger <END>
    ```

### 4. Stellar Ledger Sync (Backend)
- **Schedule:** Continuous via BullMQ (`stellar-sync` queue)
- **Description:** Processes raw Stellar ledgers for history and indexing.
- **Inputs:** Stellar Horizon API (`/ledgers`)
- **Outputs:** `StellarProcessedEvent` and `StellarSyncCheckpoint` records.
- **Recovery & Replay:** 
  - BullMQ automatically retries failed jobs.
  - Uses `StellarSyncCheckpoint` to resume from the last processed cursor. If corrupted, resetting the cursor in the DB to an older paging token will force replay.

### 5. Portfolio Reconciliation (Backend)
- **Schedule:** Every 6 hours
- **Description:** Compares stored portfolio assets against live Horizon balances, logging drift, and repairing inconsistencies.
- **Inputs:** Horizon API (`/accounts/{publicKey}`), `portfolio_assets` DB table
- **Outputs:** Updates `portfolio_assets` to match upstream balances, creates `ReconciliationJob` audit logs.
- **Recovery & Replay:** 
  - Safe to run manually or repeatedly as it is completely idempotent.
  - Will automatically heal `portfolio_assets` on the next run.

## Failure Scenarios & Standard Operating Procedures

### Scenario A: Postgres Database Connection Lost
- **Impact:** Analytics saving fails, Indexer crashes, Reconciliation fails.
- **Resolution:**
  1. Restore DB connectivity.
  2. The Backend services (NestJS) will reconnect automatically. BullMQ will retry queued jobs.
  3. The Soroban indexer will resume from its last cursor.
  4. Run the Data Processing historical backfill script (`backfill.py`) to cover the downtime window for market analytics.

### Scenario B: Soroban RPC Rate Limiting or Downtime
- **Impact:** `soroban-event-indexer` pauses and `jobHistory` records failure.
- **Resolution:**
  1. The indexer will automatically pick up from the last successful ledger (`GLOBAL_CURSOR_KEY`) once RPC is restored.
  2. No manual replay required unless the RPC node was replaced and history was lost.

### Scenario C: Market Analyzer Failure / Data Gap
- **Impact:** Missing charts/analytics for a period.
- **Resolution:**
  1. Identify failed runs in `apps/data-processing/logs/data_processor.log`.
  2. Run the backfill script:
     ```bash
     cd apps/data-processing
     python scripts/backfill.py --days <N>
     ```
  3. Validate using the dry-run flag first: `python scripts/backfill.py --days 1 --dry-run`

## Troubleshooting Commands

**Check Backend Logs (Indexer, Reconciliation):**
```bash
docker logs lumenpulse-backend -f | grep -i "soroban-event-indexer\|reconciliation"
```

**Check Data Processing Logs:**
```bash
tail -f apps/data-processing/logs/data_processor.log
```

**Check Database Locks:**
Job locking uses PostgreSQL advisory locks to prevent concurrent runs. If a job is stuck, check locks:
```sql
SELECT * FROM pg_locks WHERE locktype = 'advisory';
```
