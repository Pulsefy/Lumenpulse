import { AuditRetentionScheduler } from './audit-retention.scheduler';
import { AuditRetentionService } from './audit-retention.service';
import { JobLockService } from '../../scheduler/job-lock.service';
import { JobHistoryService } from '../../scheduler/job-history.service';

describe('AuditRetentionScheduler', () => {
  let retention: { run: jest.Mock };
  let jobLock: { tryAcquire: jest.Mock; release: jest.Mock };
  let jobHistory: {
    start: jest.Mock;
    complete: jest.Mock;
    fail: jest.Mock;
    markSkipped: jest.Mock;
  };
  let scheduler: AuditRetentionScheduler;
  const run = { id: 'run-1' };

  beforeEach(() => {
    retention = { run: jest.fn().mockResolvedValue([]) };
    jobLock = {
      tryAcquire: jest.fn().mockResolvedValue(true),
      release: jest.fn().mockResolvedValue(undefined),
    };
    jobHistory = {
      start: jest.fn().mockResolvedValue(run),
      complete: jest.fn(),
      fail: jest.fn(),
      markSkipped: jest.fn(),
    };
    scheduler = new AuditRetentionScheduler(
      retention as unknown as AuditRetentionService,
      jobLock as unknown as JobLockService,
      jobHistory as unknown as JobHistoryService,
    );
  });

  afterEach(() => {
    delete process.env['AUDIT_RETENTION_ENABLED'];
  });

  it('runs retention under the job lock and records the result', async () => {
    await scheduler.handleRetention();

    expect(retention.run).toHaveBeenCalled();
    expect(jobHistory.complete).toHaveBeenCalledWith(run, { results: [] });
    expect(jobLock.release).toHaveBeenCalledWith('audit-retention');
  });

  it('skips when another instance holds the lock', async () => {
    jobLock.tryAcquire.mockResolvedValue(false);

    await scheduler.handleRetention();

    expect(retention.run).not.toHaveBeenCalled();
    expect(jobHistory.markSkipped).toHaveBeenCalledWith('audit-retention');
  });

  it('records a failure without throwing and releases the lock', async () => {
    const error = new Error('db down');
    retention.run.mockRejectedValue(error);

    await expect(scheduler.handleRetention()).resolves.toBeUndefined();

    expect(jobHistory.fail).toHaveBeenCalledWith(run, error);
    expect(jobLock.release).toHaveBeenCalled();
  });

  it('does nothing when disabled', async () => {
    process.env['AUDIT_RETENTION_ENABLED'] = 'false';

    await scheduler.handleRetention();

    expect(jobLock.tryAcquire).not.toHaveBeenCalled();
    expect(retention.run).not.toHaveBeenCalled();
  });
});
