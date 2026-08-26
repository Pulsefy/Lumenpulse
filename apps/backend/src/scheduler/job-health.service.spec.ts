import { Test, TestingModule } from '@nestjs/testing';
import { JobHealthService } from './job-health.service';
import { JobHistoryService } from './job-history.service';
import { JobRun, JobRunStatus } from './entities/job-run.entity';
import { JOB_REGISTRY } from './job-registry';

function makeRun(overrides: Partial<JobRun> = {}): JobRun {
  return {
    id: 'run-1',
    jobName: 'reconciliation',
    status: JobRunStatus.COMPLETED,
    triggeredBy: 'scheduled',
    result: null,
    errorMessage: null,
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
    finishedAt: new Date('2026-01-01T00:00:00.000Z'),
    durationMs: 1000,
    ...overrides,
  } as JobRun;
}

describe('JobHealthService', () => {
  let service: JobHealthService;
  let jobHistory: {
    getLastRun: jest.Mock;
    getLastSuccessfulRun: jest.Mock;
    getLastFailedRun: jest.Mock;
  };

  // reconciliation's expected interval is 6h with the default 1.5x grace
  // multiplier, so its staleness threshold is 9h.
  const reconciliationDef = JOB_REGISTRY.find(
    (job) => job.name === 'reconciliation',
  )!;
  const staleAfterMs =
    reconciliationDef.expectedIntervalMs * (reconciliationDef.graceMultiplier ?? 1.5);

  beforeEach(async () => {
    jobHistory = {
      getLastRun: jest.fn().mockResolvedValue(null),
      getLastSuccessfulRun: jest.fn().mockResolvedValue(null),
      getLastFailedRun: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobHealthService,
        { provide: JobHistoryService, useValue: jobHistory },
      ],
    }).compile();

    service = module.get<JobHealthService>(JobHealthService);
  });

  it('marks a job as never_run when it has no successful run on record', async () => {
    const report = await service.getJobsHealthReport(new Date('2026-01-02T00:00:00.000Z'));

    const reconciliation = report.jobs.find((j) => j.jobName === 'reconciliation');
    expect(reconciliation!.state).toBe('never_run');
    expect(report.status).toBe('degraded');
  });

  it('marks a job as ok exactly at the staleness threshold (boundary, inclusive)', async () => {
    const lastSuccessAt = new Date('2026-01-01T00:00:00.000Z');
    const now = new Date(lastSuccessAt.getTime() + staleAfterMs);

    jobHistory.getLastSuccessfulRun.mockImplementation(async (jobName: string) =>
      jobName === 'reconciliation'
        ? makeRun({ finishedAt: lastSuccessAt })
        : null,
    );

    const report = await service.getJobsHealthReport(now);
    const reconciliation = report.jobs.find((j) => j.jobName === 'reconciliation');

    expect(reconciliation!.state).toBe('ok');
    expect(reconciliation!.staleByMs).toBeNull();
  });

  it('marks a job as stale one millisecond past the staleness threshold', async () => {
    const lastSuccessAt = new Date('2026-01-01T00:00:00.000Z');
    const now = new Date(lastSuccessAt.getTime() + staleAfterMs + 1);

    jobHistory.getLastSuccessfulRun.mockImplementation(async (jobName: string) =>
      jobName === 'reconciliation'
        ? makeRun({ finishedAt: lastSuccessAt })
        : null,
    );

    const report = await service.getJobsHealthReport(now);
    const reconciliation = report.jobs.find((j) => j.jobName === 'reconciliation');

    expect(reconciliation!.state).toBe('stale');
    expect(reconciliation!.staleByMs).toBe(1);
    expect(report.status).toBe('degraded');
  });

  it('marks a job as ok one millisecond before the staleness threshold', async () => {
    const lastSuccessAt = new Date('2026-01-01T00:00:00.000Z');
    const now = new Date(lastSuccessAt.getTime() + staleAfterMs - 1);

    jobHistory.getLastSuccessfulRun.mockImplementation(async (jobName: string) =>
      jobName === 'reconciliation'
        ? makeRun({ finishedAt: lastSuccessAt })
        : null,
    );

    const report = await service.getJobsHealthReport(now);
    const reconciliation = report.jobs.find((j) => j.jobName === 'reconciliation');

    expect(reconciliation!.state).toBe('ok');
  });

  it('reports overall status healthy only when every registered job is ok', async () => {
    const now = new Date('2026-01-01T01:00:00.000Z');
    jobHistory.getLastSuccessfulRun.mockResolvedValue(
      makeRun({ finishedAt: now }),
    );

    const report = await service.getJobsHealthReport(now);

    expect(report.jobs).toHaveLength(JOB_REGISTRY.length);
    expect(report.jobs.every((j) => j.state === 'ok')).toBe(true);
    expect(report.status).toBe('healthy');
  });
});
