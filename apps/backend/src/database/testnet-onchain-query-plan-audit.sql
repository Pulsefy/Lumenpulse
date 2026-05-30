-- Testnet on-chain/materialized-view query plan audit.
--
-- Run before and after the index migration to capture the top query families:
--   psql "$DATABASE_URL" \
--     -v user_id="<uuid-user-id>" \
--     -v contract_id="<contract-id>" \
--     -v event_type="transfer" \
--     -f src/database/testnet-onchain-query-plan-audit.sql
--
-- The top statements section requires pg_stat_statements to be enabled.

\echo 'Top statements touching on-chain derived/materialized tables'
SELECT
  calls,
  ROUND(mean_exec_time::numeric, 2) AS mean_ms,
  ROUND(total_exec_time::numeric, 2) AS total_ms,
  rows,
  LEFT(regexp_replace(query, '\s+', ' ', 'g'), 220) AS query
FROM pg_stat_statements
WHERE query ILIKE ANY (ARRAY[
  '%soroban_events%',
  '%portfolio_materialized_snapshots%',
  '%portfolio_snapshots%',
  '%stellar_processed_events%',
  '%stellar_sync_checkpoints%'
])
ORDER BY mean_exec_time DESC
LIMIT 10;

\echo 'Q1: latest portfolio snapshot fallback'
EXPLAIN (ANALYZE, BUFFERS)
SELECT "id", "userId", "createdAt", "assetBalances", "totalValueUsd"
FROM "portfolio_snapshots"
WHERE "userId" = :'user_id'
ORDER BY "createdAt" DESC
LIMIT 1;

\echo 'Q2: dashboard fast path materialized snapshot'
EXPLAIN (ANALYZE, BUFFERS)
SELECT "userId", "totalValueUsd", "assetBalances", "assetAllocation",
       "hasLinkedAccount", "updatedAt"
FROM "portfolio_materialized_snapshots"
WHERE "userId" = :'user_id'
LIMIT 1;

\echo 'Q3: stale materialized snapshot refresh candidates'
EXPLAIN (ANALYZE, BUFFERS)
SELECT ps."userId"
FROM "portfolio_snapshots" ps
LEFT JOIN "portfolio_materialized_snapshots" pms
  ON pms."userId" = ps."userId"
WHERE pms."userId" IS NULL
GROUP BY ps."userId"
LIMIT 100;

\echo 'Q4: recent contract event dashboard slice'
EXPLAIN (ANALYZE, BUFFERS)
SELECT "id", "txHash", "eventIndex", "contractId", "eventType",
       "status", "createdAt", "processedAt"
FROM "soroban_events"
WHERE "contractId" = :'contract_id'
  AND (:'event_type' IS NULL OR "eventType" = :'event_type')
ORDER BY "createdAt" DESC
LIMIT 100;

\echo 'Q5: failed/pending event operations queue'
EXPLAIN (ANALYZE, BUFFERS)
SELECT "id", "txHash", "eventIndex", "contractId", "eventType",
       "status", "createdAt", "errorMessage"
FROM "soroban_events"
WHERE "status" IN ('pending', 'failed')
ORDER BY "createdAt" DESC
LIMIT 100;
