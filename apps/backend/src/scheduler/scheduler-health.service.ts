import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { JobHistoryService } from './job-history.service';
import { SCHEDULED_JOBS } from './job-registry';
import { classifyQueueHealth } from '../queue/queue-health.util';
import { CONTRIBUTION_QUEUE } from '../suspicious-contribution/types';
import { SOROBAN_EVENTS_QUEUE } from '../soroban-events/soroban-events.service';

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
  /** ISO timestamp of when the job is next expected to run, or null. */
  nextRunAt: string | null;
  /** Duration in milliseconds of the most recent completed run, or null. */
  lastDurationMs: number | null;
  /** Expected maximum interval between successful runs. */
  expectedIntervalMs: number;
  /** True when the job has not succeeded within its expected interval. */
  stale: boolean;
  /** Machine-readable reason for staleness, or null when healthy. */
  staleReason: 'never-succeeded' | 'last-success-too-old' | null;
}

export interface QueueHealthMetric {
  name: string;
  depth: number;
  oldestJobAgeMs: number;
  status: 'healthy' | 'backlogged' | 'stalled';
  reason: string;
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

  constructor(
    private readonly jobHistory: JobHistoryService,
    @InjectQueue('stellar-sync') private readonly stellarSyncQueue: Queue,
    @InjectQueue('moderation-events')
    private readonly moderationEventsQueue: Queue,
    @InjectQueue(SOROBAN_EVENTS_QUEUE)
    private readonly sorobanEventsQueue: Queue,
    @InjectQueue(CONTRIBUTION_QUEUE)
    private readonly suspiciousContributionQueue: Queue,
  ) {}

  /** Status summary for every registered scheduled job. */
  async getJobStatuses(now: Date = new Date()): Promise<SchedulerJobStatus[]> {
    const statuses = await Promise.all(
      SCHEDULED_JOBS.map(async (job) => {
        const [lastRun, lastSuccess, lastFailure] = await Promise.all([
          this.jobHistory.getLastRun(job.name),
          this.jobHistory.getLastSuccess(job.name),
          this.jobHistory.getLastFailure(job.name),
        ]);

        const lastSuccessAt = lastSuccess ? lastSuccess.startedAt : null;
        const { stale, reason } = isJobStale(
          lastSuccessAt,
          job.expectedIntervalMs,
          now,
        );
        const lastCompletedAt = lastSuccessAt ?? lastFailure?.startedAt ?? null;
        const nextRunAt = lastCompletedAt
          ? new Date(
              lastCompletedAt.getTime() + job.expectedIntervalMs,
            ).toISOString()
          : null;

        return {
          job: job.name,
          description: job.description,
          lastStart: lastRun ? lastRun.startedAt.toISOString() : null,
          lastSuccess: lastSuccess ? lastSuccess.startedAt.toISOString() : null,
          lastFailure: lastFailure ? lastFailure.startedAt.toISOString() : null,
          nextRunAt,
          lastDurationMs: lastRun?.durationMs ?? null,
          expectedIntervalMs: job.expectedIntervalMs,
          stale,
          staleReason: stale ? reason : null,
        };
      }),
    );

    return statuses;
  }

  async getQueueStatuses(): Promise<QueueHealthMetric[]> {
    const knownQueues = [
      { name: 'stellar-sync', queue: this.stellarSyncQueue },
      { name: 'moderation-events', queue: this.moderationEventsQueue },
      { name: SOROBAN_EVENTS_QUEUE, queue: this.sorobanEventsQueue },
      { name: CONTRIBUTION_QUEUE, queue: this.suspiciousContributionQueue },
    ];

    const queueStatuses = await Promise.all(
      knownQueues.map(async ({ name, queue }) => {
        const counts = await queue.getJobCounts('waiting', 'delayed');
        const waitingJobs = await queue.getWaiting(0, 100);
        const delayedJobs = await queue.getDelayed(0, 100);
        const jobs = [...waitingJobs, ...delayedJobs];

        const depth = (counts.waiting ?? 0) + (counts.delayed ?? 0);
        const oldestJobAgeMs = jobs.length
          ? Math.max(
              0,
              Date.now() -
                Math.min(
                  ...jobs
                    .map((job) => Number(job.timestamp ?? Date.now()))
                    .filter((value) => Number.isFinite(value)),
                ),
            )
          : 0;

        const health = classifyQueueHealth(depth, oldestJobAgeMs);

        return {
          name,
          depth,
          oldestJobAgeMs,
          status: health.status,
          reason: health.reason,
        };
      }),
    );

    return queueStatuses;
  }

  /** Only the jobs that have not succeeded within their expected interval. */
  async getStaleJobs(now?: Date): Promise<SchedulerJobStatus[]> {
    const statuses = await this.getJobStatuses(now);
    return statuses.filter((status) => status.stale);
  }
}
