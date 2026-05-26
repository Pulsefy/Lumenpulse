# PR: Contributor Reputation Snapshots & Leaderboard API

## Summary

Builds a nightly snapshot pipeline that captures contributor reputation scores from the Stellar testnet `contributor_registry` contract and exposes a ranked leaderboard via REST API. Snapshots are pre-aggregated so leaderboard queries never hit the chain at request time.

## Changes

### New module — `apps/backend/src/contributor-snapshots/`

| File | Description |
|------|-------------|
| `entities/contributor-snapshot.entity.ts` | TypeORM entity for `contributor_snapshots` table. One row per `(snapshot_date, contributor_address)` with a unique constraint for idempotent upserts. |
| `dto/contributor-snapshot.dto.ts` | Interfaces for aggregation rows, leaderboard query params, response entries, and run results. |
| `contributor-snapshot.repository.ts` | Reads from `stellar_contributor_registry` (populated by the existing `StellarSyncProcessor`), deduplicates to the latest row per contributor, assigns ranks by descending score, and serves top-N leaderboard queries. |
| `contributor-snapshot.generator.ts` | Orchestrates aggregate → upsert. Exposes `generateForDate`, `generateForYesterday`, and `backfill(from, to)`. |
| `contributor-snapshot.scheduler.ts` | `@Cron('5 1 * * *')` — fires at **01:05 UTC** nightly, 5 min after the existing sentiment snapshot job. |
| `contributor-snapshot.controller.ts` | `GET /contributor-snapshots/leaderboard?limit=N&date=YYYY-MM-DD` |
| `contributor-snapshots.module.ts` | NestJS module. |
| `contributor-snapshot.generator.spec.ts` | 13 unit tests covering normal flow, UTC normalisation, empty data, error propagation, null fields, and backfill edge cases. |

### Modified

- `apps/backend/src/app.module.ts` — imports `ContributorSnapshotsModule`

### Documentation

- `document/CONTRIBUTOR_SNAPSHOTS.md` — snapshot schedule, API reference, DB schema, and backfill instructions

## Acceptance Criteria

- [x] **Snapshot schedule documented** — `5 1 * * *` (01:05 UTC) in scheduler and docs
- [x] **Supports top-N queries** — `findTopN(limit, date?)` capped at 100, exposed via `GET /contributor-snapshots/leaderboard`
- [x] **Works from testnet data** — reads from `stellar_contributor_registry` populated by `StellarSyncProcessor` polling the Stellar testnet Horizon API

## API

```
GET /contributor-snapshots/leaderboard?limit=10&date=2026-05-25
```

```json
[
  { "rank": 1, "contributorAddress": "GABC...XYZ", "githubHandle": "alice", "reputationScore": 9500, "snapshotDate": "2026-05-25" },
  { "rank": 2, "contributorAddress": "GDEF...UVW", "githubHandle": "bob",   "reputationScore": 8200, "snapshotDate": "2026-05-25" }
]
```

## Testing

- 13 unit tests in `contributor-snapshot.generator.spec.ts`
- TypeScript type-check passes with no errors in new files (`tsc --noEmit`)

## Notes

- The upsert on `(snapshot_date, contributor_address)` makes the job safe to re-run for the same date.
- Backfill is available via `ContributorSnapshotGenerator.backfill(from, to)` for one-off historical runs.
- No breaking changes to existing modules.
