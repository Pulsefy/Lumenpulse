/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */

import {
  SetMetadata,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';
import {
  AccessAction,
  ResourceType as ResourceTypeEnum,
  AccessControlContext,
  AccessControlResource,
  PermissionResult,
} from '../interfaces/access-control.interface';

/**
 * Metadata keys for access control decorators
 */
export const REQUIRED_PERMISSION_KEY = 'required_permission';
export const RESOURCE_TYPE_KEY = 'resource_type';
export const TRUSTED_CALLER_KEY = 'trusted_caller';

/**
 * Interface for permission metadata
 */
export interface PermissionMetadata {
  action: AccessAction | string;
  resourceType: ResourceTypeEnum | string;
  resourceIdParam?: string; // Parameter name that contains the resource ID
  ownerIdParam?: string; // Parameter name that contains the owner ID
}

/**
 * Interface for trusted caller metadata
 */
export interface TrustedCallerMetadata {
  verificationType: string;
  required?: boolean; // If true, request fails if verification fails
}

/**
 * Decorator to require specific permissions for a route
 *
 * @example
 * @RequirePermission({
 *   action: AccessAction.READ,
 *   resourceType: ResourceType.PORTFOLIO,
 *   resourceIdParam: 'portfolioId',
 *   ownerIdParam: 'userId'
 * })
 * @Get(':portfolioId')
 * getPortfolio(@Param('portfolioId') portfolioId: string) { ... }
 */
export const RequirePermission = (metadata: PermissionMetadata) =>
  SetMetadata(REQUIRED_PERMISSION_KEY, metadata);

/**
 * Decorator to specify the resource type for a route
 * Used in combination with permission guards
 */
export const ResourceTypeDecorator = (type: ResourceTypeEnum | string) =>
  SetMetadata(RESOURCE_TYPE_KEY, type);

/**
 * Decorator to require trusted caller verification
 *
 * @example
 * @RequireTrustedCaller({
 *   verificationType: 'webhook_signature',
 *   required: true
 * })
 * @Post('webhook')
 * handleWebhook(@Body() data: any) { ... }
 */
export const RequireTrustedCaller = (metadata: TrustedCallerMetadata) =>
  SetMetadata(TRUSTED_CALLER_KEY, metadata);

/**
 * Decorator to get the access control context from the request
 * Usage: @GetAccessContext() context: AccessControlContext
 */
export const GetAccessContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessControlContext | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request.accessContext;
  },
);

/**
 * Decorator to get the resource information from the request
 * Usage: @GetResource() resource: AccessControlResource
 */
export const GetResource = createParamDecorator(
  (
    _data: unknown,
    ctx: ExecutionContext,
  ): AccessControlResource | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request.accessResource;
  },
);

/**
 * Decorator to get the permission result from the request
 * Usage: @GetPermissionResult() result: PermissionResult
 */
export const GetPermissionResult = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PermissionResult | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request.permissionResult;
  },
);

/**
 * Convenience decorators for common permission patterns
 */

/**
 * Require read access to a user resource
 */
export const RequireUserRead = (resourceIdParam = 'userId') =>
  RequirePermission({
    action: AccessAction.READ,
    resourceType: ResourceTypeEnum.USER,
    resourceIdParam,
  });

/**
 * Require write access to a user resource
 */
export const RequireUserWrite = (resourceIdParam = 'userId') =>
  RequirePermission({
    action: AccessAction.WRITE,
    resourceType: ResourceTypeEnum.USER,
    resourceIdParam,
  });

/**
 * Require read access to a portfolio resource
 */
export const RequirePortfolioRead = (
  resourceIdParam = 'portfolioId',
  ownerIdParam = 'userId',
) =>
  RequirePermission({
    action: AccessAction.READ,
    resourceType: ResourceTypeEnum.PORTFOLIO,
    resourceIdParam,
    ownerIdParam,
  });

/**
 * Require write access to a portfolio resource
 */
export const RequirePortfolioWrite = (
  resourceIdParam = 'portfolioId',
  ownerIdParam = 'userId',
) =>
  RequirePermission({
    action: AccessAction.WRITE,
    resourceType: ResourceTypeEnum.PORTFOLIO,
    resourceIdParam,
    ownerIdParam,
  });

/**
 * Require webhook verification
 */
export const RequireWebhookVerification = (required = true) =>
  RequireTrustedCaller({
    verificationType: 'webhook_signature',
    required,
  });

/**
 * Require IP allowlist verification
 */
export const RequireIpAllowlist = (required = true) =>
  RequireTrustedCaller({
    verificationType: 'ip_allowlist',
    required,
  });
