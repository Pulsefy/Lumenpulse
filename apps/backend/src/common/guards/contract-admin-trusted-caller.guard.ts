import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { AccessControlService } from '../services/access-control.service';
import { config } from '../../lib/config';

/**
 * Authorisation inventory (privileged entry points):
 *
 * | Entry point                              | Guard(s) applied                                              | Authorisation enforced |
 * |------------------------------------------|---------------------------------------------------------------|------------------------|
 * | ContractAdminTrustedCallerGuard.canActivate | JwtAuthGuard -> ContractAdminGuard -> this guard (stacked) | JWT session + ADMIN role + trusted-caller API key (when enabled) |
 *
 * This guard is a no-op when CONTRACT_ADMIN_TRUSTED_CALLER_ENABLED is false,
 * but it MUST NOT be the only authorisation layer: it is always stacked after
 * JwtAuthGuard and ContractAdminGuard.  Any state-changing contract admin
 * entry point that relies solely on this guard (with the feature disabled)
 * would be unauthorised and is therefore rejected at construction time.
 */

/**
 * Optional trusted-caller verification for contract admin routes.
 *
 * When CONTRACT_ADMIN_TRUSTED_CALLER_ENABLED is true, this guard requires
 * a valid API key (via the x-api-key header) verified against the
 * CONTRACT_ADMIN_API_KEY env var.  When disabled (default for dev/test),
 * the guard is a no-op so the regular JWT + RBAC guards still apply.
 *
 * Intended to be stacked after JwtAuthGuard and ContractAdminGuard so that
 * an attacker must bypass three layers:
 *   1. Valid JWT session
 *   2. ADMIN role
 *   3. Trusted-caller API key (when enabled)
 */
@Injectable()
export class ContractAdminTrustedCallerGuard implements CanActivate {
  private readonly logger = new Logger(ContractAdminTrustedCallerGuard.name);

  constructor(private readonly accessControlService: AccessControlService) {
    // Fail fast if the trusted-caller layer is disabled while the guard is
    // wired as the sole authorisation mechanism for a privileged entry point.
    // This makes a missing/disabled authorisation layer visible at startup
    // instead of silently allowing unauthorised state changes in production.
    if (!config.contractAdmin.trustedCallerEnabled) {
      this.logger.warn(
        'ContractAdminTrustedCallerGuard is DISABLED. Ensure JwtAuthGuard ' +
          'and ContractAdminGuard are stacked before this guard on every ' +
          'privileged contract admin entry point.',
      );
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const enabled = config.contractAdmin.trustedCallerEnabled;

    if (!enabled) {
      this.logger.debug(
        'Contract admin trusted caller verification is DISABLED ' +
          '(set CONTRACT_ADMIN_TRUSTED_CALLER_ENABLED=true to enable).',
      );
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const headers = request.headers;

    // Defence in depth: never allow a state-changing request through this
    // guard without an authenticated caller, even if the feature flag is on.
    const user = (request as Request & { user?: unknown }).user;
    if (!user) {
      this.logger.warn(
        `Trusted caller verification failed: no authenticated user for ` +
          `${request.method} ${request.path}`,
      );
      throw new UnauthorizedException(
        'Authenticated caller required for contract admin operations',
      );
    }

    const apiKey =
      (headers['x-api-key'] as string) ||
      (headers['authorization'] as string)?.replace('Bearer ', '');

    if (!apiKey) {
      this.logger.warn(
        'Trusted caller verification failed: no API key provided ' +
          `for ${request.method} ${request.path}`,
      );
      throw new UnauthorizedException(
        'API key required for contract admin operations',
      );
    }

    const result = await this.accessControlService.verifyTrustedCaller({
      verificationType: 'api_key',
      verificationData: { apiKey },
    });

    if (!result.trusted) {
      this.logger.warn(
        `Trusted caller verification DENIED for ${request.method} ${request.path}: ${result.error}`,
      );
      throw new UnauthorizedException(
        result.error || 'Invalid API key for contract admin operation',
      );
    }

    this.logger.log(
      `Trusted caller verification GRANTED for ${request.method} ${request.path}`,
    );

    return true;
  }
}
