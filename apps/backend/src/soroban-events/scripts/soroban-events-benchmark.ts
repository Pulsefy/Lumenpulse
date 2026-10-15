#!/usr/bin/env ts-node
/* eslint-disable */
/**
 * soroban-events-benchmark.ts
 * ---------------------------
 * Measures read performance against the soroban_events partitioned table
 * and the soroban_events_archive cold-storage table before and after the
 * partitioning migration.
 *
 * Usage
 * -----
 *   DATABASE_URL=postgresql://user:pass@localhost:5432/lumenpulse \
 *   ts-node src/soroban-events/scripts/soroban-events-benchmark.ts
 *
 * Optional env vars
 * -----------------
 *   BENCHMARK_ITERATIONS   Number of query iterations per scenario (default: 10)
 *   BENCHMARK_SAMPLE_SIZE  Rows to INSERT for seeding (default: 50000)
 *   BENCHMARK_SEED         Set to "true" to INSERT synthetic rows before benchmarking
 *   BENCHMARK_CLEANUP      Set to "true" to DELETE seeded rows after benchmarking
 *
 * Output
 * ------
 * A JSON report is printed to stdout and written to benchmark-results.json
 * in the current directory.  The report includes:
 *   - Per-scenario p50/p95/p99/max latency in milliseconds
 *   - EXPLAIN ANALYZE output for each query pattern
 *   - Table and index sizes before and after archival (if an archival was run)
 */

import { Client } from 'pg';
import * as fs from 'fs';
import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/lumenpulse';
const ITERATIONS = parseInt(process.env.BENCHMARK_ITERATIONS ?? '10', 10);
const SAMPLE_SIZE = parseInt(process.env.BENCHMARK_SAMPLE_SIZE ?? '50000', 10);
const SHOULD_SEED = process.env.BENCHMARK_SEED === 'true';
const SHOULD_CLEANUP = process.env.BENCHMARK_CLEANUP === 'true';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScenarioResult {
  name: string;
  query: string;
  iterations: number;
  latenciesMs: number[];
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  meanMs: number;
  explainAnalyze: string;
}

interface BenchmarkReport {
  runAt: string;
  databaseUrl: string;
  iterations: number;
  tableSizes: Record<string, string>;
  indexSizes: Record<string, string>;
  scenarios: ScenarioResult[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function time<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t0 = performance.now();
  const result = await fn();
  return [result, performance.now() - t0];
}

async function runScenario(
  client: Client,
  name: string,
  query: string,
  params: unknown[] = [],
): Promise<ScenarioResult> {
  const latencies: number[] = [];

  // Warm up
  await client.query(query, params as any);

  for (let i = 0; i < ITERATIONS; i++) {
    const [, ms] = await time(() => client.query(query, params as any));
    latencies.push(ms);
  }

  const sorted = [...latencies].sort((a, b) => a - b);

  // EXPLAIN ANALYZE on a single execution
  let explainOutput = '';
  try {
    const explainResult = await client.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${query}`,
      params as any,
    );
    explainOutput = explainResult.rows.map((r: any) => Object.values(r)[0]).join('\n');
  } catch {
    explainOutput = '(EXPLAIN ANALYZE not available for this query)';
  }

  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;

  return {
    name,
    query,
    iterations: ITERATIONS,
    latenciesMs: sorted,
    p50Ms: Math.round(percentile(sorted, 50) * 100) / 100,
    p95Ms: Math.round(percentile(sorted, 95) * 100) / 100,
    p99Ms: Math.round(percentile(sorted, 99) * 100) / 100,
    maxMs: Math.round(sorted[sorted.length - 1] * 100) / 100,
    meanMs: Math.round(mean * 100) / 100,
    explainAnalyze: explainOutput,
  };
}

async function getTableSizes(client: Client): Promise<Record<string, string>> {
  const result = await client.query(`
    SELECT
      relname AS table_name,
      pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND relname LIKE 'soroban_events%'
    ORDER BY pg_total_relation_size(c.oid) DESC;
  `);
  const sizes: Record<string, string> = {};
  for (const row of result.rows) {
    sizes[row.table_name] = row.total_size;
  }
  return sizes;
}

async function getIndexSizes(client: Client): Promise<Record<string, string>> {
  const result = await client.query(`
    SELECT
      indexrelid::regclass::text AS index_name,
      pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
    FROM pg_stat_user_indexes
    WHERE relname LIKE 'soroban_events%'
    ORDER BY pg_relation_size(indexrelid) DESC;
  `);
  const sizes: Record<string, string> = {};
  for (const row of result.rows) {
    sizes[row.index_name] = row.index_size;
  }
  return sizes;
}

// ---------------------------------------------------------------------------
// Seed data (optional)
// ---------------------------------------------------------------------------

async function seedData(client: Client): Promise<string[]> {
  console.log(`Seeding ${SAMPLE_SIZE} synthetic rows …`);
  const ids: string[] = [];
  const batchSize = 1_000;

  for (let offset = 0; offset < SAMPLE_SIZE; offset += batchSize) {
    const rows: string[] = [];
    for (let i = 0; i < batchSize && offset + i < SAMPLE_SIZE; i++) {
      const n = offset + i;
      const txHash = crypto.randomBytes(32).toString('hex');
      const contractId = `C${crypto.randomBytes(28).toString('hex').toUpperCase()}`;
      const createdAt = new Date(
        Date.now() - Math.floor(Math.random() * 180) * 86_400_000,
      ).toISOString();
      const ledger = 50_000_000 + n;
      rows.push(
        `('${txHash}', ${n % 10}, '${contractId}', 'transfer', '{"dummy":true}', ${ledger}, 'processed', '${createdAt}')`,
      );
    }

    const result = await client.query(`
      INSERT INTO soroban_events
        (tx_hash, event_index, contract_id, event_type, raw_payload, ledger_sequence, status, created_at)
      VALUES ${rows.join(',')}
      ON CONFLICT (tx_hash, event_index, created_at) DO NOTHING
      RETURNING id
    `);
    ids.push(...result.rows.map((r: any) => r.id));
  }

  console.log(`Seeded ${ids.length} rows.`);
  return ids;
}

async function cleanupSeedData(client: Client, ids: string[]): Promise<void> {
  console.log('Cleaning up seeded rows …');
  // Delete in batches of 1000
  for (let i = 0; i < ids.length; i += 1_000) {
    const batch = ids.slice(i, i + 1_000);
    const placeholders = batch.map((_, j) => `$${j + 1}`).join(',');
    await client.query(`DELETE FROM soroban_events WHERE id IN (${placeholders})`, batch);
  }
  console.log('Cleanup complete.');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  console.log('Connected to database.');

  let seededIds: string[] = [];

  try {
    if (SHOULD_SEED) {
      seededIds = await seedData(client);
    }

    // Gather table/index sizes
    const tableSizes = await getTableSizes(client);
    const indexSizes = await getIndexSizes(client);

    // Fetch a sample contract_id and ledger range for parameterised queries
    const sampleRow = await client.query(`
      SELECT contract_id, ledger_sequence, created_at
      FROM soroban_events
      WHERE contract_id IS NOT NULL AND ledger_sequence IS NOT NULL
      LIMIT 1
    `);

    const sampleContractId: string = sampleRow.rows[0]?.contract_id ?? 'UNKNOWN';
    const sampleLedger: number = parseInt(sampleRow.rows[0]?.ledger_sequence ?? '1', 10);
    const fromLedger = Math.max(1, sampleLedger - 500_000);
    const toLedger = sampleLedger + 500_000;

    // Sample created_at range for a 30-day window query
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // ------------------------------------------------------------------
    // Benchmark scenarios
    // ------------------------------------------------------------------
    const scenarios: ScenarioResult[] = [];

    // 1. Status scan (hot table — most common for queue consumers)
    scenarios.push(
      await runScenario(
        client,
        'Status scan: pending events (hot)',
        `SELECT id, tx_hash, event_index, contract_id, event_type, ledger_sequence
         FROM soroban_events
         WHERE status = 'pending'
         ORDER BY created_at ASC
         LIMIT 100`,
      ),
    );

    // 2. Contract + type filter with created_at range (partition-prunable)
    scenarios.push(
      await runScenario(
        client,
        'Contract+type filter with 30-day window (partition-prunable)',
        `SELECT id, tx_hash, event_index, ledger_sequence, created_at
         FROM soroban_events
         WHERE contract_id = $1
           AND event_type = 'transfer'
           AND created_at >= $2
         ORDER BY created_at DESC
         LIMIT 50`,
        [sampleContractId, thirtyDaysAgo.toISOString()],
      ),
    );

    // 3. Ledger range query (replay/backfill pattern)
    scenarios.push(
      await runScenario(
        client,
        'Ledger range scan (replay/backfill pattern)',
        `SELECT id, tx_hash, event_index, contract_id, event_type, ledger_sequence, created_at
         FROM soroban_events
         WHERE ledger_sequence >= $1
           AND ledger_sequence <= $2
         ORDER BY ledger_sequence ASC, event_index ASC
         LIMIT 1000`,
        [fromLedger, toLedger],
      ),
    );

    // 4. processed_at range (monitoring completed events)
    scenarios.push(
      await runScenario(
        client,
        'processed_at range (monitoring pattern)',
        `SELECT id, tx_hash, event_index, status, processed_at
         FROM soroban_events
         WHERE processed_at IS NOT NULL
           AND processed_at >= NOW() - INTERVAL '24 hours'
         ORDER BY processed_at DESC
         LIMIT 200`,
      ),
    );

    // 5. Count by status (dashboard aggregate)
    scenarios.push(
      await runScenario(
        client,
        'Count by status (dashboard aggregate)',
        `SELECT status, COUNT(*) AS cnt
         FROM soroban_events
         GROUP BY status`,
      ),
    );

    // 6. Archive table — ledger range scan
    const archiveCount: { rows: Array<{ count: string }> } = await client.query(
      `SELECT COUNT(*) FROM soroban_events_archive`,
    );
    const hasArchive = parseInt(archiveCount.rows[0]?.count ?? '0', 10) > 0;

    if (hasArchive) {
      scenarios.push(
        await runScenario(
          client,
          'Archive: ledger range scan (cold storage)',
          `SELECT id, tx_hash, event_index, contract_id, event_type, ledger_sequence, created_at
           FROM soroban_events_archive
           WHERE ledger_sequence >= $1
             AND ledger_sequence <= $2
           ORDER BY ledger_sequence ASC, event_index ASC
           LIMIT 1000`,
          [fromLedger, toLedger],
        ),
      );

      scenarios.push(
        await runScenario(
          client,
          'Archive: contract+type filter (cold storage)',
          `SELECT id, tx_hash, event_index, ledger_sequence, created_at
           FROM soroban_events_archive
           WHERE contract_id = $1
             AND event_type = 'transfer'
           ORDER BY created_at DESC
           LIMIT 50`,
          [sampleContractId],
        ),
      );
    }

    // 7. UNION query across hot + archive (cross-partition)
    if (hasArchive) {
      scenarios.push(
        await runScenario(
          client,
          'UNION hot+archive: ledger range (cross-partition replay)',
          `(
            SELECT id, tx_hash, event_index, ledger_sequence, created_at, 'hot' AS source
            FROM soroban_events
            WHERE ledger_sequence >= $1 AND ledger_sequence <= $2
          )
          UNION ALL
          (
            SELECT id, tx_hash, event_index, ledger_sequence, created_at, 'archive' AS source
            FROM soroban_events_archive
            WHERE ledger_sequence >= $1 AND ledger_sequence <= $2
          )
          ORDER BY ledger_sequence ASC, event_index ASC
          LIMIT 1000`,
          [fromLedger, toLedger],
        ),
      );
    }

    // ------------------------------------------------------------------
    // Compose and emit report
    // ------------------------------------------------------------------
    const report: BenchmarkReport = {
      runAt: new Date().toISOString(),
      databaseUrl: DB_URL.replace(/:[^:@]+@/, ':***@'),
      iterations: ITERATIONS,
      tableSizes,
      indexSizes,
      scenarios,
    };

    const reportJson = JSON.stringify(report, null, 2);
    console.log('\n=== Benchmark Report ===\n');
    console.log(reportJson);

    const outPath = 'benchmark-results.json';
    fs.writeFileSync(outPath, reportJson, 'utf8');
    console.log(`\nReport written to ${outPath}`);

    // Print a human-readable summary table
    console.log('\n--- Summary (ms) ---');
    console.log(
      `${'Scenario'.padEnd(60)} ${'p50'.padStart(8)} ${'p95'.padStart(8)} ${'p99'.padStart(8)} ${'max'.padStart(8)}`,
    );
    console.log('-'.repeat(92));
    for (const s of report.scenarios) {
      const name = s.name.slice(0, 59).padEnd(60);
      console.log(
        `${name} ${String(s.p50Ms).padStart(8)} ${String(s.p95Ms).padStart(8)} ${String(s.p99Ms).padStart(8)} ${String(s.maxMs).padStart(8)}`,
      );
    }
  } finally {
    if (SHOULD_CLEANUP && seededIds.length > 0) {
      await cleanupSeedData(client, seededIds);
    }
    await client.end();
  }
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
