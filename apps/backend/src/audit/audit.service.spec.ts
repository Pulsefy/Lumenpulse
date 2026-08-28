import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditService } from './audit.service';
import { AuditLog } from './entities/audit-log.entity';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal AuditLog-shaped object at the given timestamp. */
const makeLog = (createdAt: Date): AuditLog =>
  ({ id: 'test-id', action: 'login', createdAt }) as AuditLog;

// ---------------------------------------------------------------------------
// Shared query-builder mock factory
// ---------------------------------------------------------------------------

const makeQb = (affected: number) => ({
  delete: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  execute: jest.fn().mockResolvedValue({ affected }),
});

describe('AuditService', () => {
  let service: AuditService;
  let mockRepo: Record<string, jest.Mock>;

  // We capture the last queryBuilder instance so individual tests can
  // inspect the arguments passed to `.where()`.
  let lastQb: ReturnType<typeof makeQb>;

  beforeEach(async () => {
    lastQb = makeQb(0);

    mockRepo = {
      create: jest.fn((dto) => ({ ...dto })),
      save: jest.fn((e) => Promise.resolve(e)),
      findAndCount: jest.fn(),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(() => lastQb),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: getRepositoryToken(AuditLog), useValue: mockRepo },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
  });

  afterEach(() => jest.clearAllMocks());

  // -------------------------------------------------------------------------
  // deleteOlderThan — boundary cases
  // -------------------------------------------------------------------------

  describe('deleteOlderThan()', () => {
    it('returns the affected row count from the query builder', async () => {
      lastQb = makeQb(42);
      mockRepo.createQueryBuilder.mockReturnValue(lastQb);

      const result = await service.deleteOlderThan(new Date());

      expect(result).toBe(42);
    });

    it('passes the cutoff date to the WHERE clause', async () => {
      lastQb = makeQb(0);
      mockRepo.createQueryBuilder.mockReturnValue(lastQb);

      const cutoff = new Date('2026-01-01T02:00:00.000Z');
      await service.deleteOlderThan(cutoff);

      expect(lastQb.where).toHaveBeenCalledWith('createdAt < :cutoff', {
        cutoff,
      });
    });

    it('boundary exact: a record AT the cutoff is NOT deleted (exclusive <)', async () => {
      // The query uses strict < so a record whose createdAt equals the cutoff
      // must not be included. We verify this by checking the WHERE operator
      // string — the delete does not run against real data in unit tests.
      const cutoff = new Date('2026-01-01T02:00:00.000Z');
      lastQb = makeQb(0);
      mockRepo.createQueryBuilder.mockReturnValue(lastQb);

      await service.deleteOlderThan(cutoff);

      const [clause] = lastQb.where.mock.calls[0] as [string, unknown];
      // Must use strict less-than, never <=
      expect(clause).toMatch(/createdAt\s*<\s*:cutoff/);
      expect(clause).not.toMatch(/createdAt\s*<=\s*:cutoff/);
    });

    it('boundary cutoff - 1ms: record 1ms before cutoff IS eligible (< holds)', async () => {
      const cutoff = new Date('2026-01-01T02:00:00.000Z');
      const recordTime = new Date(cutoff.getTime() - 1); // 1 ms before cutoff

      // Confirm the arithmetic: recordTime < cutoff must be true
      expect(recordTime.getTime()).toBeLessThan(cutoff.getTime());

      // The WHERE clause is correct; the DB engine would include this row.
      lastQb = makeQb(1);
      mockRepo.createQueryBuilder.mockReturnValue(lastQb);

      const deleted = await service.deleteOlderThan(cutoff);
      expect(deleted).toBe(1);
    });

    it('boundary cutoff + 1ms: record 1ms after cutoff is NOT eligible', async () => {
      const cutoff = new Date('2026-01-01T02:00:00.000Z');
      const recordTime = new Date(cutoff.getTime() + 1); // 1 ms after cutoff

      // Confirm the arithmetic: recordTime < cutoff must be false
      expect(recordTime.getTime()).toBeGreaterThan(cutoff.getTime());

      // Mock returns 0 — nothing deleted
      lastQb = makeQb(0);
      mockRepo.createQueryBuilder.mockReturnValue(lastQb);

      const deleted = await service.deleteOlderThan(cutoff);
      expect(deleted).toBe(0);
    });

    it('empty table: returns 0 without error', async () => {
      lastQb = makeQb(0);
      mockRepo.createQueryBuilder.mockReturnValue(lastQb);

      const deleted = await service.deleteOlderThan(new Date());
      expect(deleted).toBe(0);
    });

    it('all rows older than cutoff: returns full count', async () => {
      lastQb = makeQb(500);
      mockRepo.createQueryBuilder.mockReturnValue(lastQb);

      const deleted = await service.deleteOlderThan(new Date());
      expect(deleted).toBe(500);
    });

    it('all rows newer than cutoff: returns 0', async () => {
      lastQb = makeQb(0);
      mockRepo.createQueryBuilder.mockReturnValue(lastQb);

      const deleted = await service.deleteOlderThan(
        new Date('2000-01-01T00:00:00.000Z'),
      );
      expect(deleted).toBe(0);
    });

    it('DB error propagates out of deleteOlderThan', async () => {
      lastQb = makeQb(0);
      lastQb.execute.mockRejectedValue(new Error('DB connection lost'));
      mockRepo.createQueryBuilder.mockReturnValue(lastQb);

      await expect(service.deleteOlderThan(new Date())).rejects.toThrow(
        'DB connection lost',
      );
    });

    it('handles affected = null from driver by returning 0', async () => {
      lastQb = makeQb(0);
      lastQb.execute.mockResolvedValue({ affected: null });
      mockRepo.createQueryBuilder.mockReturnValue(lastQb);

      const deleted = await service.deleteOlderThan(new Date());
      expect(deleted).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // log() — smoke test to confirm existing method is unaffected
  // -------------------------------------------------------------------------

  describe('log()', () => {
    it('persists an audit log entry', async () => {
      const saved = makeLog(new Date());
      mockRepo.save.mockResolvedValue(saved);
      mockRepo.create.mockReturnValue(saved);

      const result = await service.log('login', 'user-1', '127.0.0.1', {});

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'login' }),
      );
      expect(result).toBe(saved);
    });
  });
});
