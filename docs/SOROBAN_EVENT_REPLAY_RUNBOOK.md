# Soroban Event Indexer Replay & Backfill Runbook

## Overview
When a mapping bug is fixed in `soroban-event-mapper.ts`, or a contract is redeployed, historical events may need reprocessing. This runbook describes the replay/backfill command.

## Endpoint
`POST /soroban-events/replay` (admin only, JWT + ADMIN role)

## Usage
```json
{
  "startLedger": 1000,
  "endLedger": 2000,
  "contractId": "CA...",
  "dryRun": false
}
```

## Idempotency
Events are upserted on `(txHash, eventIndex)`. Re-running the same range does not duplicate derived records.

## Live Indexing
Replay uses its own `job_lock` (`soroban-event-replay`) and does not stop the incremental `soroban-event-indexer` cron.

## Progress Observation
- `job_runs` table records `REPLAY_JOB_NAME` runs.
- `GET /health/schedulers` shows replay status.
- Logs include indexed/skipped counts.

## Dry-Run
Set `dryRun: true` to preview changes without writing to `soroban_events` or advancing the cursor.
