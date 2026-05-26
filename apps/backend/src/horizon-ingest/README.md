# Horizon Ingest Module

Ingests account operations from Stellar Horizon (testnet) for dashboards and activity feeds.

## Features

✅ **Backfill + Incremental**: Starts from the beginning (cursor `'0'`) on first run, then resumes from the last checkpoint  
✅ **Deduplication**: Keyed by `operationId` with a unique constraint — duplicate operations are silently skipped  
✅ **Rate Limiting**: Configurable inter-page delay (`HORIZON_INGEST_RATE_LIMIT_DELAY_MS`) to respect Horizon's rate limits  
✅ **Automatic Scheduling**: Cron job runs every minute to ingest new operations for all watched accounts  
✅ **Manual Backfill**: REST endpoint to trigger a full backfill for any account  
✅ **Query API**: Paginated, filterable endpoint for dashboards and activity feeds

## Architecture

- **Entity**: `AccountOperation` — one row per Horizon operation, `operationId` is the dedup key
- **Entity**: `HorizonIngestCheckpoint` — one row per account, stores the last `paging_token` cursor
- **Service**: `HorizonIngestService` — cron scheduler + query API
- **Processor**: `HorizonIngestProcessor` — BullMQ worker, pages through Horizon operations with rate limiting
- **Controller**: `HorizonIngestController` — REST endpoints for querying operations and triggering backfills

## Configuration

Add these environment variables to `.env.local`:

```bash
# Comma-separated list of Stellar account public keys to watch
HORIZON_INGEST_ACCOUNTS=GXXXXXXX,GYYYYYYYY

# Number of operations to fetch per Horizon page (1–200, default: 200)
HORIZON_INGEST_PAGE_SIZE=200

# Milliseconds to wait between consecutive Horizon page requests (default: 200)
HORIZON_INGEST_RATE_LIMIT_DELAY_MS=200
```

## Database Migration

Run the migration to create the required tables:

```bash
npm run migration:run
```

This creates:
- `horizon_account_operations` — stores ingested operations
- `horizon_ingest_checkpoints` — tracks the last cursor per account

## Usage

### Automatic Incremental Sync

Once `HORIZON_INGEST_ACCOUNTS` is configured, the cron job runs every minute and enqueues an ingest job for each account. The processor resumes from the stored checkpoint, so only new operations are fetched.

### Manual Backfill

Trigger a full backfill for a specific account:

```bash
POST /horizon-ingest/backfill/:accountId
```

Example:
```bash
curl -X POST http://localhost:3000/horizon-ingest/backfill/GXXXXXXX
```

Response:
```json
{
  "jobId": "ingest-GXXXXXXX-backfill"
}
```

### Query Operations

Retrieve ingested operations for an account:

```bash
GET /horizon-ingest/operations/:accountId?limit=20&cursor=123456&type=payment
```

Query parameters:
- `limit` (optional, default: 20, max: 200) — number of operations to return
- `cursor` (optional) — `operationId` of the last seen record for pagination
- `type` (optional) — filter by operation type (e.g., `payment`, `create_account`)

Response:
```json
{
  "data": [
    {
      "id": "uuid",
      "operationId": "123456789",
      "accountId": "GXXXXXXX",
      "type": "payment",
      "pagingToken": "123456789-0",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "raw": { /* full Horizon operation record */ },
      "ingestedAt": "2024-01-01T00:01:00.000Z"
    }
  ],
  "nextCursor": "123456788"
}
```

### Check Checkpoint

Retrieve the current checkpoint (last ingested cursor) for an account:

```bash
GET /horizon-ingest/checkpoint/:accountId
```

Response:
```json
{
  "id": "uuid",
  "accountId": "GXXXXXXX",
  "cursor": "123456789-0",
  "updatedAt": "2024-01-01T00:01:00.000Z"
}
```

## Deduplication Strategy

The `operationId` column has a unique constraint. The processor uses `INSERT ... ON CONFLICT DO NOTHING` so duplicate operations are silently skipped. This ensures:
- Idempotent ingestion — safe to re-run backfills
- No duplicate operations in the database
- Crash-safe — if the processor crashes mid-page, restarting from the checkpoint won't create duplicates

## Rate Limiting Strategy

Horizon's public API has rate limits. The processor respects these by:
1. Waiting `HORIZON_INGEST_RATE_LIMIT_DELAY_MS` milliseconds between consecutive page requests
2. Using BullMQ's exponential backoff (5 attempts, starting at 2 seconds) if a request fails
3. Processing accounts sequentially (concurrency=1) to avoid overwhelming Horizon

Default delay is 200 ms, which allows ~5 pages/second per account. Adjust based on your Horizon instance's rate limits.

## Monitoring

- **BullMQ Dashboard**: Monitor job status, retries, and failures
- **Logs**: The processor logs progress after every page: `Page X: inserted=Y skipped=Z cursor=...`
- **Checkpoint Table**: Query `horizon_ingest_checkpoints` to see the last cursor per account

## Acceptance Criteria

✅ **Backfill + incremental**: First run starts from cursor `'0'`, subsequent runs resume from checkpoint  
✅ **Dedup keyed by op id**: `operationId` unique constraint + `ON CONFLICT DO NOTHING`  
✅ **Respects rate limits**: Configurable inter-page delay + exponential backoff on errors

## Example Workflow

1. Add account IDs to `HORIZON_INGEST_ACCOUNTS` in `.env.local`
2. Run migration: `npm run migration:run`
3. Start the backend: `npm run start:dev`
4. Wait for the cron job to run (every minute) or trigger a manual backfill
5. Query operations via `GET /horizon-ingest/operations/:accountId`

## Future Enhancements

- Add WebSocket support to push new operations to connected clients in real-time
- Add filtering by date range, asset, or transaction hash
- Add aggregation endpoints (e.g., daily operation counts by type)
- Add support for watching specific operation types only (e.g., only payments)
