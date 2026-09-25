# API Response Envelope Standardization

## Overview

This document describes the standardized API response envelope implemented across all backend endpoints to ensure consistent response shapes for clients.

## Response Structure

### Success Response

All successful responses are wrapped in the following envelope:

```typescript
{
  success: true,
  data: T
}
```

Where `T` is the endpoint-specific response data.

### Error Response

All error responses follow this structure:

```typescript
{
  success: false,
  error: {
    message: string,
    statusCode: number,
    code?: string,
    details?: Record<string, unknown>
  }
}
```

### Paginated List Response

List endpoints with pagination use this structure:

```typescript
{
  success: true,
  data: {
    items: T[],
    pagination: {
      total: number,
      page: number,
      limit: number,
      totalPages: number
    }
  }
}
```

## Implementation

### Global Interceptor

The `ResponseEnvelopeInterceptor` automatically wraps all successful responses in the envelope. It is registered globally in `app.module.ts`.

### Global Exception Filter

The `HttpExceptionFilter` standardizes all error responses to match the error envelope structure.

### Opting Out

Endpoints that need to return raw responses (e.g., webhooks, file downloads) can use the `@SkipResponseEnvelope()` decorator:

```typescript
@SkipResponseEnvelope()
@Post('webhook')
async handleWebhook() {
  return { raw: 'response' };
}
```

## Migration Guide

### For Backend Developers

1. **Update DTOs**: List endpoints should use `PaginatedResponseDto<T>` instead of custom pagination structures
2. **Service Layer**: Return data in the new structure (e.g., `{ items, pagination }` instead of `{ projects, total, page, limit, totalPages }`)
3. **Opt-out**: Add `@SkipResponseEnvelope()` to endpoints that require raw responses

### For Frontend Developers

#### Breaking Changes

**Before:**
```typescript
const response = await fetch('/api/projects');
const data = await response.json();
// data: { projects: [...], total: 100, page: 1, limit: 10, totalPages: 10 }
```

**After:**
```typescript
const response = await fetch('/api/projects');
const data = await response.json();
// data: { success: true, data: { items: [...], pagination: { total: 100, page: 1, limit: 10, totalPages: 10 } } }
```

#### Migration Steps

1. **Update response handling**: Unwrap the envelope
2. **Update list endpoints**: Access `data.items` instead of `data.projects` (or whatever the field was)
3. **Update pagination**: Access `data.pagination` instead of top-level fields
4. **Update error handling**: Errors now have `success: false` and `error` object

#### Example Migration

**Webapp (apps/webapp/lib):**

```typescript
// Before
const projects = await apiClient.get('/projects');
const projectList = projects.data;
const items = projectList.projects;
const total = projectList.total;

// After
const response = await apiClient.get('/projects');
if (response.success && response.data) {
  const items = response.data.items;
  const total = response.data.pagination.total;
}
```

**Mobile (apps/mobile/lib):**

The mobile client already has an `ApiResponse<T>` wrapper that matches this structure, so minimal changes are needed. Update the `api-client.ts` to handle the new envelope consistently.

## Endpoints with Special Handling

The following endpoints use `@SkipResponseEnvelope()`:

- `POST /webhooks/data-processing` - Webhook endpoint requiring raw response

## OpenAPI Documentation

The OpenAPI specification has been updated to reflect the new envelope structure. All endpoints now document the wrapped response format.

## Testing

To test the envelope implementation:

1. **Success response**: Call any endpoint and verify the response has `success: true` and `data` field
2. **Error response**: Trigger an error and verify the response has `success: false` and `error` field
3. **Pagination**: Call a list endpoint and verify the new pagination structure
4. **Opt-out**: Call a webhook endpoint and verify it returns raw response

## Rollback Plan

If issues arise, the envelope can be disabled by removing the interceptor and filter from `app.module.ts` providers.
