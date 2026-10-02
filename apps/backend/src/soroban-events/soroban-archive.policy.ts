/**
 * Retention policy for `soroban_events`. See SOROBAN_EVENT_ARCHIVAL.md.
 *
 * Rows are eligible for archival when their `ledgerSequence` is strictly
 * less than `latestLedger - hotWindowLedgers`. Rows with a NULL
 * `ledgerSequence` are never archived (they may be mid-ingestion).
 *
 * If `retentionDays > 0`, an additional guard requires `createdAt` to be
 * older than `now - retentionDays`. This is useful for teams that backfill
 * historical ledgers and want to avoid archiving a row seconds after it was
 * ingested. Set to 0 to disable.
 */

export interface SorobanArchivePolicy {
  enabled: boolean;
  cron: string;
  hotWindowLedgers: number;
  retentionDays: number;
  batchSize: number;
  maxBatchesPerRun: number;
}

const DEFAULTS = {
  // ~30 days at 5s/ledger. Testnet produces ~17k ledgers/day.
  HOT_WINDOW_LEDGERS: 172_800,
  RETENTION_DAYS: 0,
  BATCH_SIZE: 5_000,
  MAX_BATCHES: 200,
  CRON: '0 4 * * *',
};

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === '') return fallback;
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes' || v === 'on') return true;
  if (v === 'false' || v === '0' || v === 'no' || v === 'off') return false;
  throw new Error(`SOROBAN_ARCHIVE_ENABLED must be boolean, got "${raw}"`);
}

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  name: string,
  allowZero = false,
): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  const min = allowZero ? 0 : 1;
  if (!Number.isInteger(n) || n < min) {
    throw new Error(`${name} must be an integer >= ${min}, got "${raw}"`);
  }
  return n;
}

export function buildSorobanArchivePolicy(
  env: NodeJS.ProcessEnv = process.env,
): SorobanArchivePolicy {
  return {
    enabled: parseBool(env.SOROBAN_ARCHIVE_ENABLED, true),
    cron: env.SOROBAN_ARCHIVE_CRON?.trim() || DEFAULTS.CRON,
    hotWindowLedgers: parsePositiveInt(
      env.SOROBAN_HOT_WINDOW_LEDGERS,
      DEFAULTS.HOT_WINDOW_LEDGERS,
      'SOROBAN_HOT_WINDOW_LEDGERS',
    ),
    retentionDays: parsePositiveInt(
      env.SOROBAN_ARCHIVE_RETENTION_DAYS,
      DEFAULTS.RETENTION_DAYS,
      'SOROBAN_ARCHIVE_RETENTION_DAYS',
      true,
    ),
    batchSize: parsePositiveInt(
      env.SOROBAN_ARCHIVE_BATCH_SIZE,
      DEFAULTS.BATCH_SIZE,
      'SOROBAN_ARCHIVE_BATCH_SIZE',
    ),
    maxBatchesPerRun: parsePositiveInt(
      env.SOROBAN_ARCHIVE_MAX_BATCHES,
      DEFAULTS.MAX_BATCHES,
      'SOROBAN_ARCHIVE_MAX_BATCHES',
    ),
  };
}

/** Exclusive cutoff: rows with `ledgerSequence < cutoff` are eligible. */
export function hotWindowCutoff(
  latestLedger: number,
  hotWindowLedgers: number,
): number {
  return latestLedger - hotWindowLedgers;
}

/** Exclusive cutoff for the optional `createdAt` guard. */
export function createdAtCutoff(
  now: Date,
  retentionDays: number,
): Date | null {
  if (retentionDays <= 0) return null;
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}
