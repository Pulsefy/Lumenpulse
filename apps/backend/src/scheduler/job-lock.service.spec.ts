import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { JobLockService } from './job-lock.service';
import { MetricsService } from '../metrics/metrics.service';

describe('JobLockService', () => {
  let service: JobLockService;
  let dataSource: { query: jest.Mock };
  let metrics: { recordJobLockContention: jest.Mock };

  beforeEach(async () => {
    dataSource = { query: jest.fn() };
    metrics = { recordJobLockContention: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobLockService,
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: MetricsService, useValue: metrics },
      ],
    }).compile();

    service = module.get<JobLockService>(JobLockService);
  });

  it('does not record contention when the lock is acquired', async () => {
    dataSource.query.mockResolvedValue([{ pg_try_advisory_lock: true }]);

    const acquired = await service.tryAcquire('reconciliation');

    expect(acquired).toBe(true);
    expect(metrics.recordJobLockContention).not.toHaveBeenCalled();
  });

  it('records contention when another instance already holds the lock', async () => {
    dataSource.query.mockResolvedValue([{ pg_try_advisory_lock: false }]);

    const acquired = await service.tryAcquire('reconciliation');

    expect(acquired).toBe(false);
    expect(metrics.recordJobLockContention).toHaveBeenCalledWith('reconciliation');
  });
});
