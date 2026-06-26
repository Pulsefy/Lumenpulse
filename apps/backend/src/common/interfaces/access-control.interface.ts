import { UserRole } from '../../users/entities/user.entity';

/**
 * Represents a caller that can be authenticated and authorized
 */
export interface AccessControlContext {
  /** User ID if authenticated via JWT */
  userId?: string;

  /** User role if authenticated */
  userRole?: UserRole;

  /** Stellar public key if available */
  stellarPublicKey?: string;

  /** IP address of the caller */
  ipAddress?: string;

  /** Webhook provider name if verified */
  webhookProvider?: string;

  /** Additional context data */
  metadata?: Record<string, any>;
}

/**
 * Represents a resource that can be protected
 */
export interface AccessControlResource {
  /** Resource type (e.g., 'user', 'portfolio', 'grant') */
  type: string;

  /** Resource identifier */
  id: string;

  /** Resource owner ID if applicable */
  ownerId?: string;

  /** Additional resource metadata */
  metadata?: Record<string, any>;
}

/**
 * Represents a permission check request
 */
export interface PermissionRequest {
  /** The action being requested (e.g., 'read', 'write', 'delete') */
  action: string;

  /** The resource being accessed */
  resource: AccessControlResource;

  /** The caller context */
  context: AccessControlContext;
}

/**
 * Result of a permission check
 */
export interface PermissionResult {
  /** Whether access is granted */
  granted: boolean;

  /** Reason for denial if access is not granted */
  reason?: string;

  /** Additional metadata about the decision */
  metadata?: Record<string, any>;
}

/**
 * Represents a trusted caller verification request
 */
export interface TrustedCallerRequest {
  /** Type of verification (e.g., 'webhook', 'ip-allowlist', 'api-key') */
  verificationType: string;

  /** Verification data (signature, IP, key, etc.) */
  verificationData: Record<string, any>;

  /** Raw request data if needed for verification */
  rawData?: Buffer;
}

/**
 * Result of trusted caller verification
 */
export interface TrustedCallerResult {
  /** Whether the caller is trusted */
  trusted: boolean;

  /** Identifier of the trusted caller (provider name, etc.) */
  callerId?: string;

  /** Error message if verification failed */
  error?: string;

  /** Additional verification metadata */
  metadata?: Record<string, any>;
}

/**
 * Shared access control interface that protocol modules can use
 * to query roles, permissions, and trusted callers in a standardized way
 */
export interface IAccessControlService {
  /**
   * Check if a user has a specific role
   */
  hasRole(userId: string, role: UserRole): Promise<boolean>;

  /**
   * Check if a user has any of the specified roles
   */
  hasAnyRole(userId: string, roles: UserRole[]): Promise<boolean>;

  /**
   * Get all roles for a user
   */
  getUserRoles(userId: string): Promise<UserRole[]>;

  /**
   * Check if a caller has permission to perform an action on a resource
   */
  checkPermission(request: PermissionRequest): Promise<PermissionResult>;

  /**
   * Check if a caller owns a specific resource
   */
  checkOwnership(
    userId: string,
    resource: AccessControlResource,
  ): Promise<boolean>;

  /**
   * Verify if a caller is trusted (webhook, IP allowlist, etc.)
   */
  verifyTrustedCaller(
    request: TrustedCallerRequest,
  ): Promise<TrustedCallerResult>;

  /**
   * Check if an IP address is in the allowlist for a specific service
   */
  isIpAllowed(ipAddress: string, service?: string): Promise<boolean>;

  /**
   * Create an access control context from request data
   */
  createContext(requestData: {
    user?: any;
    ip?: string;
    headers?: Record<string, string>;
  }): AccessControlContext;

  /**
   * Validate that a context has the required permissions for a resource
   */
  validateAccess(
    context: AccessControlContext,
    action: string,
    resource: AccessControlResource,
  ): Promise<PermissionResult>;
}

/**
 * Standard actions that can be performed on resources
 */
export enum AccessAction {
  READ = 'read',
  WRITE = 'write',
  DELETE = 'delete',
  ADMIN = 'admin',
  EXECUTE = 'execute',
}

/**
 * Standard resource types in the system
 */
export enum ResourceType {
  USER = 'user',
  PORTFOLIO = 'portfolio',
  STELLAR_ACCOUNT = 'stellar_account',
  GRANT = 'grant',
  NEWS = 'news',
  ANALYTICS = 'analytics',
  WEBHOOK = 'webhook',
  METRICS = 'metrics',
}

/**
 * Verification types for trusted callers
 */
export enum VerificationType {
  WEBHOOK_SIGNATURE = 'webhook_signature',
  IP_ALLOWLIST = 'ip_allowlist',
  API_KEY = 'api_key',
  MUTUAL_TLS = 'mutual_tls',
}
