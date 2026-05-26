# Contributor Reputation Snapshots

Pre-aggregated daily snapshots of contributor reputation scores sourced from the Stellar testnet `contributor_registry` contract. Used to power leaderboards without hitting the chain on every request.

## How it works

1. The `StellarSyncProcessor` ingests ledger events from the Stellar testnet Horizon API and writes contributor registry state into the `stellar_contributor_registry` table.
2. Every night at **01:05 UTC** the `ContributorSnapshotScheduler` triggers `ContributorSnapshotGenerator.generateForYesterday()`.
3. The generator reads the latest reputation score per contributor (as of yesterday) from `stellar_contributor_registry`, ranks them by score, and upserts one row per contributor into `contributor_snapshots`.
4. The leaderboard endpoint reads directly from `contributor_snapshots` — no on-chain calls at query time.

## Snapshot schedule

| Job name              | Cron expression | Time (UTC) | Description                          |
|-----------------------|-----------------|------------|--------------------------------------|
| `contributor-snapshot`| `5 1 * * *`     | 01:05 UTC  | Nightly contributor reputation snapshot |

The job runs 5 minutes after the sentiment snapshot job (`0 1 * * *`) to avoid DB connection contention.

The job is **idempotent**: re-running it for the same date updates existing rows via an upsert on `(snapshot_date, contributor_address)`.

## Top-N leaderboard query

The repository supports parameterised top-N queries:

```ts
// Top 10 contributors for the latest snapshot date
await repo.findTopN(10);

// Top 25 contributors for a specific date
await repo.findTopN(25, new Date('2026-05-25'));
```

The `limit` parameter is capped at 100 to prevent runaway queries.

## REST API

### `GET /contributor-snapshots/leaderboard`

Returns the top-N contributors ranked by reputation score.

**Query parameters**

| Parameter | Type    | Default | Description                                      |
|-----------|---------|---------|--------------------------------------------------|
| `limit`   | integer | `10`    | Number of entries to return (1–100)              |
| `date`    | string  | latest  | Snapshot date in `YYYY-MM-DD` format (UTC)       |

**Example request**

```
GET /contributor-snapshots/leaderboard?limit=5&date=2026-05-25
```

**Example response**

```json
[
  {
    "rank": 1,
    "contributorAddress": "GABC...XYZ",
    "githubHandle": "alice",
    "reputationScore": 9500,
    "snapshotDate": "2026-05-25"
  },
  {
    "rank": 2,
    "contributorAddress": "GDEF...UVW",
    "githubHandle": "bob",
    "reputationScore": 8200,
    "snapshotDate": "2026-05-25"
  }
]
```

## Database table

`contributor_snapshots`

| Column                  | Type          | Notes                                              |
|-------------------------|---------------|----------------------------------------------------|
| `id`                    | uuid PK       |                                                    |
| `snapshot_date`         | date          | UTC calendar date                                  |
| `contributor_address`   | varchar(64)   | Stellar account address                            |
| `github_handle`         | varchar(255)  | Nullable; captured at snapshot time                |
| `reputation_score`      | bigint        | From `contributor_registry` contract               |
| `rank`                  | integer       | 1 = highest score; computed at write time          |
| `registered_timestamp`  | bigint        | Ledger timestamp of on-chain registration          |
| `created_at`            | timestamptz   |                                                    |
| `updated_at`            | timestamptz   |                                                    |

Unique constraint: `(snapshot_date, contributor_address)`.

## Backfill

To backfill historical snapshots (e.g. after a schema migration):

```ts
// Inject ContributorSnapshotGenerator and call:
await generator.backfill(new Date('2026-01-01'), new Date('2026-05-24'));
```

Processes one day at a time to avoid query timeouts.

## Testnet data source

Reputation scores are read from the `stellar_contributor_registry` table, which is populated by `StellarSyncProcessor` polling the Stellar testnet Horizon API (`STELLAR_NETWORK=testnet`). The snapshot job works with whatever data has been synced — if the testnet is quiet on a given day, the snapshot for that day will reflect the most recent known scores.
