/**
 * Registry of scheduled backend jobs that are tracked in the `job_runs`
 * table via `JobHistoryService`.
 *
 * The expected interval is used by the scheduler health endpoint to decide
 * whether a job is *stale* — i.e. it has not succeeded within the time it is
 * supposed to run. Intervals must match the cron cadence of the corresponding
 * `@Cron` decorator.
 */
export interface ScheduledJobDefinition {
  /** Logical job name as recorded in `job_runs.jobName`. */
  name: string;
  /** Maximum acceptable time between successful runs, in milliseconds. */
  expectedIntervalMs: number;
  /** Human-readable description shown in health payloads. */
  description: string;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const SCHEDULED_JOBS: ScheduledJobDefinition[] = [
  {
    name: 'reconciliation',
    expectedIntervalMs: 6 * HOUR_MS,
    description:
      'Reconciles on-chain state with the local database every 6 hours.',
  },
  {
    name: 'daily-snapshot',
    expectedIntervalMs: DAY_MS,
    description:
      'Aggregates yesterday data into the daily snapshot every 24 hours.',
  },
  {
    name: 'model-retraining-daily',
    expectedIntervalMs: DAY_MS,
    description: 'Triggers the daily model retraining fallback every 24 hours.',
  },
];

/** Look up a job definition by name. */
export function getJobDefinition(
  jobName: string,
): ScheduledJobDefinition | undefined {
  return SCHEDULED_JOBS.find((job) => job.name === jobName);
}
