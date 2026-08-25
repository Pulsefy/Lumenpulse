import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { UserRole } from '../../users/entities/user.entity';
import { ROLES_KEY } from '../../auth/decorators/auth.decorators';
import { ContractAdminAuditService } from '../../contract-admin/contract-admin-audit.service';

// Define a minimal user interface for type safety
interface RequestUser {
  id: string;
  role: UserRole;
  email?: string;
}

// Extend Express Request to include our user
interface AuthenticatedRequest extends Request {
  user?: RequestUser;
}

/**
 * Shared RBAC guard for all contract admin operations.
 * Provides consistent authorization checks and logging across treasury,
 * registry, and matching round admin routes.
 */
@Injectable()
export class ContractAdminGuard implements CanActivate {
  private readonly logger = new Logger(ContractAdminGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: ContractAdminAuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    // Check if user is authenticated
    if (!user) {
      const endpoint = `${request.method} ${request.path}`;
      this.logger.warn(
        `Unauthenticated access attempt to contract admin route: ${endpoint}`,
        {
          path: request.path,
          method: request.method,
          ip: this.getClientIp(request),
        },
      );

      // Log unauthorized attempt
      await this.auditService.logUnauthorizedAttempt(
        'anonymous',
        endpoint,
        request as Request,
        'Authentication required',
      );

      throw new UnauthorizedException(
        'Authentication required for contract admin operations',
      );
    }

    // Get required roles from decorator
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no roles required, allow access (but should always have roles for admin routes)
    if (!requiredRoles || requiredRoles.length === 0) {
      this.logger.warn(
        `No roles specified for contract admin route: ${request.path}. ` +
          `This should be fixed to ensure proper authorization.`,
      );
      return true;
    }

    // Check if user has required role
    const userRole = user.role;
    const hasRole = requiredRoles.includes(userRole);

    // Log authorization decision
    const endpoint = `${request.method} ${request.path}`;
    const authDecision = {
      userId: user.id,
      userRole: userRole,
      requiredRoles: requiredRoles,
      path: request.path,
      method: request.method,
      granted: hasRole,
      timestamp: new Date().toISOString(),
    };

    if (hasRole) {
      this.logger.log(
        `Authorization GRANTED for user ${user.id} (role: ${userRole}) ` +
          `to access ${endpoint}`,
        authDecision,
      );
    } else {
      this.logger.warn(
        `Authorization DENIED for user ${user.id} (role: ${userRole}) ` +
          `to access ${endpoint}. Required roles: ${requiredRoles.join(', ')}`,
        authDecision,
      );

      // Log unauthorized attempt
      await this.auditService.logUnauthorizedAttempt(
        user.id,
        endpoint,
        request as Request,
        `Required roles: ${requiredRoles.join(', ')}. User role: ${userRole || 'none'}`,
      );

      throw new ForbiddenException(
        `Access denied. Required roles: ${requiredRoles.join(', ')}. ` +
          `Your role: ${userRole || 'none'}`,
      );
    }

    return true;
  }

  /**
   * Extract client IP from request
   */
  private getClientIp(request: Request): string {
    const forwarded = request.headers['x-forwarded-for'] as string;
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }

    // Safely access connection and socket properties
    const req = request as Request & {
      connection?: { remoteAddress?: string };
      socket?: { remoteAddress?: string };
    };

    return (
      req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown'
    );
  }
}
