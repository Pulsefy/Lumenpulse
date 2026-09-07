import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminAuditController } from './admin-audit.controller';
import { AdminAuditService } from './admin-audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../users/entities/user.entity';
import { AuditLogInterceptor } from '../audit/interceptors/audit-log.interceptor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal response mock that captures setHeader calls. */
const makeRes = () => ({
  setHeader: jest.fn(),
});

const makeExportResult = () => ({
  exportedAt: new Date().toISOString(),
  dateRange: {
    from: '2026-01-01T00:00:00.000Z',
    to: '2026-03-31T23:59:59.999Z',
  },
  auditLogs: [],
  adminBlockchainAuditLogs: [],
  truncated: false,
});

// ---------------------------------------------------------------------------
// Guard stubs
// ---------------------------------------------------------------------------

/**
 * A JwtAuthGuard stub that always allows through.
 * We test guard rejection separately using the real RolesGuard below.
 */
const allowAllJwtGuard = {
  canActivate: jest.fn().mockReturnValue(true),
};

/** Build an ExecutionContext stub carrying the given user. */
const makeContext = (user: { role: UserRole } | null) => {
  const request = { user };
  return {
    getHandler: jest.fn().mockReturnValue(() => {}),
    getClass: jest.fn().mockReturnValue(AdminAuditController),
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue(request),
    }),
  } as unknown as ExecutionContext;
};

// ---------------------------------------------------------------------------
// Suite — controller unit tests (guards overridden, service mocked)
// ---------------------------------------------------------------------------

describe('AdminAuditController – export endpoint', () => {
  let controller: AdminAuditController;
  let auditService: Record<string, jest.Mock>;

  beforeEach(async () => {
    auditService = {
      query: jest.fn().mockResolvedValue({ data: [], total: 0 }),
      export: jest.fn().mockResolvedValue(makeExportResult()),
      create: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminAuditController],
      providers: [
        { provide: AdminAuditService, useValue: auditService },
        // Override guards so we can test the controller logic in isolation
        { provide: JwtAuthGuard, useValue: allowAllJwtGuard },
        {
          provide: RolesGuard,
          useValue: { canActivate: jest.fn().mockReturnValue(true) },
        },
        // AuditLogInterceptor is a global APP_INTERCEPTOR; provide a no-op
        // here so the controller compiles without real dependencies
        {
          provide: AuditLogInterceptor,
          useValue: { intercept: jest.fn((_, next) => next.handle()) },
        },
        Reflector,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(allowAllJwtGuard)
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get<AdminAuditController>(AdminAuditController);
  });

  afterEach(() => jest.clearAllMocks());

  // -------------------------------------------------------------------------
  // Response shape
  // -------------------------------------------------------------------------

  describe('response body shape', () => {
    it('returns the service export result directly', async () => {
      const expected = makeExportResult();
      auditService.export.mockResolvedValue(expected);
      const res = makeRes();

      const result = await controller.exportLogs(
        {
          from: '2026-01-01T00:00:00.000Z',
          to: '2026-03-31T23:59:59.999Z',
        },
        res as any,
      );

      expect(result).toEqual(expected);
    });

    it('delegates to auditService.export with the query DTO', async () => {
      const dto = {
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-03-31T23:59:59.999Z',
        actorId: 'admin-1',
      };
      const res = makeRes();

      await controller.exportLogs(dto, res as any);

      expect(auditService.export).toHaveBeenCalledWith(dto);
    });

    it('includes truncated flag in response', async () => {
      auditService.export.mockResolvedValue({
        ...makeExportResult(),
        truncated: true,
      });
      const res = makeRes();

      const result = await controller.exportLogs(
        {
          from: '2026-01-01T00:00:00.000Z',
          to: '2026-03-31T23:59:59.999Z',
        },
        res as any,
      );

      expect(result.truncated).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Content-Disposition header
  // -------------------------------------------------------------------------

  describe('Content-Disposition header', () => {
    it('sets Content-Disposition: attachment with a timestamped filename', async () => {
      const res = makeRes();

      await controller.exportLogs(
        {
          from: '2026-01-01T00:00:00.000Z',
          to: '2026-03-31T23:59:59.999Z',
        },
        res as any,
      );

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringMatching(
          /^attachment; filename="audit-export-.*\.json"$/,
        ),
      );
    });

    it('filename contains a timestamp derived from the current time', async () => {
      const res = makeRes();

      await controller.exportLogs(
        { from: '2026-01-01T00:00:00.000Z', to: '2026-03-31T23:59:59.999Z' },
        res as any,
      );

      const headerValue = res.setHeader.mock.calls[0][1] as string;
      // Extract the filename between the quotes
      const match = headerValue.match(
        /^attachment; filename="audit-export-(.+)\.json"$/,
      );
      expect(match).not.toBeNull();

      const tsStr = match![1];
      // The timestamp is ISO 8601 with : and . replaced by -
      // It must contain at least 10 characters (date portion) and only
      // contain digits, letters T/Z, and dashes.
      expect(tsStr.length).toBeGreaterThanOrEqual(10);
      expect(tsStr).toMatch(/^[\dTZ-]+$/);
    });
  });
});

// ---------------------------------------------------------------------------
// Suite — RolesGuard enforcement (using the real guard)
// ---------------------------------------------------------------------------

describe('AdminAuditController – guard enforcement', () => {
  let rolesGuard: RolesGuard;
  let reflector: Reflector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RolesGuard, Reflector],
    }).compile();

    rolesGuard = module.get<RolesGuard>(RolesGuard);
    reflector = module.get<Reflector>(Reflector);
  });

  it('rejects a USER role with ForbiddenException', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([UserRole.ADMIN]);

    const ctx = makeContext({ role: UserRole.USER });

    expect(() => rolesGuard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rejects a REVIEWER role with ForbiddenException', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([UserRole.ADMIN]);

    const ctx = makeContext({ role: UserRole.REVIEWER });

    expect(() => rolesGuard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rejects an unauthenticated request (no user) with ForbiddenException', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([UserRole.ADMIN]);

    const ctx = makeContext(null);

    expect(() => rolesGuard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('allows an ADMIN role through', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([UserRole.ADMIN]);

    const ctx = makeContext({ role: UserRole.ADMIN });

    expect(rolesGuard.canActivate(ctx)).toBe(true);
  });
});
