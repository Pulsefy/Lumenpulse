import { Test, TestingModule } from '@nestjs/testing';
import { JobRun, JobRunStatus } from './entities/job-run.entity';
import { JobHistoryService } from './job-history.service';
import { SchedulerHealthService, isJobStale } from './scheduler-health.service';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

describe('isJobStale (stale-job detection boundary)', () => {
  const now = new Date('2026-08-27T12:00:00.000Z');

  it('is not stale when the last success is more recent than the interval', () => {
    const lastSuccess = new Date(now.getTime() - SIX_HOURS_MS + 60_000);
    expect(isJobStale(lastSuccess, SIX_HOURS_MS, now)).toEqual({
      stale: false,
      reason: null,
    });
  });

  it('is not stale when the last success is exactly at the interval boundary', () => {
    // Boundary rule: exactly `now - interval` is still healthy, so transient
    // scheduling jitter never trips the check.
    const lastSuccess = new Date(now.getTime() - SIX_HOURS_MS);
    expect(isJobStale(lastSuccess, SIX_HOURS_MS, now)).toEqual({
      stale: false,
      reason: null,
    });
  });

  it('is stale when the last success is just beyond the interval boundary', () => {
    const lastSuccess = new Date(now.getTime() - SIX_HOURS_MS - 1);
    expect(isJobStale(lastSuccess, SIX_HOURS_MS, now)).toEqual({
      stale: true,
      reason: 'last-success-too-old',
    });
  });

  it('is stale when the job has never succeeded', () => {
    expect(isJobStale(null, SIX_HOURS_MS, now)).toEqual({
      stale: true,
      reason: 'never-succeeded',
    });
  });
});

describe('SchedulerHealthService', () => {
  let service: SchedulerHealthService;
  let jobHistory: {
    getLastRun: jest.Mock;
    getLastSuccess: jest.Mock;
    getLastFailure: jest.Mock;
  };

  const now = new Date('2026-08-27T12:00:00.000Z');

  const makeRun = (
    jobName: string,
    status: JobRunStatus,
    startedAt: Date,
    durationMs: number | null = 1000,
  ): JobRun =>
    ({
      id: 'uuid',
      jobName,
      status,
      startedAt,
      finishedAt: startedAt,
      durationMs,
      triggeredBy: 'scheduled',
      result: null,
      errorMessage: null,
    }) as JobRun;

  beforeEach(async () => {
    jobHistory = {
      getLastRun: jest.fn(),
      getLastSuccess: jest.fn(),
      getLastFailure: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchedulerHealthService,
        { provide: JobHistoryService, useValue: jobHistory },
      ],
    }).compile();

    service = module.get<SchedulerHealthService>(SchedulerHealthService);
    jest.clearAllMocks();
  });

  it('reports last start, last success, last failure, and duration per job', async () => {
    jobHistory.getLastRun.mockResolvedValue(
      makeRun(
        'reconciliation',
        JobRunStatus.COMPLETED,
        new Date(now.getTime() - 1000),
        42_000,
      ),
    );
    jobHistory.getLastSuccess.mockResolvedValue(
      makeRun(
        'reconciliation',
        JobRunStatus.COMPLETED,
        new Date(now.getTime() - 1000),
        42_000,
      ),
    );
    jobHistory.getLastFailure.mockResolvedValue(
      makeRun(
        'reconciliation',
        JobRunStatus.FAILED,
        new Date(now.getTime() - SIX_HOURS_MS - 60_000),
        5000,
      ),
    );

    const statuses = await service.getJobStatuses(now);
    const reconciliation = statuses.find((s) => s.job === 'reconciliation');

    expect(reconciliation).toMatchObject({
      job: 'reconciliation',
      lastStart: new Date(now.getTime() - 1000).toISOString(),
      lastSuccess: new Date(now.getTime() - 1000).toISOString(),
      lastFailure: new Date(
        now.getTime() - SIX_HOURS_MS - 60_000,
      ).toISOString(),
      lastDurationMs: 42_000,
      expectedIntervalMs: SIX_HOURS_MS,
      stale: false,
      staleReason: null,
    });
  });

  it('marks a job stale when its last success is older than its interval', async () => {
    jobHistory.getLastRun.mockResolvedValue(
      makeRun(
        'reconciliation',
        JobRunStatus.FAILED,
        new Date(now.getTime() - SIX_HOURS_MS - 60_000),
        5000,
      ),
    );
    jobHistory.getLastSuccess.mockResolvedValue(
      makeRun(
        'reconciliation',
        JobRunStatus.COMPLETED,
        new Date(now.getTime() - SIX_HOURS_MS - 60_000),
      ),
    );
    jobHistory.getLastFailure.mockResolvedValue(
      makeRun(
        'reconciliation',
        JobRunStatus.FAILED,
        new Date(now.getTime() - SIX_HOURS_MS - 60_000),
      ),
    );

    const statuses = await service.getJobStatuses(now);
    const reconciliation = statuses.find((s) => s.job === 'reconciliation');

    expect(reconciliation).toMatchObject({
      stale: true,
      staleReason: 'last-success-too-old',
    });
  });

  it('marks a job stale when it has only ever failed (never succeeded)', async () => {
    jobHistory.getLastRun.mockResolvedValue(
      makeRun(
        'daily-snapshot',
        JobRunStatus.FAILED,
        new Date(now.getTime() - 60_000),
      ),
    );
    jobHistory.getLastSuccess.mockResolvedValue(null);
    jobHistory.getLastFailure.mockResolvedValue(
      makeRun(
        'daily-snapshot',
        JobRunStatus.FAILED,
        new Date(now.getTime() - 60_000),
      ),
    );

    const statuses = await service.getJobStatuses(now);
    const snapshot = statuses.find((s) => s.job === 'daily-snapshot');

    expect(snapshot).toMatchObject({
      job: 'daily-snapshot',
      stale: true,
      staleReason: 'never-succeeded',
    });
  });

  it('reports null run times for a job that has never run', async () => {
    jobHistory.getLastRun.mockResolvedValue(null);
    jobHistory.getLastSuccess.mockResolvedValue(null);
    jobHistory.getLastFailure.mockResolvedValue(null);

    const statuses = await service.getJobStatuses(now);
    const snapshot = statuses.find((s) => s.job === 'daily-snapshot');

    expect(snapshot).toMatchObject({
      lastStart: null,
      lastSuccess: null,
      lastFailure: null,
      lastDurationMs: null,
      stale: true,
      staleReason: 'never-succeeded',
    });
  });

  it('getStaleJobs() returns only the jobs whose success predates their interval', async () => {
    // Last success 12h ago: stale for the 6h reconciliation job, healthy for
    // the 24h snapshot/retraining jobs.
    const lastSuccess = new Date(now.getTime() - 12 * 60 * 60 * 1000);
    jobHistory.getLastRun.mockResolvedValue(
      makeRun('reconciliation', JobRunStatus.COMPLETED, lastSuccess),
    );
    jobHistory.getLastSuccess.mockResolvedValue(
      makeRun('reconciliation', JobRunStatus.COMPLETED, lastSuccess),
    );
    jobHistory.getLastFailure.mockResolvedValue(null);

    const stale = await service.getStaleJobs(now);

    expect(stale.map((s) => s.job)).toEqual(['reconciliation']);
    expect(stale.every((s) => s.stale)).toBe(true);
  });
});
