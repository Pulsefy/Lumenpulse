/**
 * Static registry of all recurring scheduled jobs and how often they are
 * expected to succeed.
 *
 * `JobHealthService` uses this to decide whether a job's last successful
 * run is recent enough, without hard-coding schedule knowledge into the
 * health-check logic itself. When a new `@Cron` job is added, register it
 * here so it shows up in `/health/jobs`.
 */
export interface JobDefinition {
  /** Must match the JOB_NAME constant used by the corresponding scheduler. */
  name: string;
  description: string;
  /** How often the job is expected to run successfully, in milliseconds. */
  expectedIntervalMs: number;
  /**
   * Multiplier applied to `expectedIntervalMs` before a missed success is
   * treated as staleness. Absorbs normal jitter (slow runs, brief instance
   * restarts) without false-positiving on every run. Defaults to 1.5.
   */
  graceMultiplier?: number;
}

const HOUR_MS = 60 * 60 * 1000;

export const JOB_REGISTRY: readonly JobDefinition[] = [
  {
    name: 'reconciliation',
    description: 'Drift reconciliation sweep',
    expectedIntervalMs: 6 * HOUR_MS,
  },
  {
    name: 'model-retraining-daily',
    description: 'Daily ML model retraining fallback trigger',
    expectedIntervalMs: 24 * HOUR_MS,
  },
  {
    name: 'daily-snapshot',
    description: 'Nightly analytics snapshot generation',
    expectedIntervalMs: 24 * HOUR_MS,
  },
  {
    name: 'idempotency-cleanup',
    description: 'Expired idempotency record cleanup',
    expectedIntervalMs: 24 * HOUR_MS,
  },
  {
    name: 'contract-health-snapshot',
    description: 'Periodic contract reachability snapshot',
    expectedIntervalMs: 0.5 * HOUR_MS,
  },
  {
    name: 'read-model-rebuild-cleanup',
    description: 'Daily cleanup of old read-model rebuild job records',
    expectedIntervalMs: 24 * HOUR_MS,
  },
  {
    name: 'read-model-rebuild-stuck-recovery',
    description: 'Hourly recovery sweep for stuck read-model rebuild jobs',
    expectedIntervalMs: HOUR_MS,
  },
] as const;

export function getJobDefinition(jobName: string): JobDefinition | undefined {
  return JOB_REGISTRY.find((job) => job.name === jobName);
}
