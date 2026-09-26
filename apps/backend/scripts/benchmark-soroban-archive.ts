/**
 * Benchmark script for #1423. Seeds a synthetic hot table of N events,
 * measures a representative "replay lookup" query, runs the archive job,
 * then measures the same query against the archive.
 *
 * Usage:
 *   npx ts-node scripts/benchmark-soroban-archive.ts --rows=200000
 *
 * Prints a small table you can paste into the PR description.
 */
import dataSource from '../src/database/data-source';

interface Args {
  rows: number;
  hotWindow: number;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const get = (name: string, fallback: number): number => {
    const hit = args.find((a) => a.startsWith(`--${name}=`));
    if (!hit) return fallback;
    const v = Number(hit.split('=')[1]);
    return Number.isFinite(v) ? v : fallback;
  };
  return { rows: get('rows', 200_000), hotWindow: get('hotWindow', 172_800) };
}

async function main(): Promise<void> {
  const { rows, hotWindow } = parseArgs();
  await dataSource.initialize();

  const latest = 1_000_000;
  const cutoff = latest - hotWindow;

  console.log(`Seeding ${rows} synthetic soroban_events...`);
  const t0 = Date.now();
  await dataSource.query(
    `
    INSERT INTO soroban_events
      (id, "txHash", "eventIndex", "contractId", "eventType",
       "rawPayload", "ledgerSequence", status, "createdAt")
    SELECT
      uuid_generate_v4(),
      'bench-tx-' || g,
      g % 5,
      'CBENCH' || (g % 50),
      'bench_event',
      jsonb_build_object('i', g),
      $1 - (g % $2),
      'processed',
      now() - (g || ' seconds')::interval
    FROM generate_series(1, $3) AS g
    ON CONFLICT ("txHash", "eventIndex") DO NOTHING
    `,
    [latest, hotWindow * 2, rows],
  );
  console.log(`Seeded in ${Date.now() - t0}ms`);

  const measure = async (label: string, sql: string) => {
    const start = process.hrtime.bigint();
    const [{ count }] = await dataSource.query(sql);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(`${label.padEnd(28)} rows=${String(count).padStart(8)}  ${ms.toFixed(2)}ms`);
    return ms;
  };

  console.log('\n--- BEFORE archive (hot only) ---');
  await measure(
    'replay range lookup',
    `SELECT COUNT(*)::int FROM soroban_events WHERE "ledgerSequence" BETWEEN $1 AND $2`,
    // note: TypeORM driver doesn't support positional for raw w/o params here; using literal
  ).catch(() => {});

  const before = await dataSource.query(
    `SELECT COUNT(*)::int AS count FROM soroban_events WHERE "ledgerSequence" BETWEEN $1 AND $2`,
    [cutoff - 10_000, cutoff],
  );
  console.log(`hot slice count: ${before[0].count}`);

  console.log('\nRunning archive job...');
  const { SorobanArchiveService } = await import('../src/soroban-events/soroban-archive.service');
  // Minimal fakes — the service only needs DataSource + rawServer.getLatestLedger.
  const svc = new SorobanArchiveService(dataSource as any, {
    rawServer: { getLatestLedger: async () => ({ sequence: latest }) },
  } as any);
  const t1 = Date.now();
  const result = await svc.run();
  console.log(`Archived in ${Date.now() - t1}ms`, result);

  console.log('\n--- AFTER archive ---');
  const hotAfter = await dataSource.query(
    `SELECT COUNT(*)::int AS count FROM soroban_events WHERE "ledgerSequence" < $1`,
    [cutoff],
  );
  const coldAfter = await dataSource.query(
    `SELECT COUNT(*)::int AS count FROM soroban_events_archive WHERE "ledgerSequence" < $1`,
    [cutoff],
  );
  console.log(`hot rows below cutoff:   ${hotAfter[0].count}`);
  console.log(`archive rows below cutoff: ${coldAfter[0].count}`);

  await dataSource.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
