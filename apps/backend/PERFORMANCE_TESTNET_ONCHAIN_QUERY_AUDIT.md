# Testnet On-Chain Query Plan Audit

Issue: Pulsefy/Lumenpulse#813

## Top Slow Query Families

The backend paths most likely to dominate p95 latency as testnet event volume grows are:

| Rank | Query family | Code path | Existing risk | Added index |
| --- | --- | --- | --- | --- |
| 1 | Latest raw portfolio snapshot fallback by user | `PortfolioService.getPortfolioSummary`, `MaterializedSnapshotService.refreshForUser` | Sorts each user's historical snapshots when the materialized row is missing or stale | `IDX_portfolio_snapshots_user_created_at_desc` |
| 2 | Recent Soroban events by contract/type for dashboards | `soroban_events` API/ops views and indexer diagnostics | Contract dashboards need recent slices and otherwise scan/filter event history | `IDX_soroban_events_contract_type_created_at` |
| 3 | Pending/failed Soroban event queue views | `SorobanEventsProcessor` and admin/ops review paths | Status-only index still leaves a recency sort as event volume grows | `IDX_soroban_events_status_created_at` |
| 4 | Processed Soroban event timeline | testnet event processing diagnostics | Processed history needs efficient newest-first reads | `IDX_soroban_events_processed_at` |
| 5 | Materialized portfolio dashboard freshness and source joins | dashboard fast paths, backfill/reconciliation checks | Freshness scans and source snapshot audits need stable ordered access | `IDX_materialized_snapshots_updated_at`, `IDX_materialized_snapshots_source_snapshot` |

## Before/After Timing Capture

Use the repeatable audit script against staging or a local restored testnet dump:

```bash
cd apps/backend
psql "$DATABASE_URL" \
  -v user_id="<uuid-user-id>" \
  -v contract_id="<contract-id>" \
  -v event_type="transfer" \
  -f src/database/testnet-onchain-query-plan-audit.sql
```

The top-statements section reads from `pg_stat_statements`; enable that extension
in the target environment before using the ranking query.

Capture the `EXPLAIN (ANALYZE, BUFFERS)` output before and after running:

```bash
npm run migration:run
```

The expected plan changes are:

| Query | Before migration | After migration |
| --- | --- | --- |
| Latest snapshot fallback | Bitmap/index scan plus explicit sort on `createdAt DESC`, or sequential scan on large local datasets | Backward read from `IDX_portfolio_snapshots_user_created_at_desc`; no separate sort |
| Contract event dashboard slice | Filter by `contractId`/`eventType` then sort recent rows | Index scan on `IDX_soroban_events_contract_type_created_at` in newest-first order |
| Pending/failed operations queue | Status filter plus sort by `createdAt DESC` | Index scan on `IDX_soroban_events_status_created_at` |
| Processed event timeline | Filter non-null `processedAt` plus sort | Partial index scan on `IDX_soroban_events_processed_at` |
| Materialized snapshot freshness | Full scan or heap lookups for dashboard freshness/source checks | Covering ordered index for freshness reads and direct source snapshot lookup |

## Index Rationale

- All indexes support read paths already present in the backend; no new runtime dependency or data model is introduced.
- The Soroban indexes are ordered by recency because testnet dashboards and failure triage generally read the newest events first.
- The latest-snapshot index keeps the fallback path fast when a materialized portfolio row has not been created yet.
- The materialized freshness index uses `INCLUDE` columns so dashboard summaries can avoid extra heap reads when PostgreSQL can serve the query from the index.
- The migration is reversible with `DROP INDEX CONCURRENTLY IF EXISTS` in `down()`.

## Safety

- The migration only creates secondary indexes. It does not rewrite table data or alter existing columns.
- `CREATE INDEX CONCURRENTLY IF NOT EXISTS` makes rollout idempotent while avoiding long write locks on growing tables.
- `migrationsTransactionMode: 'each'` allows this migration's `transaction = false` setting to keep concurrent index operations outside a transaction while preserving per-migration transactions elsewhere.
- Rollback uses `DROP INDEX CONCURRENTLY IF EXISTS` and drops only the named indexes added for this audit.
