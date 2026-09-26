# Soroban event archival

`soroban_events` grows without bound. This document defines the retention
policy, the archival job, and how replay/backfill behave across the
hot/archive boundary.

## Policy

A row is **eligible** for archival when **both**:

1. `ledgerSequence IS NOT NULL` **and** `ledgerSequence < latestLedger - SOROBAN_HOT_WINDOW_LEDGERS`
2. if `SOROBAN_ARCHIVE_RETENTION_DAYS > 0`: `createdAt < now - retentionDays`

Once eligible, the row is moved (copied + deleted in one transaction) into
`soroban_events_archive`, which mirrors the hot schema plus `originalId` and
`archivedAt`.

The archive has a unique `(txHash, eventIndex)` constraint. That is the
cross-boundary idempotency key:

- The archival job uses `INSERT ... ON CONFLICT DO NOTHING`, so a partial
  failure followed by a re-run is safe.
- The indexer and replay service check the archive before inserting into the
  hot table, so archived events cannot be silently resurrected into the hot
  window.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `SOROBAN_ARCHIVE_ENABLED` | `true` | Kill switch |
| `SOROBAN_ARCHIVE_CRON` | `0 4 * * *` | Daily at 04:00 UTC |
| `SOROBAN_HOT_WINDOW_LEDGERS` | `172800` (~30 days @ 5s) | Rows older than this are eligible |
| `SOROBAN_ARCHIVE_RETENTION_DAYS` | `0` (disabled) | Optional `createdAt` guard |
| `SOROBAN_ARCHIVE_BATCH_SIZE` | `5000` | Rows per transaction |
| `SOROBAN_ARCHIVE_MAX_BATCHES` | `200` | Cap per run; remainder picked up next tick |

Invalid values fail fast at boot (see `soroban-archive.policy.ts`).

## Scheduler

`SorobanArchiveScheduler` runs on the cron above, holds the advisory lock
`soroban-event-archive`, and reports each run to `job_runs`. The job is
registered in `scheduler/job-registry.ts` for staleness reporting.

## Replay and backfill across the boundary

`SorobanEventReplayService` and `SorobanEventIndexerService` both consult
`soroban_events_archive` before writing to the hot table. A ledger range that
spans the hot/archive boundary therefore:

- skips events already present in the archive (no duplicate hot rows),
- still ingests any event that is missing from both sides.

This satisfies the "replay and backfill continue to work across the hot and
archived boundary" acceptance criterion.

## Measuring read performance

`apps/backend/scripts/benchmark-soroban-archive.ts` seeds a synthetic hot
table, measures a representative query, runs the archive job, and prints
before/after counts and timings. Run:
npx ts-node apps/backend/scripts/benchmark-soroban-archive.ts --rows=200000

text

Paste the output into the PR description.

## Reversibility

The migration that creates `soroban_events_archive` is additive and its
`down()` simply drops the archive table. Reversing the feature therefore:

1. Leaves the hot table untouched (no live data is lost).
2. Loses rows already archived.

Re-running `migrate:run` re-creates an empty archive and the scheduler
re-archives eligible rows on the next tick.
