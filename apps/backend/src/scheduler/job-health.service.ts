import { Injectable } from '@nestjs/common';
import { JobHistoryService } from './job-history.service';
import { JOB_REGISTRY, JobDefinition } from './job-registry';

const DEFAULT_GRACE_MULTIPLIER = 1.5;

export type JobHealthState = 'ok' | 'stale' | 'never_run';

export interface JobHealthStatus {
  jobName: string;
  description: string;
  expectedIntervalMs: number;
  staleAfterMs: number;
  state: JobHealthState;
  lastStartedAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastDurationMs: number | null;
  /** How far past the staleness threshold the last success is, in ms. Null when not stale. */
  staleByMs: number | null;
}

export interface JobsHealthReport {
  status: 'healthy' | 'degraded';
  checkedAt: string;
  jobs: JobHealthStatus[];
}

@Injectable()
export class JobHealthService {
  constructor(private readonly jobHistory: JobHistoryService) {}

  async getJobsHealthReport(now: Date = new Date()): Promise<JobsHealthReport> {
    const jobs = await Promise.all(
      JOB_REGISTRY.map((definition) => this.getJobHealth(definition, now)),
    );

    const status = jobs.some((job) => job.state !== 'ok') ? 'degraded' : 'healthy';

    return {
      status,
      checkedAt: now.toISOString(),
      jobs,
    };
  }

  private async getJobHealth(
    definition: JobDefinition,
    now: Date,
  ): Promise<JobHealthStatus> {
    const [lastRun, lastSuccess, lastFailure] = await Promise.all([
      this.jobHistory.getLastRun(definition.name),
      this.jobHistory.getLastSuccessfulRun(definition.name),
      this.jobHistory.getLastFailedRun(definition.name),
    ]);

    const staleAfterMs =
      definition.expectedIntervalMs *
      (definition.graceMultiplier ?? DEFAULT_GRACE_MULTIPLIER);

    let state: JobHealthState;
    let staleByMs: number | null = null;

    if (!lastSuccess) {
      state = 'never_run';
    } else {
      const ageMs = now.getTime() - lastSuccess.finishedAt!.getTime();
      if (ageMs > staleAfterMs) {
        state = 'stale';
        staleByMs = ageMs - staleAfterMs;
      } else {
        state = 'ok';
      }
    }

    return {
      jobName: definition.name,
      description: definition.description,
      expectedIntervalMs: definition.expectedIntervalMs,
      staleAfterMs,
      state,
      lastStartedAt: lastRun?.startedAt?.toISOString() ?? null,
      lastSuccessAt: lastSuccess?.finishedAt?.toISOString() ?? null,
      lastFailureAt: lastFailure?.finishedAt?.toISOString() ?? null,
      lastDurationMs: lastRun?.durationMs ?? null,
      staleByMs,
    };
  }
}
