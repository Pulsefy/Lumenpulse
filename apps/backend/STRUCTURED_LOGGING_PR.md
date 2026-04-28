# Pull Request: Request Correlation IDs and Structured Operational Logging

## Summary

Implemented request-scoped correlation IDs and structured JSON logging to improve debugging across API requests, workers, and integrations for the LumenPulse backend.

## Changes Made

### New Files Added

| File | Description |
|------|-------------|
| `apps/backend/src/common/services/structured-logger.service.ts` | Core structured logging service with JSON output format |
| `apps/backend/src/common/services/structured-logger.module.ts` | Global NestJS module for the logger |
| `apps/backend/src/common/services/logger.factory.ts` | Factory for creating context-specific loggers |
| `apps/backend/src/common/middleware/structured-logger.middleware.ts` | HTTP request/response logging middleware |
| `apps/backend/src/common/interceptors/structured-logging.interceptor.ts` | Request lifecycle interceptor |
| `apps/backend/src/common/decorators/request-context.decorator.ts` | Decorators for easy request context access |
| `apps/backend/src/common/services/structured-logger.service.spec.ts` | Unit tests for the logger service |
| `apps/backend/src/common/middleware/structured-logger.middleware.spec.ts` | Unit tests for the middleware |
| `apps/backend/src/test/structured-logging.integration.spec.ts` | Integration tests |

### Modified Files

| File | Changes |
|------|---------|
| `apps/backend/src/app.module.ts` | Integrated StructuredLoggerModule and middleware/interceptor |

## Features Implemented

### 1. Request Correlation IDs
- Automatic UUID generation for each request
- Support for custom request IDs via `X-Request-Id` header
- Request ID propagated through all logs and response headers
- TypeScript type extensions for Express Request interface

### 2. Structured JSON Logging
- All logs output in JSON format for easy parsing
- Includes: timestamp, level, message, context, requestId, method, url, statusCode, duration, ip, userAgent
- Log levels: info, warn, error, debug

### 3. HTTP Request/Response Logging
- Middleware captures all HTTP requests and responses
- Logs incoming requests with method, URL, IP, user agent
- Logs outgoing responses with status code and duration
- Excluded paths: `/health`, `/metrics`

### 4. Request Lifecycle Interceptor
- Logs request start with full context
- Logs request completion with duration
- Logs errors with stack traces

### 5. Developer Experience
- `@RequestId()` decorator to access request ID in controllers
- `@RequestWithId()` decorator for full request object
- `@RequestContext()` decorator for common context data
- `StructuredLogger` class for service-level logging

## Usage Examples

### Using the Decorators in Controllers

```typescript
@Get(':id')
async getUser(
  @RequestId() requestId: string,
  @Param('id') id: string,
) {
  return this.usersService.findUser(id, requestId);
}
```

### Using Structured Logger in Services

```typescript
private readonly logger = new StructuredLogger('UserService');

async createUser(dto: CreateUserDto) {
  this.logger.logInfo('Creating user', { email: dto.email });
  
  try {
    const user = await this.userRepository.create(dto);
    this.logger.logInfo('User created', { userId: user.id });
    return user;
  } catch (error) {
    this.logger.logError('Failed to create user', { email: dto.email }, { error: error.message });
    throw error;
  }
}
```

## Sample Log Output

```json
{
  "timestamp": "2026-04-28T12:00:00.000Z",
  "level": "info",
  "message": "HTTP GET /api/users - 200 - 45ms",
  "context": "HTTP",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "method": "GET",
  "url": "/api/users",
  "statusCode": 200,
  "duration": 45,
  "ip": "::1",
  "userAgent": "curl/7.68.0"
}
```

## Testing

### Unit Tests
```bash
pnpm test -- --testPathPattern="structured-logger"
```

### Integration Tests
```bash
pnpm test -- --testPathPattern="structured-logging.integration"
```

### Manual Testing
```bash
# Test request ID generation
curl -v http://localhost:3000/health

# Test custom request ID
curl -v -H "X-Request-Id: custom-id-123" http://localhost:3000/health
```

## Benefits

1. **Improved Debugging**: Correlate logs across services using request IDs
2. **Machine-Parseable**: JSON format enables easy log aggregation and analysis
3. **Performance Monitoring**: Track request duration automatically
4. **Error Tracking**: Comprehensive error logging with context
5. **Backward Compatible**: Existing Logger usage continues to work

## Related Issues

- Closes: Request Correlation IDs and Structured Operational Logging (Complexity: Medium, 150 points)

## Checklist

- [x] Request ID middleware implemented
- [x] Structured logging service implemented
- [x] HTTP logging middleware implemented
- [x] Request lifecycle interceptor implemented
- [x] Decorators for easy access implemented
- [x] Unit tests written
- [x] Integration tests written
- [x] App module updated
- [x] TypeScript types extended
- [x] Documentation updated

## Notes

- The implementation is backward compatible with existing NestJS Logger
- Logs are output to console in JSON format (can be extended to use Winston/Pino)
- Excluded paths can be configured via module options
- All existing functionality preserved