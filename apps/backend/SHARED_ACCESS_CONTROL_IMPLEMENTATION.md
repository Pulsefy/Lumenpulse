# Shared Access Control Interface Implementation

## Overview

This implementation provides a standardized access control interface that allows protocol modules to query roles, permissions, and trusted callers in a unified way. The solution addresses the complexity of managing access control across multiple modules while maintaining consistency and security.

## Architecture

### Core Components

1. **IAccessControlService Interface** (`src/common/interfaces/access-control.interface.ts`)
   - Defines the contract for access control operations
   - Standardizes data structures for contexts, resources, and permissions
   - Provides enums for common actions, resource types, and verification types

2. **AccessControlService Implementation** (`src/common/services/access-control.service.ts`)
   - Concrete implementation of the interface
   - Integrates with existing authentication and webhook systems
   - Provides role checking, permission validation, and trusted caller verification

3. **AccessControlGuard** (`src/common/guards/access-control.guard.ts`)
   - Unified guard that handles both permission checking and trusted caller verification
   - Works with decorators to provide declarative access control
   - Integrates seamlessly with existing JWT authentication

4. **Decorators** (`src/common/decorators/access-control.decorators.ts`)
   - Declarative way to specify access control requirements
   - Convenience decorators for common patterns
   - Parameter decorators to inject access control data into handlers

5. **Utilities** (`src/common/utils/access-control.utils.ts`)
   - Helper functions for common access control patterns
   - Context and resource creation utilities
   - Role and permission checking helpers

## Key Features

### 1. Unified Permission Model

```typescript
// Check permissions programmatically
const result = await accessControl.checkPermission({
  action: AccessAction.READ,
  resource: { type: ResourceType.PORTFOLIO, id: portfolioId, ownerId: userId },
  context: { userId, userRole: UserRole.USER }
});

// Use declarative decorators
@RequirePortfolioRead('portfolioId', 'userId')
@Get('portfolios/:portfolioId')
async getPortfolio(@Param('portfolioId') id: string) { ... }
```

### 2. Role-Based Access Control

- Supports existing user roles: USER, REVIEWER, ADMIN
- Hierarchical permission checking (admin > reviewer > user)
- Flexible role checking with `hasRole()` and `hasAnyRole()`

### 3. Resource Ownership

- Automatic ownership verification for user-owned resources
- Support for complex ownership patterns
- Owner-based access control with fallback to role-based permissions

### 4. Trusted Caller Verification

- Webhook signature verification using existing WebhookVerificationService
- IP allowlist checking with CIDR support
- Extensible framework for additional verification types (API keys, mTLS)

### 5. Declarative Access Control

```typescript
// Simple user resource access
@RequireUserRead('userId')
@Get('users/:userId')

// Custom permissions
@RequirePermission({
  action: AccessAction.WRITE,
  resourceType: ResourceType.GRANT,
  resourceIdParam: 'grantId'
})

// Trusted caller verification
@RequireWebhookVerification()
@Post('webhooks/payment')
```

## Integration Points

### 1. Existing Authentication System

- Integrates with existing `JwtAuthGuard` and `JwtStrategy`
- Uses existing `User` entity and role system
- Maintains backward compatibility with current auth decorators

### 2. Webhook Verification Framework

- Leverages existing `WebhookVerificationService`
- Supports all existing signature algorithms
- Maintains provider-based configuration

### 3. IP Allowlist System

- Extends existing IP allowlist functionality from metrics module
- Supports service-specific allowlists
- CIDR notation support for network ranges

## Usage Patterns

### 1. Controller-Level Protection

```typescript
@Controller('api')
@UseGuards(JwtAuthGuard, AccessControlGuard)
export class MyController {
  @RequireUserRead('userId')
  @Get('users/:userId')
  async getUser(@Param('userId') userId: string) { ... }
}
```

### 2. Service-Level Checks

```typescript
@Injectable()
export class MyService {
  constructor(private readonly accessControl: IAccessControlService) {}

  async performOperation(userId: string, resourceId: string) {
    const hasPermission = await this.accessControl.checkPermission({
      action: AccessAction.WRITE,
      resource: { type: ResourceType.PORTFOLIO, id: resourceId },
      context: { userId }
    });

    if (!hasPermission.granted) {
      throw new ForbiddenException(hasPermission.reason);
    }
  }
}
```

### 3. Webhook Endpoints

```typescript
@RequireWebhookVerification()
@Post('webhooks/:provider')
async handleWebhook(
  @Param('provider') provider: string,
  @Body() data: any,
  @GetAccessContext() context: AccessControlContext
) {
  // Webhook signature already verified
  // Provider info available in context.webhookProvider
}
```

## Security Features

### 1. Defense in Depth

- Multiple layers of access control (authentication, authorization, ownership)
- Fail-secure defaults (deny access when in doubt)
- Comprehensive logging and error handling

### 2. Principle of Least Privilege

- Resource-specific permissions
- Action-based access control
- Owner-based restrictions

### 3. Trusted Caller Verification

- Cryptographic signature verification for webhooks
- IP-based access control with CIDR support
- Extensible verification framework

## Performance Considerations

### 1. Caching

- User role information cached at request level
- Database queries optimized with selective field loading
- Webhook verification results cached in request context

### 2. Efficient Queries

- Single database query for role checking
- Optimized permission checking logic
- Minimal overhead for common operations

## Testing

### 1. Unit Tests

- Comprehensive test coverage for AccessControlService
- Mock-based testing for external dependencies
- Edge case testing for permission logic

### 2. Integration Tests

- End-to-end testing with AccessControlGuard
- Real database testing for role queries
- Webhook verification testing

## Migration Path

### 1. Gradual Adoption

- Existing guards continue to work alongside new system
- Module-by-module migration possible
- Backward compatibility maintained

### 2. Migration Steps

1. Import AccessControlModule in target module
2. Replace existing guards with AccessControlGuard
3. Update decorators to use new access control decorators
4. Test thoroughly to ensure equivalent behavior

## Configuration

### Environment Variables

```bash
# IP Allowlists
ALLOWED_IPS=192.168.1.0/24,10.0.0.1
METRICS_ALLOWED_IPS=127.0.0.1,::1

# Service-specific allowlists
SERVICE_NAME_ALLOWED_IPS=192.168.1.0/24

# Webhook configuration (existing)
WEBHOOK_PROVIDERS='[{"name":"github","algorithm":"hmac-sha256","secret":"secret123","enabled":true}]'
```

## Benefits

### 1. Consistency

- Standardized access control patterns across all modules
- Unified error handling and response formats
- Consistent permission checking logic

### 2. Maintainability

- Centralized access control logic
- Declarative permission specifications
- Reduced code duplication

### 3. Security

- Comprehensive access control coverage
- Defense in depth approach
- Fail-secure defaults

### 4. Flexibility

- Extensible verification framework
- Support for complex permission patterns
- Easy integration with existing systems

### 5. Developer Experience

- Simple, declarative API
- Comprehensive documentation and examples
- Type-safe interfaces and utilities

## Future Enhancements

### 1. Advanced Features

- Permission inheritance and composition
- Time-based access control
- Audit logging integration
- Rate limiting per user/resource

### 2. Additional Verification Types

- API key verification
- Mutual TLS authentication
- OAuth2 token verification
- Custom verification plugins

### 3. Performance Optimizations

- Redis-based caching for permissions
- Bulk permission checking
- Async permission pre-loading

This implementation provides a solid foundation for standardized access control across the protocol while maintaining flexibility for future enhancements and integrations.