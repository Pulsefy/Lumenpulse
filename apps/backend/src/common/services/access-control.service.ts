/* eslint-disable @typescript-eslint/no-unsafe-enum-comparison */
/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { User, UserRole } from '../../users/entities/user.entity';
import { WebhookVerificationService } from '../../webhook/webhook-verification.service';
import {
  IAccessControlService,
  AccessControlContext,
  AccessControlResource,
  PermissionRequest,
  PermissionResult,
  TrustedCallerRequest,
  TrustedCallerResult,
  AccessAction,
  ResourceType,
  VerificationType,
} from '../interfaces/access-control.interface';

/**
 * Concrete implementation of the shared access control interface
 */
@Injectable()
export class AccessControlService implements IAccessControlService {
  private readonly logger = new Logger(AccessControlService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly configService: ConfigService,
    private readonly webhookVerificationService: WebhookVerificationService,
  ) {}

  /**
   * Simple IP range checking utility
   */
  private isIpInRange(ip: string, range: string): boolean {
    try {
      if (!range.includes('/')) {
        // Exact match
        return ip === range;
      }

      // CIDR notation
      const [network, prefixLength] = range.split('/');
      const prefix = parseInt(prefixLength, 10);

      // Convert IP addresses to integers for comparison
      const ipInt = this.ipToInt(ip);
      const networkInt = this.ipToInt(network);

      // Create subnet mask
      const mask = (0xffffffff << (32 - prefix)) >>> 0;

      // Check if IP is in the network
      return (ipInt & mask) === (networkInt & mask);
    } catch (error) {
      this.logger.warn(`Error checking IP range ${ip} in ${range}:`, error);
      return false;
    }
  }

  /**
   * Convert IP address to integer
   */
  private ipToInt(ip: string): number {
    return (
      ip
        .split('.')
        .reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0
    );
  }

  /**
   * Check if a user has a specific role
   */
  async hasRole(userId: string, role: UserRole): Promise<boolean> {
    try {
      const user = await this.userRepository.findOne({
        where: { id: userId },
        select: ['role'],
      });

      return user?.role === role;
    } catch (error) {
      this.logger.error(`Error checking role for user ${userId}:`, error);
      return false;
    }
  }

  /**
   * Check if a user has any of the specified roles
   */
  async hasAnyRole(userId: string, roles: UserRole[]): Promise<boolean> {
    try {
      const user = await this.userRepository.findOne({
        where: { id: userId },
        select: ['role'],
      });

      return user ? roles.includes(user.role) : false;
    } catch (error) {
      this.logger.error(`Error checking roles for user ${userId}:`, error);
      return false;
    }
  }

  /**
   * Get all roles for a user (in this system, users have one role)
   */
  async getUserRoles(userId: string): Promise<UserRole[]> {
    try {
      const user = await this.userRepository.findOne({
        where: { id: userId },
        select: ['role'],
      });

      return user ? [user.role] : [];
    } catch (error) {
      this.logger.error(`Error getting roles for user ${userId}:`, error);
      return [];
    }
  }

  /**
   * Check if a caller has permission to perform an action on a resource
   */
  async checkPermission(request: PermissionRequest): Promise<PermissionResult> {
    const { action, resource, context } = request;

    // Admin users have access to everything
    if (context.userRole === UserRole.ADMIN) {
      return {
        granted: true,
        metadata: { reason: 'admin_access' },
      };
    }

    // Check ownership for user-owned resources
    if (resource.ownerId && context.userId) {
      const isOwner = resource.ownerId === context.userId;

      if (isOwner) {
        return {
          granted: true,
          metadata: { reason: 'owner_access' },
        };
      }
    }

    // Resource-specific permission logic
    const granted = await this.checkResourcePermission(
      action,
      resource,
      context,
    );

    return {
      granted,
      reason: granted ? undefined : 'insufficient_permissions',
      metadata: {
        action,
        resourceType: resource.type,
        userRole: context.userRole,
      },
    };
  }

  /**
   * Check resource-specific permissions
   */
  private async checkResourcePermission(
    action: string,
    resource: AccessControlResource,
    context: AccessControlContext,
  ): Promise<boolean> {
    const resourceType = resource.type as ResourceType;

    switch (resourceType) {
      case ResourceType.USER:
        return this.checkUserResourcePermission(action, resource, context);

      case ResourceType.PORTFOLIO:
      case ResourceType.STELLAR_ACCOUNT:
        return this.checkUserOwnedResourcePermission(action, resource, context);

      case ResourceType.GRANT:
        return this.checkGrantResourcePermission(action, resource, context);

      case ResourceType.NEWS:
      case ResourceType.ANALYTICS:
        return this.checkPublicResourcePermission(action, resource, context);

      case ResourceType.WEBHOOK:
        return this.checkWebhookResourcePermission(action, resource, context);

      case ResourceType.METRICS:
        return this.checkMetricsResourcePermission(action, resource, context);

      default:
        this.logger.warn(`Unknown resource type: ${resource.type}`);
        return false;
    }
  }

  /**
   * Check permissions for user resources
   */
  private checkUserResourcePermission(
    action: string,
    resource: AccessControlResource,
    context: AccessControlContext,
  ): boolean {
    // Users can read their own profile
    if (action === AccessAction.READ && context.userId === resource.id) {
      return true;
    }

    // Users can update their own profile
    if (action === AccessAction.WRITE && context.userId === resource.id) {
      return true;
    }

    // Reviewers can read user profiles
    if (
      action === AccessAction.READ &&
      context.userRole === UserRole.REVIEWER
    ) {
      return true;
    }

    return false;
  }

  /**
   * Check permissions for user-owned resources (portfolios, stellar accounts)
   */
  private checkUserOwnedResourcePermission(
    action: string,
    resource: AccessControlResource,
    context: AccessControlContext,
  ): boolean {
    // Owner has full access
    if (resource.ownerId === context.userId) {
      return true;
    }

    // Reviewers can read
    if (
      action === AccessAction.READ &&
      context.userRole === UserRole.REVIEWER
    ) {
      return true;
    }

    return false;
  }

  /**
   * Check permissions for grant resources
   */
  private checkGrantResourcePermission(
    action: string,
    resource: AccessControlResource,
    context: AccessControlContext,
  ): boolean {
    // Reviewers can read and write grants
    if (context.userRole === UserRole.REVIEWER) {
      return [AccessAction.READ, AccessAction.WRITE].includes(
        action as AccessAction,
      );
    }

    // Users can read grants
    if (action === AccessAction.READ && context.userRole === UserRole.USER) {
      return true;
    }

    return false;
  }

  /**
   * Check permissions for public resources (news, analytics)
   */
  private checkPublicResourcePermission(
    action: string,
    resource: AccessControlResource,
    context: AccessControlContext,
  ): boolean {
    // All authenticated users can read public resources
    if (action === AccessAction.READ && context.userId) {
      return true;
    }

    return false;
  }

  /**
   * Check permissions for webhook resources
   */
  private checkWebhookResourcePermission(
    action: string,
    resource: AccessControlResource,
    context: AccessControlContext,
  ): boolean {
    // Webhook providers can execute webhooks
    if (action === AccessAction.EXECUTE && context.webhookProvider) {
      return true;
    }

    return false;
  }

  /**
   * Check permissions for metrics resources
   */
  private checkMetricsResourcePermission(
    action: string,
    resource: AccessControlResource,
    context: AccessControlContext,
  ): boolean {
    // Metrics can be read by authenticated users or allowed IPs
    if (action === AccessAction.READ) {
      return !!(context.userId || context.metadata?.ipAllowed);
    }

    return false;
  }

  /**
   * Check if a caller owns a specific resource
   */
  checkOwnership(
    userId: string,
    resource: AccessControlResource,
  ): Promise<boolean> {
    // Direct ownership check
    if (resource.ownerId === userId) {
      return Promise.resolve(true);
    }

    // For user resources, check if the resource ID matches the user ID
    if (resource.type === ResourceType.USER && resource.id === userId) {
      return Promise.resolve(true);
    }

    // Additional ownership checks could be added here for complex resources
    return Promise.resolve(false);
  }

  /**
   * Verify if a caller is trusted (webhook, IP allowlist, etc.)
   */
  async verifyTrustedCaller(
    request: TrustedCallerRequest,
  ): Promise<TrustedCallerResult> {
    const { verificationType, verificationData, rawData } = request;

    switch (verificationType) {
      case VerificationType.WEBHOOK_SIGNATURE:
        return this.verifyWebhookSignature(verificationData, rawData);

      case VerificationType.IP_ALLOWLIST:
        return this.verifyIpAllowlist(verificationData);

      case VerificationType.API_KEY:
        return this.verifyApiKey(verificationData);

      default:
        return {
          trusted: false,
          error: `Unsupported verification type: ${verificationType}`,
        };
    }
  }

  /**
   * Verify webhook signature
   */
  private verifyWebhookSignature(
    verificationData: Record<string, any>,
    rawData?: Buffer,
  ): Promise<TrustedCallerResult> {
    const provider = verificationData.provider as string;
    const signature = verificationData.signature as string;
    const timestamp = verificationData.timestamp as string | undefined;

    if (!rawData) {
      return Promise.resolve({
        trusted: false,
        error: 'Raw data required for webhook verification',
      });
    }

    try {
      const result = this.webhookVerificationService.verifySignature(
        provider,
        rawData,
        signature,
        timestamp,
      );

      return Promise.resolve({
        trusted: result.valid,
        callerId: result.provider,
        error: result.error,
        metadata: {
          algorithm: result.algorithm,
          verifiedAt: result.verifiedAt,
        },
      });
    } catch (error) {
      this.logger.error('Webhook verification error:', error);
      return Promise.resolve({
        trusted: false,
        error: 'Webhook verification failed',
      });
    }
  }

  /**
   * Verify IP allowlist
   */
  private verifyIpAllowlist(
    verificationData: Record<string, any>,
  ): Promise<TrustedCallerResult> {
    const ip = verificationData.ip as string;
    const service = verificationData.service as string | undefined;

    return this.isIpAllowed(ip, service).then((allowed) => ({
      trusted: allowed,
      callerId: allowed ? `ip:${ip}` : undefined,
      error: allowed ? undefined : 'IP not in allowlist',
      metadata: { service },
    }));
  }

  /**
   * Verify API key (placeholder for future implementation)
   */
  private verifyApiKey(
    _verificationData: Record<string, any>,
  ): Promise<TrustedCallerResult> {
    // Placeholder - implement based on your API key strategy
    return Promise.resolve({
      trusted: false,
      error: 'API key verification not implemented',
    });
  }

  /**
   * Check if an IP address is in the allowlist for a specific service
   */
  isIpAllowed(ipAddress: string, service?: string): Promise<boolean> {
    try {
      // Get service-specific or default allowlist
      const configKey = service
        ? `${service.toUpperCase()}_ALLOWED_IPS`
        : 'ALLOWED_IPS';
      const allowedIpsStr = this.configService.get<string>(configKey);

      if (!allowedIpsStr) {
        return Promise.resolve(false);
      }

      const allowedIps = allowedIpsStr.split(',').map((ip) => ip.trim());

      const isAllowed = allowedIps.some((allowedIp) =>
        this.isIpInRange(ipAddress, allowedIp),
      );
      return Promise.resolve(isAllowed);
    } catch (error) {
      this.logger.error(`Error checking IP allowlist for ${ipAddress}:`, error);
      return Promise.resolve(false);
    }
  }

  /**
   * Create an access control context from request data
   */
  createContext(requestData: {
    user?: { id?: string; role?: UserRole; stellarPublicKey?: string };
    ip?: string;
    headers?: Record<string, string>;
  }): AccessControlContext {
    const { user, ip, headers } = requestData;

    return {
      userId: user?.id,
      userRole: user?.role,
      stellarPublicKey: user?.stellarPublicKey,
      ipAddress: ip,
      webhookProvider: headers?.['x-webhook-provider'],
      metadata: {
        userAgent: headers?.['user-agent'],
        origin: headers?.['origin'],
      },
    };
  }

  /**
   * Validate that a context has the required permissions for a resource
   */
  async validateAccess(
    context: AccessControlContext,
    action: string,
    resource: AccessControlResource,
  ): Promise<PermissionResult> {
    return this.checkPermission({
      action,
      resource,
      context,
    });
  }
}
