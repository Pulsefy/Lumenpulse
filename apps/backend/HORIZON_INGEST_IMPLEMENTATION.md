# Horizon Ingest Implementation Summary

## Goal
Ingest account operations from testnet Horizon for dashboards and activity feeds.

## Acceptance Criteria
✅ **Backfill + incremental** — First run starts from the beginning, subsequent runs resume from checkpoint  
✅ **Dedup keyed by op id** — `operationId` unique constraint prevents duplicates  
✅ **Respects rate limits** — Configurable inter-page delay + exponential backoff

## Implementation

### Files Created

**Entities:**
- `src/horizon-ingest/entities/account-operation.entity.ts` — stores ingested operations
- `src/horizon-ingest/entities/horizon-ingest-checkpoint.entity.ts` — tracks last cursor per account

**Core Logic:**
- `src/horizon-ingest/horizon-ingest.processor.ts` — BullMQ worker, pages through Horizon operations
- `src/horizon-ingest/horizon-ingest.service.ts` — cron scheduler + query API
- `src/horizon-ingest/horizon-ingest.controller.ts` — REST endpoints

**Configuration:**
- `src/horizon-ingest/config/horizon-ingest.config.ts` — env var parsing
- `src/horizon-ingest/dto/operation-query.dto.ts` — query validation

**Infrastructure:**
- `src/horizon-ingest/horizon-ingest.module.ts` — NestJS module wiring
- `src/database/migrations/1771100000000-CreateHorizonIngest.ts` — database schema

**Documentation:**
- `src/horizon-ingest/README.md` — comprehensive usage guide

**Integration:**
- Updated `src/app.module.ts` — registered `HorizonIngestModule`
- Updated `.env.example` — added new env vars

### Environment Variables

```bash
# Comma-separated list of Stellar account public keys to watch
HORIZON_INGEST_ACCOUNTS=

# Number of operations to fetch per Horizon page (1–200, default: 200)
HORIZON_INGEST_PAGE_SIZE=200

# Milliseconds to wait between consecutive Horizon page requests (default: 200)
HORIZON_INGEST_RATE_LIMIT_DELAY_MS=200
```

### Database Schema

**`horizon_account_operations`:**
- `id` (uuid, PK)
- `operationId` (varchar, unique) — Horizon operation ID, dedup key
- `accountId` (varchar) — Stellar account public key
- `type` (varchar) — operation type (e.g., "payment")
- `pagingToken` (varchar) — Horizon paging token
- `createdAt` (timestamptz) — ledger close time
- `raw` (jsonb) — full Horizon operation record
- `ingestedAt` (timestamptz) — when we inserted this row

**Indexes:**
- `(accountId, createdAt)` — for dashboard queries
- `(type)` — for filtering by operation type

**`horizon_ingest_checkpoints`:**
- `id` (uuid, PK)
- `accountId` (varchar, unique) — Stellar account public key
- `cursor` (varchar) — last ingested paging_token
- `updatedAt` (timestamptz)

### API Endpoints

**`GET /horizon-ingest/operations/:accountId`**
- Query ingested operations with pagination and filtering
- Query params: `limit`, `cursor`, `type`

**`GET /horizon-ingest/checkpoint/:accountId`**
- Get the current checkpoint (last ingested cursor)

**`POST /horizon-ingest/backfill/:accountId`**
- Trigger a full backfill from the beginning

### How It Works

1. **Cron Job** — Every minute, `HorizonIngestService.scheduleIncrementalSync()` enqueues an `ingest-account` job for each account in `HORIZON_INGEST_ACCOUNTS`

2. **BullMQ Worker** — `HorizonIngestProcessor` picks up the job and:
   - Loads the checkpoint (or starts from cursor `'0'` if none exists)
   - Pages through `server.operations().forAccount(accountId)` in ascending order
   - Waits `HORIZON_INGEST_RATE_LIMIT_DELAY_MS` between pages
   - Bulk-inserts operations with `INSERT ... ON CONFLICT (operationId) DO NOTHING`
   - Updates the checkpoint after every page
   - Stops when no more operations are available

3. **Deduplication** — The unique constraint on `operationId` ensures duplicates are silently skipped, making ingestion idempotent

4. **Rate Limiting** — Configurable inter-page delay + BullMQ exponential backoff (5 attempts, starting at 2 seconds)

### Usage

1. Add account IDs to `HORIZON_INGEST_ACCOUNTS` in `.env.local`:
   ```bash
   HORIZON_INGEST_ACCOUNTS=GXXXXXXX,GYYYYYYYY
   ```

2. Run migration:
   ```bash
   npm run migration:run
   ```

3. Start the backend:
   ```bash
   npm run start:dev
   ```

4. Query operations:
   ```bash
   curl http://localhost:3000/horizon-ingest/operations/GXXXXXXX?limit=20
   ```

5. Trigger manual backfill:
   ```bash
   curl -X POST http://localhost:3000/horizon-ingest/backfill/GXXXXXXX
   ```

### Design Decisions

**Why BullMQ instead of direct cron?**
- Retry logic with exponential backoff
- Job persistence across restarts
- Monitoring via BullMQ dashboard
- Prevents duplicate jobs from stacking up (deterministic jobId)

**Why cursor-based pagination instead of polling latest?**
- Guarantees no missed operations
- Supports backfill from any point in history
- Crash-safe — resume from last checkpoint

**Why store the full `raw` operation?**
- Flexibility — dashboards can extract any field without schema changes
- Audit trail — preserves the exact Horizon response
- Future-proof — new Horizon fields are automatically captured

**Why `ON CONFLICT DO NOTHING` instead of checking existence first?**
- Atomic — no race conditions
- Faster — single query instead of SELECT + INSERT
- Idempotent — safe to re-run backfills

### Testing Checklist

- [ ] Run migration and verify tables are created
- [ ] Configure `HORIZON_INGEST_ACCOUNTS` with a testnet account
- [ ] Start backend and verify cron job enqueues jobs every minute
- [ ] Verify operations are ingested and checkpoint is updated
- [ ] Query operations via REST endpoint
- [ ] Trigger manual backfill and verify it starts from cursor `'0'`
- [ ] Verify duplicate operations are skipped (check logs for `skipped=X`)
- [ ] Verify rate limiting (check logs for inter-page delays)
- [ ] Verify crash recovery (kill process mid-ingestion, restart, verify resume from checkpoint)

### Monitoring

- **Logs**: `Page X: inserted=Y skipped=Z cursor=...` after every page
- **BullMQ Dashboard**: Job status, retries, failures
- **Database**: Query `horizon_ingest_checkpoints` to see last cursor per account
- **Metrics**: Track `totalInserted`, `totalSkipped`, `pagesFetched` per job

### Next Steps

- Add WebSocket support for real-time operation push
- Add aggregation endpoints (daily counts by type)
- Add filtering by date range, asset, transaction hash
- Add support for watching specific operation types only
