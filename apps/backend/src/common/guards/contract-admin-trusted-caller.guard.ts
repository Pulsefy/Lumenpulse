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

  constructor(
    private readonly accessControlService: AccessControlService,
  ) {}

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
