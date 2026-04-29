import { FeatureFlagGuard } from './feature-flag.guard';
import { FeatureFlagsService } from './feature-flags.service';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';

describe('FeatureFlagGuard', () => {
  let guard: FeatureFlagGuard;
  let flags: Partial<FeatureFlagsService>;
  let reflector: Partial<Reflector>;

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
});
