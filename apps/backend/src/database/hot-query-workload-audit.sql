-- =============================================================================
-- Lumenpulse Database Index & Hot Query Workload Audit Script
-- Issue #1422: Audit database indexes against hot queries (Wave 9)
-- =============================================================================
-- This script contains:
-- 1. Redundant / duplicate index detection queries
-- 2. Index usage statistics & write-amplification audit queries
-- 3. Representative hot workload queries (Q1 - Q8) with EXPLAIN (ANALYZE, BUFFERS)
-- 4. Benchmark execution harness for pre- and post-optimization comparison
-- =============================================================================

-- =============================================================================
-- PART 1: REDUNDANT & DUPLICATE INDEX DETECTION
-- =============================================================================

-- Query 1.1: Exact Duplicate Index Detection
-- Finds multiple indexes defined on the exact same table and columns in the same order
SELECT
  indrelid::regclass AS table_name,
  ARRAY_AGG(indexrelid::regclass) AS duplicate_indexes,
  indkey::text AS column_positions,
  COUNT(*) AS duplicate_count
FROM pg_index
WHERE indisvalid
  AND indrelid::regclass::text NOT LIKE 'pg_%'
  AND indrelid::regclass::text NOT LIKE 'information_schema%'
GROUP BY indrelid, indkey
HAVING COUNT(*) > 1
ORDER BY table_name;

-- Query 1.2: Left-Prefix Redundancy Detection
-- Identifies single-column or multi-column indexes whose columns are a leading prefix
-- of an existing composite index on the same table.
SELECT
  t.relname AS table_name,
  redundant_idx.relname AS redundant_index,
  redundant_attr.cols AS redundant_columns,
  covering_idx.relname AS covering_index,
  covering_attr.cols AS covering_columns
FROM pg_index r
JOIN pg_class redundant_idx ON redundant_idx.oid = r.indexrelid
JOIN pg_class t ON t.oid = r.indrelid
CROSS JOIN LATERAL (
  SELECT string_agg(attname, ', ' ORDER BY ord) AS cols, array_agg(attnum ORDER BY ord) AS attnums
  FROM (
    SELECT a.attname, a.attnum, u.ord
    FROM unnest(r.indkey) WITH ORDINALITY AS u(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = r.indrelid AND a.attnum = u.attnum
  ) s
) redundant_attr
JOIN pg_index c ON c.indrelid = r.indrelid AND c.indexrelid != r.indexrelid
JOIN pg_class covering_idx ON covering_idx.oid = c.indexrelid
CROSS JOIN LATERAL (
  SELECT string_agg(attname, ', ' ORDER BY ord) AS cols, array_agg(attnum ORDER BY ord) AS attnums
  FROM (
    SELECT a.attname, a.attnum, u.ord
    FROM unnest(c.indkey) WITH ORDINALITY AS u(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = c.indrelid AND a.attnum = u.attnum
  ) s
) covering_attr
WHERE r.indisvalid AND c.indisvalid
  AND NOT r.indisprimary
  AND NOT r.indisunique
  AND r.indpred IS NULL
  AND c.indpred IS NULL
  AND array_length(redundant_attr.attnums, 1) < array_length(covering_attr.attnums, 1)
  AND covering_attr.attnums[1:array_length(redundant_attr.attnums, 1)] = redundant_attr.attnums
  AND t.relnamespace = 'public'::regnamespace
ORDER BY t.relname, redundant_idx.relname;

-- =============================================================================
-- PART 2: INDEX SIZE, USAGE, AND WRITE-OVERHEAD MONITORING
-- =============================================================================

-- Query 2.1: Index Size and Scan Count Breakdown
SELECT
  schemaname,
  relname AS table_name,
  indexrelname AS index_name,
  idx_scan AS number_of_scans,
  idx_tup_read AS tuples_read,
  idx_tup_fetch AS tuples_fetched,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
ORDER BY pg_relation_size(indexrelid) DESC;

-- Query 2.2: Unused Indexes (0 scans, candidate for removal if table has significant rows)
SELECT
  s.schemaname,
  s.relname AS table_name,
  s.indexrelname AS unused_index_name,
  pg_size_pretty(pg_relation_size(s.indexrelid)) AS wasted_space,
  t.n_tup_ins + t.n_tup_upd + t.n_tup_del AS write_activity
FROM pg_stat_user_indexes s
JOIN pg_stat_user_tables t ON s.relid = t.relid
JOIN pg_index i ON s.indexrelid = i.indexrelid
WHERE s.idx_scan = 0
  AND NOT i.indisunique
  AND NOT i.indisprimary
ORDER BY pg_relation_size(s.indexrelid) DESC;

-- =============================================================================
-- PART 3: HOT QUERY WORKLOAD EXPLAIN ANALYZE BENCHMARKS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Q1: Watchlist Symbol Fanout (Notification Service)
-- Service: NotificationFanoutService.findTargetUsersForWatchlist
-- Hot Path: Triggered on every market price update / asset price spike.
-- Index: IDX_watchlist_items_symbol_type_userId (symbol, type, userId)
-- -----------------------------------------------------------------------------
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT "userId", "symbol", "type"
FROM "watchlist_items"
WHERE "symbol" = 'XLM' AND "type" = 'crypto';

-- -----------------------------------------------------------------------------
-- Q2: Unscored Articles Polling (Sentiment Analysis Worker)
-- Service: NewsService.findUnscoredArticles
-- Hot Path: Cron worker polls for pending articles to submit for sentiment scoring.
-- Index: IDX_articles_unscored_published (publishedAt DESC) WHERE sentimentScore IS NULL
-- -----------------------------------------------------------------------------
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT id, title, content, "publishedAt"
FROM "articles"
WHERE "sentimentScore" IS NULL
ORDER BY "publishedAt" DESC
LIMIT 50;

-- -----------------------------------------------------------------------------
-- Q3: News Category Filter (Public API & Mobile App Feed)
-- Service: NewsService.findAll
-- Hot Path: Highly requested endpoint by active users filtering by topic.
-- Index: IDX_articles_category_published (LOWER(category::text), publishedAt DESC)
-- -----------------------------------------------------------------------------
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT id, title, category, "publishedAt", "sentimentScore"
FROM "articles"
WHERE LOWER("category"::text) = 'crypto'
ORDER BY "publishedAt" DESC
LIMIT 20;

-- -----------------------------------------------------------------------------
-- Q4: User Notification Feed and Unread Counter (Mobile App & Web App Badging)
-- Service: NotificationService.findForUser
-- Hot Path: Every navigation/page load polls unread counts and recent alerts.
-- Index: IDX_notifications_user_read_created (userId, read, createdAt DESC)
-- -----------------------------------------------------------------------------
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT count(*)
FROM "notifications"
WHERE "userId" = '00000000-0000-0000-0000-000000000001'
  AND "read" = false;

EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT id, "userId", "read", "type", "createdAt"
FROM "notifications"
WHERE "userId" = '00000000-0000-0000-0000-000000000001'
  AND "read" = false
ORDER BY "createdAt" DESC
LIMIT 20;

-- -----------------------------------------------------------------------------
-- Q5: Primary Stellar Account Lookup (Portfolio & Payment Service)
-- Service: UsersService.findPrimaryStellarAccount
-- Hot Path: Called on every signed transaction, portfolio valuation, and transfer.
-- Index: IDX_stellar_accounts_user_primary (userId, isPrimary)
-- -----------------------------------------------------------------------------
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT id, "userId", "publicKey", "isPrimary"
FROM "stellar_accounts"
WHERE "userId" = '00000000-0000-0000-0000-000000000001'
  AND "isPrimary" = true
LIMIT 1;

-- -----------------------------------------------------------------------------
-- Q6: Crowdfund Vault Events Reorg & Sequence Verification (Indexer)
-- Service: CrowdfundSyncService.detectReorgs
-- Hot Path: Ingestion loop checks latest confirmed ledger events to verify chain continuity.
-- Index: IDX_crowdfund_vault_events_vault_status_ledger (vault_address, status, ledger_sequence DESC)
-- -----------------------------------------------------------------------------
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT id, "vault_address", "status", "ledger_sequence"
FROM "crowdfund_vault_events"
WHERE "vault_address" = 'CVAULT000000000000000000000000000000000000000000000000000001'
  AND "status" = 'confirmed'
ORDER BY "ledger_sequence" DESC
LIMIT 5;

-- -----------------------------------------------------------------------------
-- Q7: Content Moderation Reports Status Queue (Moderation Admin)
-- Service: ModerationService.getReports
-- Hot Path: Moderation console polls pending queue sorted chronologically.
-- Index: IDX_content_reports_status_created (status, created_at DESC)
-- -----------------------------------------------------------------------------
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT id, "status", "created_at"
FROM "content_reports"
WHERE "status" = 'pending'
ORDER BY "created_at" DESC
LIMIT 20;

-- -----------------------------------------------------------------------------
-- Q8: Read-Model Rebuild Job Deduplication (Rebuild Worker)
-- Service: ReadModelRebuildService.findExistingJob
-- Hot Path: Ensures no duplicate rebuild worker is spawned for an active dataset.
-- Index: IDX_rebuild_jobs_dataset_created_status (dataset, createdAt DESC, status)
-- -----------------------------------------------------------------------------
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT id, "dataset", "createdAt", "status"
FROM "read_model_rebuild_jobs"
WHERE "dataset" = 'analytics'
ORDER BY "createdAt" DESC
LIMIT 1;
