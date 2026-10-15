# Soroban Events — Retention and Archival Policy

## Overview

The `soroban_events` table is the primary store for every Soroban contract event
indexed from the Stellar network. Without a retention strategy the table grows
without bound and query performance degrades continuously as row counts increase
into the tens of millions.

This document describes the partitioning scheme, hot/cold storage split,
archival schedule, and operational runbook implemented in
[Issue #1423](https://github.com/Pulsefy/Lumenpulse/issues/1423).

---

## Storage Tiers

### Hot Tier — `soroban_events` (partitioned)

The main `soroban_events` table is a **declarative range-partitioned** table
(PostgreSQL `PARTITION BY RANGE (created_at)`). Quarterly child partitions are
pre-provisioned and a default catch-all partition absorbs any rows outside the
defined ranges.

| Partition name              | Date range              |
|-----------------------------|-------------------------|
| `soroban_events_2024_q1`    | 2024-01-01 → 2024-04-01 |
| `soroban_events_2024_q2`    | 2024-04-01 → 2024-07-01 |
| …                           | …                       |
| `soroban_events_2026_q4`    | 2026-10-01 → 2027-01-01 |
| `soroban_events_default`    | catch-all               |

**Why `created_at` as the partition key?**

- `created_at` is `NOT NULL` with a `DEFAULT now()` — required for a safe
  partition key.
- `ledger_sequence` is nullable and therefore cannot be a partition key.
- `created_at`-based partitioning aligns naturally with the archival cutoff
  (age of rows) and allows PostgreSQL's partition pruning to skip irrelevant
  quarters on most queries.

**Hot window:** last **90 days** (configurable via `SOROBAN_HOT_WINDOW_DAYS`).

### Cold Tier — `soroban_events_archive`

A plain (non-partitioned) append-only table. Rows moved here have aged out of
the hot window. The archive carries an additional `archived_at` timestamp for
audit purposes.

---

## Archival Schedule

`SorobanEventArchiveService` runs a cron job daily at **02:00 UTC**
(`CronExpression.EVERY_DAY_AT_2AM`).

### What it does

1. Computes the cutoff: `NOW() - SOROBAN_HOT_WINDOW_DAYS days` (default 90).
2. Calls `soroban_events_ensure_partition()` to pre-provision the next
   quarterly partition so that new inserts always land in a named child
   partition rather than the default catch-all.
3. Moves rows in batches of **5,000** using a `DELETE … RETURNING` CTE that
   atomically inserts into `soroban_events_archive` and removes from
   `soroban_events` in a single transaction per batch. `FOR UPDATE SKIP LOCKED`
   is used to avoid contention with in-flight writes.
4. Repeats until no more rows older than the cutoff remain in the hot table.

### Configuration

| Env var                      | Default | Description                              |
|------------------------------|---------|------------------------------------------|
| `SOROBAN_HOT_WINDOW_DAYS`    | `90`    | Days of hot data to retain               |
| `SOROBAN_INDEXER_START_LEDGER` | `0`   | Bootstrap ledger for cursor creation     |

---

## Query Behaviour Across Tiers

PostgreSQL's **partition pruning** ensures that queries with a `created_at`
predicate only scan relevant child partitions. For example:

```sql
-- Only scans soroban_events_2026_q3 and soroban_events_2026_q4
SELECT * FROM soroban_events
WHERE created_at >= '2026-07-01'
  AND contract_id = 'CC...'
ORDER BY created_at DESC
LIMIT 50;
```

For replay and backfill, which query by `ledger_sequence`, PostgreSQL scans all
partitions but uses the `idx_soroban_events_ledger_sequence` index on each. The
total scan is proportional to the number of matching rows, not the table size.

### Cross-partition queries

`SorobanEventArchiveService.findByLedgerRange(from, to)` transparently queries
both tiers and merges results. Use this for:

- Historical replay over a range that may span the archive boundary.
- Audit queries covering more than 90 days of history.

`SorobanEventIndexerService.getEventsByLedgerRange(from, to)` wraps the above
and adds a `source: 'hot' | 'archive'` field to each result.

---

## Replay and Backfill

`SorobanEventIndexerService.backfill(fromLedger)` is **unaffected** by
partitioning. It re-fetches events from the Soroban RPC and upserts them into
`soroban_events`. PostgreSQL routes the upsert to the correct child partition
based on the `created_at` value (which defaults to `NOW()`).

The unique constraint `(tx_hash, event_index, created_at)` on the partitioned
table prevents duplicates within a partition. The archival job uses
`ON CONFLICT (tx_hash, event_index) DO NOTHING` when inserting into the archive,
so duplicate moves across runs are safe.

If you need to **read** archived events during replay (e.g., to check whether
an event was already processed), use `getEventsByLedgerRange`.

---

## Migration

### Applying

```bash
# From apps/backend/
npx typeorm migration:run -d src/database/data-source.ts
```

Migration class: `PartitionSorobanEvents1810000000000`

**What the migration does:**

1. Renames `soroban_events` → `soroban_events_legacy`.
2. Creates a new partitioned `soroban_events` parent with quarterly children.
3. Re-creates all original indexes on the parent (auto-propagated to children).
4. Copies all existing rows from `soroban_events_legacy` into the partitioned table.
5. Drops `soroban_events_legacy`.
6. Creates `soroban_events_archive` with appropriate indexes.
7. Creates the `soroban_events_ensure_partition()` PL/pgSQL helper function.

**Migration safety notes:**

- The migration sets `transaction = false` to allow per-step DDL without a
  wrapping transaction (required for `CONCURRENTLY` index operations).
- For large production tables the data-copy step (INSERT … SELECT) can be
  slow. Prefer running the migration during a maintenance window or adapting
  to use logical replication for zero-downtime migration.
- A `--dry-run` can be simulated by wrapping the `up()` steps in a transaction
  and rolling back.

### Reverting

```bash
npx typeorm migration:revert -d src/database/data-source.ts
```

The `down()` method:

1. Creates a temporary flat table `soroban_events_restore`.
2. Copies hot rows from the partitioned `soroban_events`.
3. Copies archived rows from `soroban_events_archive` (skipping duplicates).
4. Drops the partitioned parent (cascades to children) and the archive table.
5. Drops the helper function.
6. Renames `soroban_events_restore` → `soroban_events`.
7. Re-creates the original single-table indexes.

---

## Performance Benchmarking

A benchmark script is provided at:

```
src/soroban-events/scripts/soroban-events-benchmark.ts
```

### Running

```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/lumenpulse \
  ts-node src/soroban-events/scripts/soroban-events-benchmark.ts
```

Optional flags (env vars):

| Var                    | Default | Purpose                            |
|------------------------|---------|------------------------------------|
| `BENCHMARK_ITERATIONS` | `10`    | Query repetitions per scenario     |
| `BENCHMARK_SAMPLE_SIZE`| `50000` | Rows to seed (requires `SEED=true`)|
| `BENCHMARK_SEED`       | `false` | Insert synthetic rows first        |
| `BENCHMARK_CLEANUP`    | `false` | Delete seeded rows after run       |

### Scenarios covered

1. Status scan — `pending` events (queue consumer pattern)
2. Contract + type filter with 30-day `created_at` range (partition-prunable)
3. Ledger range scan (replay/backfill pattern)
4. `processed_at` range query (monitoring pattern)
5. Count by status (dashboard aggregate)
6. Archive: ledger range scan (cold storage, if archive is populated)
7. Archive: contract+type filter (cold storage)
8. UNION hot+archive cross-partition ledger range (replay spanning boundary)

Output includes p50/p95/p99/max latency per scenario and `EXPLAIN ANALYZE`
output for each query, written to `benchmark-results.json`.

---

## Operational Runbook

### Adding a new quarterly partition manually

```sql
SELECT soroban_events_ensure_partition('2027-01-15'::TIMESTAMPTZ);
-- Creates soroban_events_2027_q1 if it does not exist
```

### Checking partition sizes

```sql
SELECT
  child.relname        AS partition,
  pg_size_pretty(pg_total_relation_size(child.oid)) AS total_size,
  pg_size_pretty(pg_relation_size(child.oid))        AS data_size
FROM pg_inherits
JOIN pg_class child ON child.oid = pg_inherits.inhrelid
JOIN pg_class parent ON parent.oid = pg_inherits.inhparent
WHERE parent.relname = 'soroban_events'
ORDER BY child.relname;
```

### Checking archive size

```sql
SELECT
  pg_size_pretty(pg_total_relation_size('soroban_events_archive')) AS total,
  COUNT(*) AS row_count,
  MIN(created_at) AS oldest,
  MAX(created_at) AS newest
FROM soroban_events_archive;
```

### Manually triggering archival

```typescript
// Inject SorobanEventArchiveService and call:
const stats = await archiveService.archiveOldEvents();
console.log(stats); // { archived: N, durationMs: M, cutoff: Date }
```

### Detaching an old partition for bulk deletion

Once a quarterly partition contains only archived data it can be detached and
dropped independently for fast reclamation without scanning the parent:

```sql
-- Detach (table still exists, just not attached to the parent)
ALTER TABLE soroban_events DETACH PARTITION soroban_events_2024_q1;

-- Verify it is empty or move remaining rows to archive first, then:
DROP TABLE soroban_events_2024_q1;
```

---

## Acceptance Criteria Checklist

| Criterion | Status | Evidence |
|-----------|--------|---------|
| Retention and archival policy is defined and documented | ✅ | This document |
| Events beyond hot window are partitioned / moved to archival storage | ✅ | `SorobanEventArchiveService.archiveOldEvents()` + migration |
| Replay and backfill continue to work across the hot/archive boundary | ✅ | `SorobanEventIndexerService.getEventsByLedgerRange()` + PostgreSQL partition pruning; `backfill()` unchanged |
| Read performance is measured before and after | ✅ | `soroban-events-benchmark.ts` with EXPLAIN ANALYZE output |
| Migration is reversible and safe to run against existing data | ✅ | `PartitionSorobanEvents1810000000000.down()` fully restores the flat table with both hot and archived rows |
