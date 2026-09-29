import { Injectable, Logger } from '@nestjs/common';
import { JobHistoryService } from './job-history.service';
import { SCHEDULED_JOBS } from './job-registry';

/** Per-job status summary surfaced by the scheduler health endpoint. */
export interface SchedulerJobStatus {
  job: string;
  description: string;
  /** ISO timestamp of the most recent run start, or null if never run. */
  lastStart: string | null;
  /** ISO timestamp of the most recent successful run, or null. */
  lastSuccess: string | null;
  /** ISO timestamp of the most recent failed run, or null. */
  lastFailure: string | null;
  /** Duration in milliseconds of the most recent completed run, or null. */
  lastDurationMs: number | null;
  /** Expected maximum interval between successful runs. */
  expectedIntervalMs: number;
  /** True when the job has not succeeded within its expected interval. */
  stale: boolean;
  /** Machine-readable reason for staleness, or null when healthy. */
  staleReason: 'never-succeeded' | 'last-success-too-old' | null;
}

/**
 * Decide whether a job is stale.
 *
 * Boundary rule: a job is stale when its last success is *strictly older* than
 * the expected interval. A run that succeeded exactly at the interval boundary
 * (i.e. `lastSuccessAt === now - expectedIntervalMs`) is still considered
 * healthy, so transient scheduling jitter never trips the check.
 */
export function isJobStale(
  lastSuccessAt: Date | null,
  expectedIntervalMs: number,
  now: Date = new Date(),
): { stale: boolean; reason: SchedulerJobStatus['staleReason'] } {
  if (lastSuccessAt === null) {
    return { stale: true, reason: 'never-succeeded' };
  }
  const cutoff = now.getTime() - expectedIntervalMs;
  if (lastSuccessAt.getTime() < cutoff) {
    return { stale: true, reason: 'last-success-too-old' };
  }
  return { stale: false, reason: null };
}

/**
 * Unified visibility into the backend's scheduled jobs: last run times,
 * outcomes, durations, and staleness relative to each job's expected interval.
 *
 * Consumed by the `GET /health/schedulers` endpoint and by operators
 * investigating multi-instance lock contention.
 */
@Injectable()
export class SchedulerHealthService {
  private readonly logger = new Logger(SchedulerHealthService.name);

  constructor(private readonly jobHistory: JobHistoryService) {}

  /** Status summary for every registered scheduled job. */
  async getJobStatuses(now: Date = new Date()): Promise<SchedulerJobStatus[]> {
    const statuses = await Promise.all(
      SCHEDULED_JOBS.map(async (job) => {
        const [lastRun, lastSuccess, lastFailure] = await Promise.all([
          this.jobHistory.getLastRun(job.name),
          this.jobHistory.getLastSuccess(job.name),
          this.jobHistory.getLastFailure(job.name),
        ]);

        const { stale, reason } = isJobStale(
          lastSuccess ? lastSuccess.startedAt : null,
          job.expectedIntervalMs,
          now,
        );

        return {
          job: job.name,
          description: job.description,
          lastStart: lastRun ? lastRun.startedAt.toISOString() : null,
          lastSuccess: lastSuccess ? lastSuccess.startedAt.toISOString() : null,
          lastFailure: lastFailure ? lastFailure.startedAt.toISOString() : null,
          lastDurationMs: lastRun?.durationMs ?? null,
          expectedIntervalMs: job.expectedIntervalMs,
          stale,
          staleReason: stale ? reason : null,
        };
      }),
    );

    return statuses;
  }

  /** Only the jobs that have not succeeded within their expected interval. */
  async getStaleJobs(now?: Date): Promise<SchedulerJobStatus[]> {
    const statuses = await this.getJobStatuses(now);
    return statuses.filter((status) => status.stale);
  }
}
