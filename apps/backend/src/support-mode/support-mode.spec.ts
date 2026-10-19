import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { of } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { SupportModeInterceptor } from './support-mode.interceptor';
import {
  SUPPORT_SESSION_TTL_MS,
  SupportModeService,
} from './support-mode.service';
import { SupportSession } from './entities/support-session.entity';
import { UserRole } from '../users/entities/user.entity';
import { JwtStrategy } from '../auth/jwt.strategy';

const ACTOR = { id: 'admin-1' };

function makeService() {
  const sessions = {
    create: jest.fn((v: Partial<SupportSession>) => ({ ...v })),
    save: jest.fn((v: Partial<SupportSession>) =>
      Promise.resolve({ id: 'sess-1', startedAt: new Date(), ...v }),
    ),
    findOne: jest.fn(),
    find: jest.fn(),
    query: jest.fn().mockResolvedValue(undefined),
  };
  const users = { findOne: jest.fn() };
  const jwt = { sign: jest.fn().mockReturnValue('support-token') };
  const audit = { log: jest.fn().mockResolvedValue({}) };
  const notifications = { create: jest.fn().mockResolvedValue({}) };
  const service = new SupportModeService(
    sessions as never,
    users as never,
    jwt as never,
    audit as never,
    notifications as never,
  );
  return { service, sessions, users, jwt, audit, notifications };
}

describe('SupportModeService', () => {
  it('starts a session: token pinned to USER role, audited, subject notified', async () => {
    const { service, users, jwt, audit, notifications } = makeService();
    users.findOne.mockResolvedValue({ id: 'u1', role: UserRole.USER });

    const result = await service.start(
      ACTOR,
      'u1',
      'User reports missing contribution',
      '1.1.1.1',
    );

    expect(result.accessToken).toBe('support-token');
    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'u1',
        role: UserRole.USER,
        type: 'support',
        supportSessionId: 'sess-1',
        actorId: 'admin-1',
      }),
      { expiresIn: SUPPORT_SESSION_TTL_MS / 1000 },
    );
    expect(audit.log).toHaveBeenCalledWith(
      'support_session_start',
      'admin-1',
      '1.1.1.1',
      expect.objectContaining({ subjectId: 'u1' }),
    );
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1' }),
    );
    const ttl = result.session.expiresAt.getTime() - Date.now();
    expect(ttl).toBeLessThanOrEqual(SUPPORT_SESSION_TTL_MS);
    expect(result.session.active).toBe(true);
  });

  it('rejects short reasons, self-targeting, admin subjects and unknown users', async () => {
    const { service, users } = makeService();
    await expect(service.start(ACTOR, 'u1', 'short')).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      service.start(ACTOR, 'admin-1', 'long enough reason here'),
    ).rejects.toThrow(BadRequestException);
    users.findOne.mockResolvedValueOnce({ id: 'a2', role: UserRole.ADMIN });
    await expect(
      service.start(ACTOR, 'a2', 'long enough reason here'),
    ).rejects.toThrow(ForbiddenException);
    users.findOne.mockResolvedValueOnce(null);
    await expect(
      service.start(ACTOR, 'nope', 'long enough reason here'),
    ).rejects.toThrow(NotFoundException);
  });

  it('findActive returns null for ended or expired sessions', async () => {
    const { service, sessions } = makeService();
    sessions.findOne.mockResolvedValueOnce({
      endedAt: new Date(),
      expiresAt: new Date(Date.now() + 1000),
    });
    expect(await service.findActive('s')).toBeNull();
    sessions.findOne.mockResolvedValueOnce({
      endedAt: null,
      expiresAt: new Date(Date.now() - 1),
    });
    expect(await service.findActive('s')).toBeNull();
    const live = { endedAt: null, expiresAt: new Date(Date.now() + 5000) };
    sessions.findOne.mockResolvedValueOnce(live);
    expect(await service.findActive('s')).toBe(live);
  });

  it('end sets endedAt once and only for the owning actor', async () => {
    const { service, sessions, audit } = makeService();
    const row = {
      id: 's',
      actorId: 'admin-1',
      subjectId: 'u1',
      reason: 'r',
      startedAt: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() + 60_000),
      endedAt: null,
      endpoints: [],
    };
    sessions.findOne.mockResolvedValue(row);

    await expect(service.end('s', 'other-admin')).rejects.toThrow(
      NotFoundException,
    );
    const summary = await service.end('s', 'admin-1');
    expect(summary.active).toBe(false);
    expect(summary.durationMs).toBeGreaterThanOrEqual(59_000);
    expect(audit.log).toHaveBeenCalledWith(
      'support_session_end',
      'admin-1',
      null,
      expect.any(Object),
    );
  });

  it('caps reported duration at the fixed expiry', async () => {
    const { service, sessions } = makeService();
    const startedAt = new Date(Date.now() - 3_600_000);
    sessions.findOne.mockResolvedValue({
      id: 's',
      actorId: 'a',
      subjectId: 'u',
      reason: 'r',
      startedAt,
      expiresAt: new Date(startedAt.getTime() + SUPPORT_SESSION_TTL_MS),
      endedAt: null,
      endpoints: [],
    });
    const summary = await service.get('s');
    expect(summary.active).toBe(false);
    expect(summary.durationMs).toBe(SUPPORT_SESSION_TTL_MS);
  });
});

describe('SupportModeInterceptor', () => {
  const ctx = (req: unknown) =>
    ({
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => req }),
    }) as unknown as ExecutionContext;
  const next = { handle: jest.fn(() => of('ok')) };

  beforeEach(() => next.handle.mockClear());

  it('passes through normal (non-support) requests untouched', async () => {
    const svc = { recordAccess: jest.fn() };
    const i = new SupportModeInterceptor(svc as never);
    await i.intercept(ctx({ method: 'POST', user: { id: 'u' } }), next);
    expect(svc.recordAccess).not.toHaveBeenCalled();
    expect(next.handle).toHaveBeenCalled();
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'blocks %s in support mode and records the attempt',
    async (method) => {
      const svc = { recordAccess: jest.fn().mockResolvedValue(undefined) };
      const i = new SupportModeInterceptor(svc as never);
      await expect(
        i.intercept(
          ctx({ method, url: '/x', user: { supportSessionId: 's1' } }),
          next,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(next.handle).not.toHaveBeenCalled();
      expect(svc.recordAccess).toHaveBeenCalledWith(
        's1',
        `BLOCKED ${method}`,
        '/x',
      );
    },
  );

  it('allows and records GET in support mode', async () => {
    const svc = { recordAccess: jest.fn().mockResolvedValue(undefined) };
    const i = new SupportModeInterceptor(svc as never);
    await i.intercept(
      ctx({
        method: 'GET',
        originalUrl: '/portfolio',
        user: { supportSessionId: 's1' },
      }),
      next,
    );
    expect(svc.recordAccess).toHaveBeenCalledWith('s1', 'GET', '/portfolio');
    expect(next.handle).toHaveBeenCalled();
  });

  it('fails closed when the access cannot be recorded', async () => {
    const svc = { recordAccess: jest.fn().mockRejectedValue(new Error('db')) };
    const i = new SupportModeInterceptor(svc as never);
    await expect(
      i.intercept(
        ctx({ method: 'GET', url: '/x', user: { supportSessionId: 's1' } }),
        next,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(next.handle).not.toHaveBeenCalled();
  });
});

describe('JwtStrategy support tokens', () => {
  const build = (session: unknown) => {
    const users = {
      findOne: jest.fn().mockResolvedValue({ id: 'u1', deletedAt: null }),
    };
    const sessions = { findOne: jest.fn().mockResolvedValue(session) };
    const config = { getOrThrow: jest.fn().mockReturnValue('secret') };
    return new JwtStrategy(
      users as never,
      sessions as never,
      { findOne: jest.fn(), update: jest.fn() } as never,
      config as unknown as ConfigService,
    );
  };
  const payload = {
    sub: 'u1',
    stellarPublicKey: '',
    type: 'support',
    supportSessionId: 's1',
  };

  it('accepts a live session and tags the user', async () => {
    const strategy = build({
      id: 's1',
      subjectId: 'u1',
      endedAt: null,
      expiresAt: new Date(Date.now() + 1000),
    });
    const user = await strategy.validate(payload);
    expect(
      (user as unknown as { supportSessionId: string }).supportSessionId,
    ).toBe('s1');
  });

  it.each([
    [
      'ended',
      {
        id: 's1',
        subjectId: 'u1',
        endedAt: new Date(),
        expiresAt: new Date(Date.now() + 1000),
      },
    ],
    [
      'expired',
      {
        id: 's1',
        subjectId: 'u1',
        endedAt: null,
        expiresAt: new Date(Date.now() - 1),
      },
    ],
    [
      'other subject',
      {
        id: 's1',
        subjectId: 'other',
        endedAt: null,
        expiresAt: new Date(Date.now() + 1000),
      },
    ],
    ['missing', null],
  ])('rejects a %s session', async (_label, session) => {
    await expect(build(session).validate(payload)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
