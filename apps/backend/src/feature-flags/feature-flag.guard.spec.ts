import { FeatureFlagGuard, principalIdOf } from './feature-flag.guard';
import { FeatureFlagsService } from './feature-flags.service';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';

describe('FeatureFlagGuard', () => {
  let guard: FeatureFlagGuard;
  let flags: Partial<FeatureFlagsService>;
  let reflector: Partial<Reflector>;

  const contextFor = (request: unknown) =>
    ({
      getHandler: () => {},
      getClass: () => {},
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    flags = { isEnabled: jest.fn() };
    reflector = { get: jest.fn() };
    guard = new FeatureFlagGuard(
      reflector as Reflector,
      flags as FeatureFlagsService,
    );
  });

  it('allows when no metadata present', async () => {
    (reflector.get as jest.Mock).mockReturnValue(undefined);
    const mockCtx = {
      getHandler: () => {},
      getClass: () => {},
      switchToHttp: () => ({ getRequest: () => ({}) }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(mockCtx)).resolves.toBe(true);
  });

  it('allows when flag enabled', async () => {
    (reflector.get as jest.Mock).mockReturnValue('some.flag');
    (flags.isEnabled as jest.Mock).mockResolvedValue(true);
    const mockCtx = {
      getHandler: () => {},
      getClass: () => {},
      switchToHttp: () => ({ getRequest: () => ({}) }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(mockCtx)).resolves.toBe(true);
    expect(flags.isEnabled).toHaveBeenCalledWith(
      'some.flag',
      expect.any(Object),
    );
  });

  it('throws when flag disabled', async () => {
    (reflector.get as jest.Mock).mockReturnValue('some.flag');
    (flags.isEnabled as jest.Mock).mockResolvedValue(false);
    const mockCtx = {
      getHandler: () => {},
      getClass: () => {},
      switchToHttp: () => ({ getRequest: () => ({}) }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(mockCtx)).rejects.toThrow();
  });

  describe('principal resolution', () => {
    it('passes the authenticated user id so targeting can bucket', async () => {
      (reflector.get as jest.Mock).mockReturnValue('some.flag');
      (flags.isEnabled as jest.Mock).mockResolvedValue(true);

      await guard.canActivate(
        contextFor({ user: { id: 'user-1', email: 'a@test.com' } }),
      );

      expect(flags.isEnabled).toHaveBeenCalledWith('some.flag', {
        request: expect.any(Object),
        principalId: 'user-1',
      });
    });

    it('falls back to email for a caller with no user id', async () => {
      (reflector.get as jest.Mock).mockReturnValue('some.flag');
      (flags.isEnabled as jest.Mock).mockResolvedValue(true);

      await guard.canActivate(
        contextFor({ user: { id: '', email: 'service@lumenpulse.com' } }),
      );

      expect(flags.isEnabled).toHaveBeenCalledWith('some.flag', {
        request: expect.any(Object),
        principalId: 'service@lumenpulse.com',
      });
    });

    it('passes a null principal for an anonymous request', async () => {
      (reflector.get as jest.Mock).mockReturnValue('some.flag');
      (flags.isEnabled as jest.Mock).mockResolvedValue(true);

      await guard.canActivate(contextFor({}));

      expect(flags.isEnabled).toHaveBeenCalledWith('some.flag', {
        request: expect.any(Object),
        principalId: null,
      });
    });
  });

  describe('principalIdOf', () => {
    it('prefers the user id over the email', () => {
      expect(
        principalIdOf({ user: { id: 'id-1', email: 'a@test.com' } } as never),
      ).toBe('id-1');
    });

    it('falls back to email when the id is missing or blank', () => {
      expect(principalIdOf({ user: { email: 'a@test.com' } } as never)).toBe(
        'a@test.com',
      );
      expect(
        principalIdOf({ user: { id: '', email: 'a@test.com' } } as never),
      ).toBe('a@test.com');
    });

    it('returns null when there is no usable identity', () => {
      expect(principalIdOf({} as never)).toBeNull();
      expect(principalIdOf({ user: undefined } as never)).toBeNull();
      expect(principalIdOf({ user: {} } as never)).toBeNull();
      expect(principalIdOf({ user: { id: 42 } } as never)).toBeNull();
      expect(principalIdOf({ user: { id: 'id', email: 7 } } as never)).toBe(
        'id',
      );
    });
  });
});
