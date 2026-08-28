import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditScheduler } from './audit.scheduler';
import { AuditService } from './audit.service';
import { AdminBlockchainAuditLog } from '../admin-audit/entities/admin-blockchain-audit-log.entity';
import { JobLockService } from '../scheduler/job-lock.service';
import { JobHistoryService } from '../scheduler/job-history.service';
import { config } from '../lib/config';
import type { JobRun } from '../scheduler/entities/job-run.entity';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1_000;

/** Stub JobRun with just enough shape for the service calls. */
const stubRun = (): Partial<JobRun> => ({
  id: 'run-1',
  jobName: 'test',
  startedAt: new Date(),
});

// ---------------------------------------------------------------------------
// Mock factory — reset between tests
// ---------------------------------------------------------------------------

const makeMocks = () => {
  const auditService = {
    deleteOlderThan: jest.fn().mockResolvedValue(10),
  };

  const adminAuditRepo = {
    createQueryBuilder: jest.fn(),
  };

  // Build a chainable query-builder stub
  const qb = {
    delete: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 5 }),
  };
  adminAuditRepo.createQueryBuilder.mockReturnValue(qb);

  const jobLock = {
    tryAcquire: jest.fn().mockResolvedValue(true),
    release: jest.fn().mockResolvedValue(undefined),
  };

  const run = stubRun() as JobRun;
  const jobHistory = {
    start: jest.fn().mockResolvedValue(run),
    complete: jest.fn().mockResolvedValue(undefined),
    fail: jest.fn().mockResolvedValue(undefined),
    markSkipped: jest.fn().mockResolvedValue(undefined),
  };

  return { auditService, adminAuditRepo, qb, jobLock, jobHistory, run };
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('AuditScheduler', () => {
  let scheduler: AuditScheduler;
  let mocks: ReturnType<typeof makeMocks>;

  beforeEach(async () => {
    mocks = makeMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditScheduler,
        { provide: AuditService, useValue: mocks.auditService },
        {
          provide: getRepositoryToken(AdminBlockchainAuditLog),
          useValue: mocks.adminAuditRepo,
        },
        { provide: JobLockService, useValue: mocks.jobLock },
        { provide: JobHistoryService, useValue: mocks.jobHistory },
      ],
    }).compile();

    scheduler = module.get<AuditScheduler>(AuditScheduler);
  });

  afterEach(() => jest.clearAllMocks());

  // -------------------------------------------------------------------------
  // handleAuditLogCleanup
  // -------------------------------------------------------------------------

  describe('handleAuditLogCleanup()', () => {
    it('acquires lock before purging audit_logs', async () => {
      await scheduler.handleAuditLogCleanup();
      expect(mocks.jobLock.tryAcquire).toHaveBeenCalledWith(
        'audit-log-cleanup',
      );
    });

    it('calls AuditService.deleteOlderThan when lock is acquired', async () => {
      await scheduler.handleAuditLogCleanup();
      expect(mocks.auditService.deleteOlderThan).toHaveBeenCalledTimes(1);
    });

    it('passes cutoff within 1 second of (now - retentionDays)', async () => {
      const before = Date.now();
      await scheduler.handleAuditLogCleanup();
      const after = Date.now();

      const [cutoff] = mocks.auditService.deleteOlderThan.mock
        .calls[0] as [Date];
      const expectedMs = config.audit.retentionDays * MS_PER_DAY;

      expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - expectedMs - 1000);
      expect(cutoff.getTime()).toBeLessThanOrEqual(after - expectedMs + 1000);
    });

    it('records job history: start → complete on success', async () => {
      await scheduler.handleAuditLogCleanup();

      expect(mocks.jobHistory.start).toHaveBeenCalledWith('audit-log-cleanup');
      expect(mocks.jobHistory.complete).toHaveBeenCalledWith(
        mocks.run,
        expect.objectContaining({ deleted: 10, cutoff: expect.any(Date) }),
      );
      expect(mocks.jobHistory.fail).not.toHaveBeenCalled();
    });

    it('releases lock after successful run', async () => {
      await scheduler.handleAuditLogCleanup();
      expect(mocks.jobLock.release).toHaveBeenCalledWith('audit-log-cleanup');
    });

    it('does NOT call deleteOlderThan when lock is not acquired', async () => {
      mocks.jobLock.tryAcquire.mockResolvedValue(false);

      await scheduler.handleAuditLogCleanup();

      expect(mocks.auditService.deleteOlderThan).not.toHaveBeenCalled();
      expect(mocks.jobHistory.markSkipped).toHaveBeenCalledWith(
        'audit-log-cleanup',
      );
    });

    it('does NOT call start/complete when lock is not acquired', async () => {
      mocks.jobLock.tryAcquire.mockResolvedValue(false);

      await scheduler.handleAuditLogCleanup();

      expect(mocks.jobHistory.start).not.toHaveBeenCalled();
      expect(mocks.jobHistory.complete).not.toHaveBeenCalled();
    });

    it('records job history: start → fail on DB error', async () => {
      const dbError = new Error('connection reset');
      mocks.auditService.deleteOlderThan.mockRejectedValue(dbError);

      await scheduler.handleAuditLogCleanup();

      expect(mocks.jobHistory.fail).toHaveBeenCalledWith(mocks.run, dbError);
      expect(mocks.jobHistory.complete).not.toHaveBeenCalled();
    });

    it('releases lock even when purge throws', async () => {
      mocks.auditService.deleteOlderThan.mockRejectedValue(
        new Error('boom'),
      );

      await scheduler.handleAuditLogCleanup();

      expect(mocks.jobLock.release).toHaveBeenCalledWith('audit-log-cleanup');
    });

    it('does not propagate errors — handler resolves cleanly', async () => {
      mocks.auditService.deleteOlderThan.mockRejectedValue(
        new Error('fatal'),
      );

      await expect(scheduler.handleAuditLogCleanup()).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // handleAdminAuditLogCleanup
  // -------------------------------------------------------------------------

  describe('handleAdminAuditLogCleanup()', () => {
    it('acquires lock for admin-audit-log-cleanup job', async () => {
      await scheduler.handleAdminAuditLogCleanup();
      expect(mocks.jobLock.tryAcquire).toHaveBeenCalledWith(
        'admin-audit-log-cleanup',
      );
    });

    it('calls delete on adminAuditRepo when lock is acquired', async () => {
      await scheduler.handleAdminAuditLogCleanup();
      expect(mocks.adminAuditRepo.createQueryBuilder).toHaveBeenCalled();
      expect(mocks.qb.delete).toHaveBeenCalled();
      expect(mocks.qb.execute).toHaveBeenCalled();
    });

    it('passes cutoff within 1 second of (now - adminRetentionDays)', async () => {
      await scheduler.handleAdminAuditLogCleanup();

      const [clause, params] = mocks.qb.where.mock.calls[0] as [
        string,
        { cutoff: Date },
      ];

      expect(clause).toMatch(/createdAt\s*<\s*:cutoff/);

      const expectedMs = config.audit.adminRetentionDays * MS_PER_DAY;
      const now = Date.now();
      expect(params.cutoff.getTime()).toBeGreaterThanOrEqual(
        now - expectedMs - 2000,
      );
      expect(params.cutoff.getTime()).toBeLessThanOrEqual(
        now - expectedMs + 2000,
      );
    });

    it('uses a DIFFERENT retention window than audit_logs cleanup', () => {
      // The two retention values must differ (90 vs 365 by default)
      expect(config.audit.retentionDays).not.toBe(
        config.audit.adminRetentionDays,
      );
    });

    it('records job history start → complete on success', async () => {
      await scheduler.handleAdminAuditLogCleanup();

      expect(mocks.jobHistory.start).toHaveBeenCalledWith(
        'admin-audit-log-cleanup',
      );
      expect(mocks.jobHistory.complete).toHaveBeenCalledWith(
        mocks.run,
        expect.objectContaining({ deleted: 5, cutoff: expect.any(Date) }),
      );
    });

    it('skips purge and marks skipped when lock is not acquired', async () => {
      mocks.jobLock.tryAcquire.mockResolvedValue(false);

      await scheduler.handleAdminAuditLogCleanup();

      expect(mocks.adminAuditRepo.createQueryBuilder).not.toHaveBeenCalled();
      expect(mocks.jobHistory.markSkipped).toHaveBeenCalledWith(
        'admin-audit-log-cleanup',
      );
    });

    it('records fail and releases lock on DB error', async () => {
      const err = new Error('timeout');
      mocks.qb.execute.mockRejectedValue(err);

      await scheduler.handleAdminAuditLogCleanup();

      expect(mocks.jobHistory.fail).toHaveBeenCalledWith(mocks.run, err);
      expect(mocks.jobLock.release).toHaveBeenCalledWith(
        'admin-audit-log-cleanup',
      );
    });

    it('does not propagate errors from admin purge', async () => {
      mocks.qb.execute.mockRejectedValue(new Error('fatal'));

      await expect(
        scheduler.handleAdminAuditLogCleanup(),
      ).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Cross-handler isolation
  // -------------------------------------------------------------------------

  describe('job isolation', () => {
    it('each handler uses its own job name for locking', async () => {
      await scheduler.handleAuditLogCleanup();
      await scheduler.handleAdminAuditLogCleanup();

      const lockCalls = mocks.jobLock.tryAcquire.mock.calls.map(
        ([name]) => name,
      );
      expect(lockCalls).toContain('audit-log-cleanup');
      expect(lockCalls).toContain('admin-audit-log-cleanup');
    });

    it('audit_logs handler does NOT touch adminAuditRepo', async () => {
      await scheduler.handleAuditLogCleanup();
      expect(mocks.adminAuditRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('admin_audit handler does NOT call AuditService.deleteOlderThan', async () => {
      await scheduler.handleAdminAuditLogCleanup();
      expect(mocks.auditService.deleteOlderThan).not.toHaveBeenCalled();
    });
  });
});
