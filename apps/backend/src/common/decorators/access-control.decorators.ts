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
 * Metadata key used to mark an entry point as privileged / auth-requiring.
 * This is the canonical marker consumed by the audit tooling and the
 * authorisation guard to ensure every privileged entry point enforces auth.
 */
export const REQUIRE_AUTH_KEY = 'require_auth';

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
 * Interface for require_auth metadata.
 */
export interface RequireAuthMetadata {
  /** The role(s) that are authorised to invoke the entry point. */
  roles?: string[];
  /** Human-readable label for the inventory table. */
  label?: string;
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
 * Decorator to mark a privileged entry point as requiring authorisation.
 *
 * This is the canonical marker for the audit inventory. Any public entry
 * point that mutates state must be annotated with `u@RequireAuth()` and the
 * authorisation guard will reject callers that do not carry a valid
 * authorised caller context.
 *
 * @example
 * @RequireAuth({ roles: ['admin'], label: 'Admin operation' })
 * @Post('admin/operation')
 * performAdminOperation() { ... }
 */
export const RequireAuth = (metadata: RequireAuthMetadata = {}) =>
  SetMetadata(REQUIRE_AUTH_KEY, {
    roles: metadata.roles ?? [],
    label: metadata.label ?? 'privileged entry point',
  });

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

/**
 * Require API key verification for trusted caller access.
 * Checks the x-api-key header or Bearer token against configured keys.
 *
 * @example
 * @RequireApiKey()
 * @Post('admin/operation')
 * performAdminOperation() { ... }
 */
export const RequireApiKey = (required = true) =>
  RequireTrustedCaller( {
    verificationType: 'api_key',
    required,
  });
