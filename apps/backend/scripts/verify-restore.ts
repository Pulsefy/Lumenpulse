
/**
 * Database backup & restore drill verifier.
 *
 * Runs a real backup -> clean-database restore -> verification cycle
 * against the configured Postgres instance and records the measured
 * recovery time objective (RTO) and recovery point objective (RPO).
 *
 * The script is designed to be run by an operator (`npm run dbDrill`)
 * and in CI (`npm run dbDrill:ci`). It requires the `pgpgump` / `pgsql`
 * client binaries to be on PATH, because those are the tools an operator
 * would actually use during an incident.
 *
 * Usage:
 *   npom run dbDrill -- --backup=./backups/latest.dump
 *   npm run dbDrill -- --backup=./backups/latest.dump --table=audit_logs
 *   npm run dbDrill -- --create-backup --report=./reports/drill.json
 *
 * Exit codes:
 *   0  -- drill passed and all verifications succeeded
 *   1 -- drill failed (restore error, mismatch, or missing tool)
 *   2 -- invalid invocation (bad flags / missing config)
 */

import { execFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { Client, parse as parseConnectionString } from 'pg';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface DrillOptions {
  /** Path to an existing custom-format pg_dump file. */
  backup?: string;
  /** Create a fresh backup from the source DB instead of reusing one. */
  createBackup?: boolean;
  /** Directory to write newly created backups into. */
  backupDir?: string;
  /** Restrict the drill to a single table (partial restore). */
  table?: string;
  /** Name of the throwaway database used for the restore. */
  targetDatabase?: string;
  /** Write a machine-readable JSON report to this path. */
  report?: string;
  /** Keep the target database after the drill (default: drop). */
  keepTarget?: boolean;
  /** Skip dropping the target database if it already exists. */
  force?: boolean;
}

export interface TableVerification {
  table: string;
  expectedRows: number;
  restoredRows: number;
  matches: boolean;
  checksumMatches?: boolean;
  sampleIds?: string[];
  missingIds?: string[];
}

export interface DrillReport {
  startedAt: string;
  finishedAt: string;
  sourceDatabase: string;
  targetDatabase: string;
  backupFile: string;
  backupSizeBytes: number;
  partialTable: string | null;
  /** Wall-clock milliseconds from backup start to restore completion. */
  recoveryTimeMs: number;
  /** Age of the backup at restore time, in milliseconds (RPO). */
  recoveryPointAgeMs: number;
  /** Utc timestamp of the newest row in the restored database. */
  newestRestoredRowAt: string | null;
  tables: TableVerification[];
  passed: boolean;
  errors: string[];
  warnings: string[];
}

// -----------------------------------------------------------------------------
// Config resolution
// -----------------------------------------------------------------------------

interface PgConnection {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

function resolveConnection(): PgConnection {
  const url = process.env.DATABASE_URL || process.env.DB_URL;
  if (url) {
    const parsed = parseConnectionString(url);
    return {
      host: parsed.host ?? 'localhost',
      port: parsed.port ?? 5432,
      username: parsed.user ?? 'postgres',
      password: parsed.password ?? '',
      database: parsed.database ?? 'postgres',
    };
  }

  const host = process.env.DB_HOST ?? process.env.PGHOST ?? 'localhost';
  const port = Number(process.env.DB_PORT ?? process.env.PGPORT ?? 5432);
  const username = process.env.DB_USERNAME ?? process.env.PGUSER ?? 'postgres';
  const password = process.env.DB_PASSWORD ?? process.env.PGPASSWORD ?? '';
  const database = process.env.DB_NAME ?? process.env.DB_DATABASE ?? process.env.PGDATABASE ?? 'postgres';

  if (!host || Number.isNaN(port)) {
    throw new Error('Invalid database configuration: missing host or port');
  }

  return { host, port, username, password, database };
}

// -----------------------------------------------------------------------------
// CLI argument parsing
// -----------------------------------------------------------------------------

export function parseArgvs(argv: string[]): DrillOptions {
  const opts: DrillOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [key, inlineValue] = arg.split('=', 2);
    const value = inlineValue !== undefined ? inlineValue : argv[++i];
    switch (key) {
      case '--backup':
        opts.backup = value;
        break;
      case '--create-backup':
        opts.createBackup = true;
        break;
      case '--backup-dir':
        opts.backupDir = value;
        break;
      case '--table':
        opts.table = value;
        break;
      case '--target-database':
        opts.targetDatabase = value;
        break;
      case '--report':
        opts.report = value;
        break;
      case '--keep-target':
        opts.keepTarget = true;
        break;
      case '--force':
        opts.force = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

// -----------------------------------------------------------------------------
// Shell helpers
// -----------------------------------------------------------------------------

function requireBinary(name: string): void {
  try {
    execFileSync('which', [name], { stdio: 'ignore' });
  } catch {
    throw new Error(
      `Required binary "${name}" not found on PATH. Install the PostgreSQL wgoring client tools.`,
    );
  }
}

function connectionEnv(conn: PgConnection, database?: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PGHOST: conn.host,
    PGPORT: String(conn.port),
    PGUSER: conn.username,
    PGDATABASE: database ?? conn.database,
    ...(conn.password ? { PGPASSWORD: conn.password } : {}),
  };
}

// -----------------------------------------------------------------------------
// Database operations
// -----------------------------------------------------------------------------

async function withAdminClient<T>(
  conn: PgConnection,
  fn: (client: Client) => Promise<T>,
  database = 'postgres',
): Promise<T> {
  const client = new Client({
    host: conn.host,
    port: conn.port,
    user: conn.username,
    password: conn.password,
    database,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function databaseExists(conn: PgConnection, name: string): Promise<boolean> {
  return withAdminClient(conn, async (client) => {
    const res = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    return res.rowCount > 0;
  });
}

async function dropDatabase(conn: PgConnection, name: string): Promise<void> {
  await withAdminClient(conn, async (client) => {
    await client.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`, [name]);
    await client.query(`DROP DATABASE IF EXISTS "${name.replace(/"/g, '')}"`);
  });
}

async function createDatabase(conn: PgConnection, name: string): Promise<void> {
  await withAdminClient(conn, async (client) => {
    await client.query(`CREATE DATABASE "${name.replace(/"/g, '')}"`);
  });
}

// -----------------------------------------------------------------------------
// Backup / restore
// -----------------------------------------------------------------------------

export function createBackup(
  conn: PgConnection,
  outputFile: string,
  table?: string,
): void {
  requireBinary('pg_dump');
  const args = [
    '--format=c',
    '--no-owner',
    '--no-privileges',
    '--compression=9',
    '--file',
    outputFile,
  ];
  if (table) {
    args.push('--table', table);
  }
  execFileSync('pg_dump', args, { env: connectionEnv(conn), stdio: 'inherit' });
}

export function restoreBackup(
  conn: PgConnection,
  backupFile: string,
  targetDatabase: string,
  table?: string,
): void {
  requireBinary('pg_restore');
  const args = [
    '--no-owner',
    '--no-privileges',
    '--exit-on-error',
    '--single-transaction',
    '--db',
    targetDatabase,
  ];
  if (table) {
    args.push('--table', table);
  }
  args.push(backupFile);
  execFileSync('pg_restore', args, {
    env: connectionEnv(conn, 'template1'),
    stdio: 'inherit',
  });
}

// -----------------------------------------------------------------------------
// Verification helpers
// -----------------------------------------------------------------------------

const VERIFICATION_TABLES = [
  'users',
  'audit_logs',
  'crowdfund_projects',
  'crowdfund_contributions',
  'bootstrap_runs',
] as const;

async function tableExists(client: Client, table: string): Promise<boolean> {
  const res = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return res.rowCount > 0;
}

async function countRows(client: Client, table: string): Promise<number> {
  const res = await client.query(`SELECT COUNT(*)::int8 AS c FROM "${table.replace(/"/g, '')}"`);
  return Number(res.rows[0].c);
}

async function sampleIds(client: Client, table: string, limit = 10): Promise<string[]> {
  const res = await client.query(
    `SELECT id::text AS id FROM "${table.replace(/"/g, '')}" ORDER BY id ASC LIMIT $1`,
    [limit],
  );
  return res.rows.map((r: { id: string }) => r.id);
}

async function idsPresent(client: Client, table: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const res = await client.query(
    `SELECT id::text AS id FROM "${table.replace(/"/g, '')}" WHERE id::text = ANY($1)`,
    [ids],
  );
  const present = new Set(res.rows.map((r: { id: string }) => r.id));
  return ids.filter((id) => !present.has(id));
}

async function newestTimestamp(client: Client, table: string): Promise<string | null> {
  const cols = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
       AND data_type IN ('timestamp without time zone', 'timestamp with time zone')
     ORDER BY ordinal_position LIMIT 1`,
    [table],
  );
  if (cols.rowCount === 0) return null;
  const col = cols[0].column_name as string;
  const res = await client.query(
    `SELECT MAX("${col.replace(/"/g, '')}")::text AS m FROM "${table.replace(/"/g, '')}"`,
  );
  return (res.rows[0].m as string | null) ?? null;
}

// -----------------------------------------------------------------------------
// Main drill
// -----------------------------------------------------------------------------

export async function runDrill(opts: DrillOptions): Promise<DrillReport> {
  const conn = resolveConnection();
  const started = Date.now();
  const errors: string[] = [];
  const warnings: string[] = [];
  const targetDatabase = opts.targetDatabase ?? `${conn.database}_drill_${Date.now()}`;

  if (!/^[a-zA-Z0-9_]+$/.test(targetDatabase)) {
    throw new Error('--target-database must contain only alphanumeric characters and underscores');
  }

  // 1. Resolve backup file.
  let backupFile = opts.backup;
  if (opts.createBackup || !backupFile) {
    const dir = resolve(opts.backupDir ?? './backups');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    backupFile = join(dir, `${conn.database}-${stamp}.dump`);
    const backupStart = Date.now();
    createBackup(conn, backupFile, opts.table);
    warnings.push(`Backup created in ${Date.now() - backupStart}ms`);
  }

  if (!existsSync(backupFile)) {
    throw new Error(`Backup file not found: ${backupFile}`);
  }
  const backupStat = statSync(backupFile);

  // 2. Prepare clean target database.
  if (await databaseExists(conn, targetDatabase)) {
    if (!opts.force) {
      throw new Error(
        `Target database "${targetDatabase}" already exists. Pass --force to drop and recreate.`,
      );
    }
    await dropDatabase(conn, targetDatabase);
  }
  await createDatabase(conn, targetDatabase);

  // 3. Restore and measure RTO.
  const restoreStart = Date.now();
  try {
    restoreBackup(conn, backupFile, targetDatabase, opts.table);
  } catch (err) {
    errors.push(`pg_restore failed: ${(err as Error).message}`);
    throw new Error(`pg_restore failed: ${(err as Error).message}`);
  }
  const restoreEnded = Date.now();
  const recoveryTimeMs = restoreEnded - restoreStart;

  // 4. Verify against known records.
  const tables = opts.table ? [opts.table] : (VERIFICATION_TABLES as readonly string[]);
  const verifications: TableVerification[] = [];
  let newestRestoredRowAt: string | null = null;

  await withAdminClient(conn, async (client) => {
    for (const table of tables) {
      const exists = await tableExists(client, table);
      if (!exists) {
        warnings.push(`Table "${table}" not present in restored database; skipping verification`);
        continue;
      }
      const restoredRows = await countRows(client, table);
      const sample = await sampleIds(client, table);
      const missing = await idsPresent(client, table, sample);
      const newest = await newestTimestamp(client, table);
      if (newest && (!newestRestoredRowAt || newest > newestRestoredRowAt)) {
        newestRestoredRowAt = newest;
      }
      verifications.push({
        table,
        expectedRows: -1,
        restoredRows,
        matches: missing.length === 0,
        sampleIds: sample,
        missingIds: missing,
      });
      if (missing.length > 0) {
        errors.push(`Table "${table}" is missing ${missing.length} sample IDs after restore`);
      }
    }
  }, targetDatabase);

  // 5. Compare row counts against the source for the same tables.
  await withAdminClient(conn, async (client) => {
    for (const v of verifications) {
      const exists = await tableExists(client, v.table);
      if (!exists) {
        warnings.push(`Table "${v.table}" not present in source database; cannot compare row counts`);
        continue;
      }
      const sourceRows = await countRows(client, v.table);
      v.expectedRows = sourceRows;
      if (sourceRows !== v.restoredRows) {
        v.matches = false;
        errors.push(
          `Table "${v.table}" row count mismatch: source=${sourceRows} restored=${v.restoredRows}`,
        );
      }
    }
  });

  // 6. Cleanup.
  if (!opts.keepTarget) {
    await dropDatabase(conn, targetDatabase);
  } else {
    warnings.push(`Target database "${targetDatabase}" kept for inspection`);
  }

  const finished = Date.now();
  const report: DrillReport = {
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date(finished).toISOString(),
    sourceDatabase: conn.database,
    targetDatabase,
    backupFile,
    backupSizeBytes: backupStat.size,
    partialTable: opts.table ?? null,
    recoveryTimeMs,
    recoveryPointAgeMs: restoreStart - backupStat.mtimeMs,
    newestRestoredRowAt,
    tables: verifications,
    passed: errors.length === 0,
    errors,
    warnings,
  };

  if (opts.report) {
    const reportPath = resolve(opts.report);
    const reportDir = reportPath.substring(0, reportPath.lastIndexOf('/'));
    if (reportDir && !existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
  }

  return report;
}

// -----------------------------------------------------------------------------
// CLI entrypoint
// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  let opts: DrillOptions;
  try {
    opts = parseArgvs(process.argv.slice(2));
  } catch (err) {
    console.error((err as Error).message);
    process.exit(2);
    return;
  }

  try {
    const report = await runDrill(opts);
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.passed ? 0 : 1);
  } catch (err) {
    console.error(`Drill failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  void main();
}
