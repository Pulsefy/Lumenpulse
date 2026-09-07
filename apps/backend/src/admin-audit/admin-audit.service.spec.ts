import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Between } from 'typeorm';
import {
  AdminAuditService,
  MAX_EXPORT_ROWS,
} from './admin-audit.service';
import { AdminBlockchainAuditLog } from './entities/admin-blockchain-audit-log.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeAdminLog = (
  overrides: Partial<AdminBlockchainAuditLog> = {},
): AdminBlockchainAuditLog =>
  ({
    id: 'a-1',
    actorId: 'admin-1',
    actorEmail: 'admin@example.com',
    endpoint: 'POST /grants/rounds',
    targetContract: null,
    paramsSummary: null,
    txHash: null,
    responseStatus: 201,
    createdAt: new Date(),
    ...overrides,
  }) as AdminBlockchainAuditLog;

const makeAuditLog = (
  overrides: Partial<AuditLog> = {},
): AuditLog =>
  ({
    id: 'al-1',
    action: 'login',
    userId: 'user-1',
    ipAddress: '127.0.0.1',
    metadata: null,
    createdAt: new Date(),
    ...overrides,
  }) as AuditLog;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('AdminAuditService', () => {
  let service: AdminAuditService;
  let adminRepo: Record<string, jest.Mock>;
  let auditLogRepo: Record<string, jest.Mock>;

  beforeEach(async () => {
    adminRepo = {
      create: jest.fn((dto) => ({ ...dto })),
      save: jest.fn().mockResolvedValue({}),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      find: jest.fn().mockResolvedValue([]),
    };

    auditLogRepo = {
      find: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminAuditService,
        {
          provide: getRepositoryToken(AdminBlockchainAuditLog),
          useValue: adminRepo,
        },
        {
          provide: getRepositoryToken(AuditLog),
          useValue: auditLogRepo,
        },
      ],
    }).compile();

    service = module.get<AdminAuditService>(AdminAuditService);
  });

  afterEach(() => jest.clearAllMocks());

  // -------------------------------------------------------------------------
  // query()
  // -------------------------------------------------------------------------

  describe('query()', () => {
    it('returns paginated results', async () => {
      const logs = [makeAdminLog()];
      adminRepo.findAndCount.mockResolvedValue([logs, 1]);

      const result = await service.query({ page: 1, limit: 10 });

      expect(result.data).toEqual(logs);
      expect(result.total).toBe(1);
    });

    it('applies actorId filter', async () => {
      await service.query({ actorId: 'admin-1' });

      const [opts] = adminRepo.findAndCount.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(opts.where).toMatchObject({ actorId: 'admin-1' });
    });

    it('applies endpoint filter', async () => {
      await service.query({ endpoint: 'POST /grants/rounds' });

      const [opts] = adminRepo.findAndCount.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(opts.where).toMatchObject({ endpoint: 'POST /grants/rounds' });
    });

    it('applies date range filter using Between', async () => {
      const from = new Date('2026-01-01');
      const to = new Date('2026-03-31');

      await service.query({ from, to });

      const [opts] = adminRepo.findAndCount.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(opts.where).toMatchObject({ createdAt: Between(from, to) });
    });

    it('caps limit at 100', async () => {
      await service.query({ limit: 999 });

      const [opts] = adminRepo.findAndCount.mock.calls[0] as [
        { take: number },
      ];
      expect(opts.take).toBe(100);
    });

    it('defaults page to 1 and limit to 20', async () => {
      await service.query({});

      const [opts] = adminRepo.findAndCount.mock.calls[0] as [
        { skip: number; take: number },
      ];
      expect(opts.skip).toBe(0);
      expect(opts.take).toBe(20);
    });
  });

  // -------------------------------------------------------------------------
  // export()
  // -------------------------------------------------------------------------

  describe('export()', () => {
    const from = '2026-01-01T00:00:00.000Z';
    const to = '2026-03-31T23:59:59.999Z';

    it('returns both tables combined', async () => {
      const auditLogs = [makeAuditLog()];
      const adminLogs = [makeAdminLog()];
      auditLogRepo.find.mockResolvedValue(auditLogs);
      adminRepo.find.mockResolvedValue(adminLogs);

      const result = await service.export({ from, to });

      expect(result.auditLogs).toEqual(auditLogs);
      expect(result.adminBlockchainAuditLogs).toEqual(adminLogs);
    });

    it('includes exportedAt and dateRange metadata', async () => {
      const result = await service.export({ from, to });

      expect(result.exportedAt).toBeDefined();
      expect(new Date(result.exportedAt).toISOString()).toBe(result.exportedAt);
      expect(result.dateRange).toEqual({ from, to });
    });

    it('passes correct Between filter to both repos', async () => {
      await service.export({ from, to });

      // audit_logs repo
      const [auditOpts] = auditLogRepo.find.mock.calls[0] as [
        { where: { createdAt: unknown } },
      ];
      expect(auditOpts.where.createdAt).toEqual(
        Between(new Date(from), new Date(to)),
      );

      // admin repo
      const [adminOpts] = adminRepo.find.mock.calls[0] as [
        { where: { createdAt: unknown } },
      ];
      expect(adminOpts.where.createdAt).toEqual(
        Between(new Date(from), new Date(to)),
      );
    });

    it('applies actorId filter only to admin table, not audit_logs', async () => {
      await service.export({ from, to, actorId: 'admin-1' });

      const [adminOpts] = adminRepo.find.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(adminOpts.where).toMatchObject({ actorId: 'admin-1' });

      const [auditOpts] = auditLogRepo.find.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(auditOpts.where).not.toHaveProperty('actorId');
    });

    it('applies endpoint filter only to admin table, not audit_logs', async () => {
      await service.export({ from, to, endpoint: 'POST /grants/rounds' });

      const [adminOpts] = adminRepo.find.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(adminOpts.where).toMatchObject({
        endpoint: 'POST /grants/rounds',
      });

      const [auditOpts] = auditLogRepo.find.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(auditOpts.where).not.toHaveProperty('endpoint');
    });

    it('truncated = false when both tables return fewer than MAX_EXPORT_ROWS', async () => {
      auditLogRepo.find.mockResolvedValue([makeAuditLog()]);
      adminRepo.find.mockResolvedValue([makeAdminLog()]);

      const result = await service.export({ from, to });
      expect(result.truncated).toBe(false);
    });

    it('truncated = true when audit_logs hits MAX_EXPORT_ROWS', async () => {
      const fullSet = Array.from({ length: MAX_EXPORT_ROWS }, () =>
        makeAuditLog(),
      );
      auditLogRepo.find.mockResolvedValue(fullSet);
      adminRepo.find.mockResolvedValue([]);

      const result = await service.export({ from, to });
      expect(result.truncated).toBe(true);
    });

    it('truncated = true when admin_blockchain_audit_logs hits MAX_EXPORT_ROWS', async () => {
      const fullSet = Array.from({ length: MAX_EXPORT_ROWS }, () =>
        makeAdminLog(),
      );
      auditLogRepo.find.mockResolvedValue([]);
      adminRepo.find.mockResolvedValue(fullSet);

      const result = await service.export({ from, to });
      expect(result.truncated).toBe(true);
    });

    it('caps both queries at MAX_EXPORT_ROWS via take option', async () => {
      await service.export({ from, to });

      const [auditOpts] = auditLogRepo.find.mock.calls[0] as [{ take: number }];
      const [adminOpts] = adminRepo.find.mock.calls[0] as [{ take: number }];

      expect(auditOpts.take).toBe(MAX_EXPORT_ROWS);
      expect(adminOpts.take).toBe(MAX_EXPORT_ROWS);
    });

    it('returns empty arrays without error when both tables have no matching rows', async () => {
      auditLogRepo.find.mockResolvedValue([]);
      adminRepo.find.mockResolvedValue([]);

      const result = await service.export({ from, to });

      expect(result.auditLogs).toEqual([]);
      expect(result.adminBlockchainAuditLogs).toEqual([]);
      expect(result.truncated).toBe(false);
    });

    it('omits actorId/endpoint from admin WHERE when not supplied', async () => {
      await service.export({ from, to });

      const [adminOpts] = adminRepo.find.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(adminOpts.where).not.toHaveProperty('actorId');
      expect(adminOpts.where).not.toHaveProperty('endpoint');
    });
  });
});
