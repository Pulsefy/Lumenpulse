# Shared Access Control Interface Guide

This guide explains how to use the shared access control interface to standardize roles, permissions, and trusted caller verification across protocol modules.

## Overview

The shared access control interface provides a unified way for all modules to:
- Check user roles and permissions
- Verify resource ownership
- Validate trusted callers (webhooks, IP allowlists, API keys)
- Apply consistent access control patterns

## Core Components

### 1. Access Control Interface (`IAccessControlService`)

The main interface that all modules can use to query access control information:

```typescript
import { IAccessControlService } from 'src/common';

// Inject the service
constructor(private readonly accessControl: IAccessControlService) {}

// Check if user has a role
const isAdmin = await this.accessControl.hasRole(userId, UserRole.ADMIN);

// Check permissions
const result = await this.accessControl.checkPermission({
  action: AccessAction.READ,
  resource: { type: ResourceType.PORTFOLIO, id: portfolioId, ownerId: userId },
  context: { userId, userRole: UserRole.USER }
});
```

### 2. Decorators for Route Protection

Use decorators to declaratively protect routes:

```typescript
import { 
  RequirePermission, 
  RequireUserRead, 
  RequireWebhookVerification 
} from 'src/common';

// Simple user resource access
@RequireUserRead('userId')
@Get('users/:userId')
async getUser(@Param('userId') userId: string) { ... }

// Custom permission requirements
@RequirePermission({
  action: AccessAction.WRITE,
  resourceType: ResourceType.PORTFOLIO,
  resourceIdParam: 'portfolioId',
  ownerIdParam: 'userId'
})
@Put('portfolios/:portfolioId')
async updatePortfolio(@Param('portfolioId') id: string) { ... }

// Webhook verification
@RequireWebhookVerification()
@Post('webhooks/payment')
async handleWebhook(@Body() data: any) { ... }
```

### 3. Unified Guard

The `AccessControlGuard` handles both permission checking and trusted caller verification:

```typescript
import { AccessControlGuard } from 'src/common';

@Controller('api')
@UseGuards(JwtAuthGuard, AccessControlGuard)
export class MyController {
  // Routes are automatically protected based on decorators
}
```

## Usage Patterns

### 1. User-Owned Resources

For resources that belong to specific users (portfolios, accounts, etc.):

```typescript
// Controller
@RequirePortfolioRead('portfolioId', 'userId')
@Get('users/:userId/portfolios/:portfolioId')
async getPortfolio(
  @Param('userId') userId: string,
  @Param('portfolioId') portfolioId: string
) {
  // Access is automatically verified
  return this.portfolioService.findOne(portfolioId);
}

// Service
async canUserAccessPortfolio(userId: string, portfolioId: string): Promise<boolean> {
  const context = { userId, userRole: await this.getUserRole(userId) };
  const resource = { 
    type: ResourceType.PORTFOLIO, 
    id: portfolioId, 
    ownerId: await this.getPortfolioOwner(portfolioId) 
  };
  
  const result = await this.accessControl.checkPermission({
    action: AccessAction.READ,
    resource,
    context
  });
  
  return result.granted;
}
```

### 2. Role-Based Access

For resources that require specific roles:

```typescript
// Only reviewers can manage grants
@RequirePermission({
  action: AccessAction.WRITE,
  resourceType: ResourceType.GRANT,
  resourceIdParam: 'grantId'
})
@Post('grants')
async createGrant(@Body() grantData: CreateGrantDto) {
  return this.grantService.create(grantData);
}

// Check role programmatically
const canManageGrants = await this.accessControl.hasAnyRole(
  userId, 
  [UserRole.REVIEWER, UserRole.ADMIN]
);
```

### 3. Trusted Caller Verification

For webhooks and external integrations:

```typescript
// Webhook endpoint
@RequireWebhookVerification(true) // Required verification
@Post('webhooks/:provider')
async handleWebhook(
  @Param('provider') provider: string,
  @Body() data: any,
  @GetAccessContext() context: AccessControlContext
) {
  // Webhook signature is already verified
  // Provider info available in context.webhookProvider
  return this.webhookService.process(provider, data);
}

// IP allowlist protection
@RequireIpAllowlist(false) // Optional - falls back to JWT
@Get('metrics')
async getMetrics() {
  return this.metricsService.getAll();
}

// Programmatic verification
const isWebhookTrusted = await this.accessControl.verifyTrustedCaller({
  verificationType: VerificationType.WEBHOOK_SIGNATURE,
  verificationData: { provider, signature },
  rawData: requestBody
});
```

### 4. Admin Operations

For operations that require admin privileges:

```typescript
@RequirePermission({
  action: AccessAction.ADMIN,
  resourceType: ResourceType.USER,
  resourceIdParam: 'userId'
})
@Delete('users/:userId')
async deleteUser(@Param('userId') userId: string) {
  return this.userService.delete(userId);
}
```

## Module Integration

### 1. Import the Access Control Module

```typescript
import { AccessControlModule } from 'src/common';

@Module({
  imports: [
    AccessControlModule, // Import the shared module
    // ... other imports
  ],
  // ...
})
export class MyModule {}
```

### 2. Use in Services

```typescript
import { IAccessControlService } from 'src/common';

@Injectable()
export class MyService {
  constructor(
    private readonly accessControl: IAccessControlService,
  ) {}

  async performOperation(userId: string, resourceId: string) {
    // Check permissions before proceeding
    const hasPermission = await this.accessControl.checkPermission({
      action: AccessAction.WRITE,
      resource: { type: ResourceType.PORTFOLIO, id: resourceId },
      context: { userId }
    });

    if (!hasPermission.granted) {
      throw new ForbiddenException(hasPermission.reason);
    }

    // Proceed with operation
  }
}
```

### 3. Custom Permission Logic

For complex business rules, extend the base permission checking:

```typescript
@Injectable()
export class CustomAccessControlService {
  constructor(
    private readonly baseAccessControl: IAccessControlService,
  ) {}

  async checkCustomPermission(
    userId: string, 
    action: string, 
    resourceId: string
  ): Promise<boolean> {
    // First check base permissions
    const baseResult = await this.baseAccessControl.checkPermission({
      action,
      resource: { type: 'custom_resource', id: resourceId },
      context: { userId }
    });

    if (!baseResult.granted) {
      return false;
    }

    // Add custom business logic
    return this.checkCustomBusinessRules(userId, resourceId);
  }

  private async checkCustomBusinessRules(userId: string, resourceId: string): Promise<boolean> {
    // Implement custom logic
    return true;
  }
}
```

## Configuration

### Environment Variables

```bash
# IP Allowlists
ALLOWED_IPS=192.168.1.0/24,10.0.0.1
METRICS_ALLOWED_IPS=127.0.0.1,::1

# Webhook Configuration
WEBHOOK_PROVIDERS='[{"name":"github","algorithm":"hmac-sha256","secret":"secret123","enabled":true}]'
```

### Database Setup

The access control service uses the existing `User` entity. No additional database setup is required.

## Best Practices

### 1. Use Decorators for Route Protection

Prefer declarative decorators over programmatic checks in controllers:

```typescript
// Good
@RequireUserRead('userId')
@Get('users/:userId')
async getUser(@Param('userId') userId: string) { ... }

// Avoid
@Get('users/:userId')
async getUser(@Param('userId') userId: string) {
  const hasPermission = await this.accessControl.checkPermission(...);
  if (!hasPermission.granted) throw new ForbiddenException();
  // ...
}
```

### 2. Use Programmatic Checks in Services

For business logic, use the service directly:

```typescript
@Injectable()
export class BusinessService {
  async complexOperation(userId: string, data: any) {
    // Check multiple permissions
    const canRead = await this.accessControl.hasRole(userId, UserRole.USER);
    const canWrite = await this.accessControl.checkOwnership(userId, resource);
    
    if (canRead && canWrite) {
      // Proceed with operation
    }
  }
}
```

### 3. Combine Guards Appropriately

```typescript
// For authenticated endpoints with access control
@UseGuards(JwtAuthGuard, AccessControlGuard)

// For public endpoints with optional access control
@UseGuards(AccessControlGuard) // Will handle missing JWT gracefully

// For webhook endpoints
@UseGuards(AccessControlGuard) // Handles webhook verification
```

### 4. Handle Permission Results

```typescript
@Get('resource/:id')
@RequirePermission({ ... })
async getResource(
  @Param('id') id: string,
  @GetPermissionResult() permissionResult: PermissionResult
) {
  // Use permission metadata for additional logic
  if (permissionResult.metadata?.reason === 'admin_access') {
    // Return admin view
  } else {
    // Return user view
  }
}
```

## Error Handling

The access control system throws standard HTTP exceptions:

- `UnauthorizedException` (401): Authentication failed or missing
- `ForbiddenException` (403): Authenticated but insufficient permissions

These are handled by the global exception filter and return consistent error responses.

## Testing

### Unit Tests

```typescript
describe('AccessControlService', () => {
  let service: AccessControlService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [AccessControlService, /* mocks */],
    }).compile();

    service = module.get<AccessControlService>(AccessControlService);
  });

  it('should grant access to resource owner', async () => {
    const result = await service.checkPermission({
      action: AccessAction.READ,
      resource: { type: ResourceType.PORTFOLIO, id: '1', ownerId: 'user1' },
      context: { userId: 'user1', userRole: UserRole.USER }
    });

    expect(result.granted).toBe(true);
  });
});
```

### Integration Tests

```typescript
describe('AccessControlGuard', () => {
  it('should protect routes with permission requirements', async () => {
    return request(app.getHttpServer())
      .get('/users/123')
      .set('Authorization', 'Bearer invalid-token')
      .expect(401);
  });
});
```

## Migration from Existing Guards

To migrate from existing guards to the shared interface:

1. Replace individual guards with `AccessControlGuard`
2. Replace custom decorators with standardized ones
3. Update permission checking logic to use the service
4. Test thoroughly to ensure equivalent behavior

This shared interface provides a foundation for consistent, maintainable access control across all protocol modules.