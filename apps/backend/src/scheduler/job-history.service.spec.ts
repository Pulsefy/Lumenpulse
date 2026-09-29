import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JobRun, JobRunStatus } from './entities/job-run.entity';
import { JobHistoryService } from './job-history.service';
import { MetricsService } from '../metrics/metrics.service';

describe('JobHistoryService', () => {
  let service: JobHistoryService;
  let repo: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
  };
  let metrics: { recordSchedulerJobOutcome: jest.Mock };

  beforeEach(async () => {
    repo = {
      create: jest.fn((data: Partial<JobRun>) => ({
        ...data,
        startedAt: new Date('2026-08-27T01:00:00.000Z'),
      })),
      save: jest.fn((run: JobRun) => Promise.resolve(run)),
      find: jest.fn(),
      findOne: jest.fn(),
    };
    metrics = { recordSchedulerJobOutcome: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobHistoryService,
        { provide: getRepositoryToken(JobRun), useValue: repo },
        { provide: MetricsService, useValue: metrics },
      ],
    }).compile();

    service = module.get<JobHistoryService>(JobHistoryService);
    jest.clearAllMocks();
  });

  it('records a running outcome when a run starts', async () => {
    await service.start('reconciliation');
    expect(metrics.recordSchedulerJobOutcome).toHaveBeenCalledWith(
      'reconciliation',
      'running',
      null,
      expect.any(Date),
    );
  });

  it('records a completed outcome with duration and start timestamp', async () => {
    const run = await service.start('reconciliation');
    await service.complete(run, { rows: 42 });

    expect(metrics.recordSchedulerJobOutcome).toHaveBeenLastCalledWith(
      'reconciliation',
      'completed',
      expect.any(Number),
      expect.any(Date),
    );
    expect(run.status).toBe(JobRunStatus.COMPLETED);
    expect(run.result).toEqual({ rows: 42 });
  });

  it('records a failed outcome with the error message', async () => {
    const run = await service.start('reconciliation');
    await service.fail(run, new Error('boom'));

    expect(metrics.recordSchedulerJobOutcome).toHaveBeenLastCalledWith(
      'reconciliation',
      'failed',
      expect.any(Number),
      expect.any(Date),
    );
    expect(run.status).toBe(JobRunStatus.FAILED);
    expect(run.errorMessage).toBe('boom');
  });

  it('records a skipped outcome when markSkipped is called', async () => {
    await service.markSkipped('reconciliation');
    expect(metrics.recordSchedulerJobOutcome).toHaveBeenCalledWith(
      'reconciliation',
      'skipped',
      0,
      expect.any(Date),
    );
  });

  it('getLastSuccess() queries for the most recent COMPLETED run', async () => {
    repo.findOne.mockResolvedValue({ jobName: 'reconciliation' });
    await service.getLastSuccess('reconciliation');

    expect(repo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobName: 'reconciliation', status: JobRunStatus.COMPLETED },
        order: { startedAt: 'DESC' },
      }),
    );
  });

  it('getLastFailure() queries for the most recent FAILED run', async () => {
    repo.findOne.mockResolvedValue({ jobName: 'reconciliation' });
    await service.getLastFailure('reconciliation');

    expect(repo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobName: 'reconciliation', status: JobRunStatus.FAILED },
        order: { startedAt: 'DESC' },
      }),
    );
  });
});
