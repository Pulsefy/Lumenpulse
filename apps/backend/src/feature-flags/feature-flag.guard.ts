import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import { Reflector } from '@nestjs/core';
import { FeatureFlagsService } from './feature-flags.service';
import { FEATURE_FLAG_KEY } from './feature-flag.decorator';

/**
 * Stable identity a percentage rollout buckets on.
 *
 * Prefers the user ID because it survives an email change — a principal that
 * silently re-bucketed on profile edit would flip between states. Falls back to
 * email for API-key and service callers that carry no user row, and returns
 * null for anonymous requests, in which case only the flag's plain on/off
 * state applies.
 */
export function principalIdOf(request: Request): string | null {
  const user = request.user as { id?: unknown; email?: unknown } | undefined;
  if (!user) return null;
  if (typeof user.id === 'string' && user.id !== '') return user.id;
  if (typeof user.email === 'string' && user.email !== '') return user.email;
  return null;
}

@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly flags: FeatureFlagsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const key =
      this.reflector.get<string>(FEATURE_FLAG_KEY, context.getHandler()) ||
      this.reflector.get<string>(FEATURE_FLAG_KEY, context.getClass());
    if (!key) return true;

    const request: Request = context.switchToHttp().getRequest();
    const enabled = await this.flags.isEnabled(key, {
      request,
      principalId: principalIdOf(request),
    });
    if (!enabled) throw new ForbiddenException(`Feature '${key}' is disabled`);
    return true;
  }
}
