import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { config } from '../lib/config';

export const SECRET_ROTATION_TOKEN_HEADER = 'x-secret-rotation-token';

/**
 * Authorises the secret-rotation trigger with a dedicated shared token.
 *
 * The endpoint is an operator/CI surface, not a user-facing one, so it does
 * not participate in the JWT + RBAC flow. It is excluded from the published
 * OpenAPI document on purpose: advertising a secrets-rotation route in the
 * public contract would only widen the attack surface. The procedure is
 * documented in `apps/backend/SECRET_ROTATION_RUNBOOK.md`.
 *
 * The route is disabled (503) unless `SECRET_ROTATION_TRIGGER_TOKEN` is set,
 * so a misconfigured deployment cannot expose it anonymously.
 */
@Injectable()
export class SecretRotationTriggerGuard implements CanActivate {
  private readonly logger = new Logger(SecretRotationTriggerGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const expected = config.secretRotation.triggerToken;
    if (!expected) {
      this.logger.warn(
        'Secret rotation trigger rejected: SECRET_ROTATION_TRIGGER_TOKEN is not set.',
      );
      throw new ServiceUnavailableException(
        'Secret rotation is not enabled on this deployment.',
      );
    }

    const request = context.switchToHttp().getRequest<Request>();
    const provided = readHeader(request, SECRET_ROTATION_TOKEN_HEADER);

    if (!provided || !constantTimeEquals(provided, expected)) {
      this.logger.warn(
        `Secret rotation trigger denied for ${request.method} ${request.path}`,
      );
      throw new UnauthorizedException('Invalid secret rotation token.');
    }

    return true;
  }
}

function readHeader(request: Request, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}
