/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-enum-comparison */
/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AccessControlService } from '../services/access-control.service';
import {
  AccessControlContext,
  AccessControlResource,
  PermissionResult,
  TrustedCallerRequest,
  VerificationType,
} from '../interfaces/access-control.interface';
import {
  REQUIRED_PERMISSION_KEY,
  RESOURCE_TYPE_KEY,
  TRUSTED_CALLER_KEY,
  PermissionMetadata,
  TrustedCallerMetadata,
} from '../decorators/access-control.decorators';

// Extend Request interface to include our custom properties
interface ExtendedRequest extends Request {
  accessContext?: AccessControlContext;
  accessResource?: AccessControlResource;
  permissionResult?: PermissionResult;
  trustedCallerResult?: any;
}

/**
 * Unified guard that handles both permission checking and trusted caller verification
 * using the shared access control interface
 */
@Injectable()
export class AccessControlGuard implements CanActivate {
  private readonly logger = new Logger(AccessControlGuard.name);

  constructor(
    private readonly accessControlService: AccessControlService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ExtendedRequest>();

    // Create access control context
    const accessContext = this.createAccessContext(request);
    request.accessContext = accessContext;

    // Check trusted caller requirements first
    const trustedCallerResult = await this.checkTrustedCaller(context, request);
    if (trustedCallerResult !== null && !trustedCallerResult) {
      return false;
    }

    // Check permission requirements
    const permissionResult = await this.checkPermissions(
      context,
      request,
      accessContext,
    );
    if (permissionResult !== null && !permissionResult.granted) {
      throw new ForbiddenException(permissionResult.reason || 'Access denied');
    }

    return true;
  }

  /**
   * Create access control context from request
   */
  private createAccessContext(request: ExtendedRequest): AccessControlContext {
    const user = (request as any).user;
    const ip = this.getClientIp(request);

    return this.accessControlService.createContext({
      user,
      ip,
      headers: request.headers as Record<string, string>,
    });
  }

  /**
   * Extract client IP from request
   */
  private getClientIp(request: Request): string {
    const forwarded = request.headers['x-forwarded-for'] as string;
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }
    return (
      request.connection.remoteAddress || request.socket.remoteAddress || ''
    );
  }

  /**
   * Check trusted caller requirements
   */
  private async checkTrustedCaller(
    context: ExecutionContext,
    request: ExtendedRequest,
  ): Promise<boolean | null> {
    const trustedCallerMeta =
      this.reflector.getAllAndOverride<TrustedCallerMetadata>(
        TRUSTED_CALLER_KEY,
        [context.getHandler(), context.getClass()],
      );

    if (!trustedCallerMeta) {
      return null; // No trusted caller requirement
    }

    const { verificationType, required = true } = trustedCallerMeta;

    try {
      const verificationRequest = this.buildTrustedCallerRequest(
        verificationType,
        request,
      );

      const result =
        await this.accessControlService.verifyTrustedCaller(
          verificationRequest,
        );

      if (!result.trusted && required) {
        this.logger.warn(`Trusted caller verification failed: ${result.error}`);
        throw new UnauthorizedException(
          result.error || 'Trusted caller verification failed',
        );
      }

      // Store verification result in request for later use
      request.trustedCallerResult = result;

      return result.trusted;
    } catch (error) {
      if (required) {
        throw error;
      }
      this.logger.warn('Optional trusted caller verification failed:', error);
      return false;
    }
  }

  /**
   * Build trusted caller verification request
   */
  private buildTrustedCallerRequest(
    verificationType: string,
    request: ExtendedRequest,
  ): TrustedCallerRequest {
    const headers = request.headers;
    const ip = this.getClientIp(request);

    switch (verificationType) {
      case VerificationType.WEBHOOK_SIGNATURE:
        return {
          verificationType,
          verificationData: {
            provider: headers['x-webhook-provider'] || 'default',
            signature: headers['x-webhook-signature'] || headers['signature'],
            timestamp: headers['x-webhook-timestamp'] || headers['timestamp'],
          },
          rawData: (request as any).rawBody,
        };

      case VerificationType.IP_ALLOWLIST:
        return {
          verificationType,
          verificationData: {
            ip,
            service: headers['x-service-name'],
          },
        };

      case VerificationType.API_KEY:
        return {
          verificationType,
          verificationData: {
            apiKey:
              headers['x-api-key'] ||
              headers['authorization']?.replace('Bearer ', ''),
          },
        };

      default:
        throw new Error(`Unsupported verification type: ${verificationType}`);
    }
  }

  /**
   * Check permission requirements
   */
  private async checkPermissions(
    context: ExecutionContext,
    request: ExtendedRequest,
    accessContext: AccessControlContext,
  ): Promise<PermissionResult | null> {
    const permissionMeta = this.reflector.getAllAndOverride<PermissionMetadata>(
      REQUIRED_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!permissionMeta) {
      return null; // No permission requirement
    }

    const resource = this.buildAccessResource(permissionMeta, request);
    request.accessResource = resource;

    const permissionResult = await this.accessControlService.checkPermission({
      action: permissionMeta.action,
      resource,
      context: accessContext,
    });

    request.permissionResult = permissionResult;

    return permissionResult;
  }

  /**
   * Build access control resource from metadata and request
   */
  private buildAccessResource(
    metadata: PermissionMetadata,
    request: ExtendedRequest,
  ): AccessControlResource {
    const params = (request as any).params || {};
    const query = (request as any).query || {};
    const body = (request as any).body || {};

    // Extract resource ID from parameters
    const resourceId = metadata.resourceIdParam
      ? params[metadata.resourceIdParam] || query[metadata.resourceIdParam]
      : 'unknown';

    // Extract owner ID from parameters
    const ownerId = metadata.ownerIdParam
      ? params[metadata.ownerIdParam] ||
        query[metadata.ownerIdParam] ||
        body[metadata.ownerIdParam]
      : undefined;

    return {
      type: metadata.resourceType,
      id: resourceId,
      ownerId,
      metadata: {
        params,
        query,
        body,
      },
    };
  }
}
