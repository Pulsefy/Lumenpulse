import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { UserRole } from '../users/entities/user.entity';
import { ROLES_KEY } from './decorators/auth.decorators';

const makeContext = (role?: UserRole, requiredRoles?: UserRole[]) => {
  const reflector = new Reflector();
  jest
    .spyOn(reflector, 'getAllAndOverride')
    .mockImplementation((key: string) => {
      if (key === ROLES_KEY) return requiredRoles;
      return undefined;
    });

  const ctx = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user: role ? { role } : undefined }),
    }),
  } as unknown as ExecutionContext;

  return { guard: new RolesGuard(reflector), ctx };
};

describe('RolesGuard', () => {
  it('allows access when no roles required', () => {
    const { guard, ctx } = makeContext(undefined, undefined);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows ADMIN to access ADMIN-only route', () => {
    const { guard, ctx } = makeContext(UserRole.ADMIN, [UserRole.ADMIN]);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows REVIEWER to access REVIEWER route', () => {
    const { guard, ctx } = makeContext(UserRole.REVIEWER, [UserRole.REVIEWER]);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows ADMIN to access ADMIN|REVIEWER route', () => {
    const { guard, ctx } = makeContext(UserRole.ADMIN, [
      UserRole.ADMIN,
      UserRole.REVIEWER,
    ]);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('denies USER from ADMIN-only route', () => {
    const { guard, ctx } = makeContext(UserRole.USER, [UserRole.ADMIN]);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('denies REVIEWER from ADMIN-only route', () => {
    const { guard, ctx } = makeContext(UserRole.REVIEWER, [UserRole.ADMIN]);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('denies unauthenticated request', () => {
    const { guard, ctx } = makeContext(undefined, [UserRole.ADMIN]);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});

describe('UserRole enum', () => {
  it('includes REVIEWER role', () => {
    expect(UserRole.REVIEWER).toBe('reviewer');
  });

  it('has USER, REVIEWER, and ADMIN roles', () => {
    expect(Object.values(UserRole)).toEqual(
      expect.arrayContaining(['user', 'reviewer', 'admin']),
    );
  });
});
