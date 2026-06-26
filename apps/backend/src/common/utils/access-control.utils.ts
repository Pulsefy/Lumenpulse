/* eslint-disable @typescript-eslint/no-unsafe-enum-comparison */
import { UserRole } from '../../users/entities/user.entity';
import {
  AccessControlContext,
  AccessControlResource,
  AccessAction,
  ResourceType,
} from '../interfaces/access-control.interface';

/**
 * Utility functions for common access control patterns
 */
export class AccessControlUtils {
  /**
   * Check if a context represents an admin user
   */
  static isAdmin(context: AccessControlContext): boolean {
    return context.userRole === UserRole.ADMIN;
  }

  /**
   * Check if a context represents a reviewer user
   */
  static isReviewer(context: AccessControlContext): boolean {
    return context.userRole === UserRole.REVIEWER;
  }

  /**
   * Check if a context represents a regular user
   */
  static isUser(context: AccessControlContext): boolean {
    return context.userRole === UserRole.USER;
  }

  /**
   * Check if a context has any of the specified roles
   */
  static hasAnyRole(context: AccessControlContext, roles: UserRole[]): boolean {
    return context.userRole ? roles.includes(context.userRole) : false;
  }

  /**
   * Check if a context represents the owner of a resource
   */
  static isOwner(
    context: AccessControlContext,
    resource: AccessControlResource,
  ): boolean {
    if (!context.userId || !resource.ownerId) {
      return false;
    }
    return context.userId === resource.ownerId;
  }

  /**
   * Check if a context represents the resource itself (for user resources)
   */
  static isSelf(
    context: AccessControlContext,
    resource: AccessControlResource,
  ): boolean {
    if (!context.userId || resource.type !== ResourceType.USER) {
      return false;
    }
    return context.userId === resource.id;
  }

  /**
   * Create a resource object for a user
   */
  static createUserResource(userId: string): AccessControlResource {
    return {
      type: ResourceType.USER,
      id: userId,
      ownerId: userId, // Users own themselves
    };
  }

  /**
   * Create a resource object for a user-owned resource
   */
  static createUserOwnedResource(
    type: ResourceType,
    resourceId: string,
    ownerId: string,
  ): AccessControlResource {
    return {
      type,
      id: resourceId,
      ownerId,
    };
  }

  /**
   * Create a resource object for a public resource
   */
  static createPublicResource(
    type: ResourceType,
    resourceId: string,
  ): AccessControlResource {
    return {
      type,
      id: resourceId,
      // No ownerId for public resources
    };
  }

  /**
   * Check if an action is a read operation
   */
  static isReadAction(action: string): boolean {
    return action === AccessAction.READ;
  }

  /**
   * Check if an action is a write operation
   */
  static isWriteAction(action: string): boolean {
    const writeActions: string[] = [AccessAction.WRITE, AccessAction.DELETE];
    return writeActions.includes(action);
  }

  /**
   * Check if an action is an admin operation
   */
  static isAdminAction(action: string): boolean {
    return action === AccessAction.ADMIN;
  }

  /**
   * Get the minimum role required for an action on a resource type
   */
  static getMinimumRoleForAction(
    action: string,
    resourceType: string,
  ): UserRole | null {
    // Admin actions always require admin role
    if (action === AccessAction.ADMIN) {
      return UserRole.ADMIN;
    }

    const resourceTypeEnum = resourceType as ResourceType;

    switch (resourceTypeEnum) {
      case ResourceType.GRANT:
        // Grants require reviewer role for write operations
        if (AccessControlUtils.isWriteAction(action)) {
          return UserRole.REVIEWER;
        }
        return UserRole.USER;

      case ResourceType.METRICS:
        // Metrics require authentication but no specific role
        return UserRole.USER;

      case ResourceType.USER:
      case ResourceType.PORTFOLIO:
      case ResourceType.STELLAR_ACCOUNT:
        // User-owned resources require authentication
        return UserRole.USER;

      case ResourceType.NEWS:
      case ResourceType.ANALYTICS:
        // Public resources require authentication
        return UserRole.USER;

      default:
        // Unknown resources require admin by default
        return UserRole.ADMIN;
    }
  }

  /**
   * Create a context for system operations (no user)
   */
  static createSystemContext(): AccessControlContext {
    return {
      metadata: {
        system: true,
      },
    };
  }

  /**
   * Create a context for webhook operations
   */
  static createWebhookContext(
    provider: string,
    ipAddress?: string,
  ): AccessControlContext {
    return {
      webhookProvider: provider,
      ipAddress,
      metadata: {
        webhook: true,
      },
    };
  }

  /**
   * Check if a context represents a system operation
   */
  static isSystemContext(context: AccessControlContext): boolean {
    return !!context.metadata?.system;
  }

  /**
   * Check if a context represents a webhook operation
   */
  static isWebhookContext(context: AccessControlContext): boolean {
    return !!context.webhookProvider;
  }

  /**
   * Merge multiple contexts (useful for complex scenarios)
   */
  static mergeContexts(
    primary: AccessControlContext,
    ...additional: AccessControlContext[]
  ): AccessControlContext {
    return additional.reduce(
      (merged, context) => ({
        ...merged,
        ...context,
        metadata: {
          ...merged.metadata,
          ...context.metadata,
        },
      }),
      primary,
    );
  }

  /**
   * Validate that a context has the minimum required information
   */
  static validateContext(context: AccessControlContext): boolean {
    // At minimum, we need either a user ID or a webhook provider
    return !!(
      context.userId ||
      context.webhookProvider ||
      context.metadata?.system
    );
  }

  /**
   * Get a human-readable description of a context
   */
  static describeContext(context: AccessControlContext): string {
    if (context.metadata?.system) {
      return 'System';
    }

    if (context.webhookProvider) {
      return `Webhook (${context.webhookProvider})`;
    }

    if (context.userId) {
      const role = context.userRole ? ` (${context.userRole})` : '';
      return `User ${context.userId}${role}`;
    }

    return 'Anonymous';
  }

  /**
   * Get a human-readable description of a resource
   */
  static describeResource(resource: AccessControlResource): string {
    const owner = resource.ownerId ? ` owned by ${resource.ownerId}` : '';
    return `${resource.type} ${resource.id}${owner}`;
  }
}
