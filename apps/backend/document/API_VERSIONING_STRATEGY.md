# API Versioning and Deprecation Strategy

## Overview

LumenPulse uses **URI-based versioning** (`/v1/`, `/v2/`, etc.) powered by
NestJS's built-in versioning support. This document defines how contributors
introduce new versions and deprecate old ones without breaking existing clients.

---

## Versioning Approach

URI versioning is enabled in `main.ts`:

```typescript
app.enableVersioning({ type: VersioningType.URI });
```

All routes are prefixed automatically:

| Version | Example URL |
|---------|-------------|
| v1 | `/v1/portfolio` |
| v2 | `/v2/portfolio` |

### Defining a versioned controller

```typescript
@Controller({ path: 'portfolio', version: '2' })
export class PortfolioV2Controller { ... }
```

### Defining a versioned route

```typescript
@Version('2')
@Get()
findAll() { ... }
```

---

## Response Envelope

Every endpoint returns a consistent envelope. The envelope is applied
centrally by an interceptor (`src/common/interceptors/response-envelope.interceptor.ts`)
so individual controllers do not construct the outer shape themselves.

### Success envelope

```json
{
  "success": true,
  "data": { "id": "...", "name": "..." },
  "error": null,
  "meta": {
    "requestId": "01HZX...",
    "timestamp": "2024-01-01T00:00:00.000Z",
    "version": "v1"
  }
}
```

### Error envelope

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "NOT_FOUND",
    "message": "Portfolio not found",
    "details": []
  },
  "meta": {
    "requestId": "01HZX...",
    "timestamp": "2024-01-01T00:00:00.000Z",
    "version": "v1"
  }
}
```

### Paginated list envelope

```json
{
  "success": true,
  "data": [{ "id": "..." }],
  "error": null,
  "meta": {
    "requestId": "01HZX...",
    "timestamp": "2024-01-01T00:00:00.000Z",
    "version": "v1",
    "pagination": {
      "page": 1,
      "perPage": 20,
      "total": 134,
      "totalPages": 7,
      "hasNext": true,
      "hasPrev": false
    }
  }
}
```

### Type definitions

```typescript
export interface ApiMeta {
  requestId: string;
  timestamp: string;
  version: string;
  pagination?: PaginationMeta;
}

export interface PaginationMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown[];
}

export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: ApiError | null;
  meta: ApiMeta;
}
```

---

## Implementation

The envelope is applied by a global interceptor registered in `main.ts`:

```typescript
app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
app.useGlobalFilters(new ApiExceptionFilter());
```

Controllers return the raw domain object or a paginated result and the
interceptor wraps it. Errors thrown as `HttpException` are normalized by the
exception filter into the error envelope.

### Marking a paginated response

```typescript
@Get()
findAll(@Query() query: ListQueryDto) {
  return this.service.findAll(query); // { data, pagination }
}
```

The interceptor detects the `data + pagination` shape and moves `pagination`
into `meta.pagination`.

---

## Exceptions

A small number of endpoints intentionally bypass the envelope. These are
documented here and annotated with `@RawResponse()` in code:

| Endpoint | Reason |
|----------|--------|
| `GET /healthz` | Kubernetes liveness probe expects a flat status body. |
| `GET /metrics` | Prometheus scrape format is not JSON. |
| `GET /v1/auth/oauth/callback` | Redirects to the client and must not be wrapped. |

---

## OpenAPI Reflection

The OpenAPI document is generated from the controller decorators and the
shared envelope DSOs. Every operation response is wrapped in `ApiEnvelope`:

```typescript
@ApiResponse({ status: 200, typed envelope of PortfolioDto })
```

The generated document exposes the `success`, `data`, `error` and `meta`
fields for every endpoint, including the pagination metadata for list routes.

---

## Breaking Changes

The following changes are breaking for clients and must be sequenced accordgly:

1. All success responses are now wrapped in `{ success, data, error, meta }`.
   Clients that read the root object directly must switch to `response.data`.
2. List endpoints return an array in `data` and pagination in `meta.pagination`
   instead of top-level `items`/`total` fields.
3. Error responses no longer return `StatusCode` or `message` at the root; they
   are nested under `error.code` and `error.message`.
4. The `/healthz`, `/metrics` and `/v1/auth/oauth/callback` endpoints are
   explicitly exempt and retain their existing shapes.

Client work in `apps/webapp/lib` and `apps/mobile/lib` should be updated to
use the shared envelope types before the old shapes are removed.

---

## Deprecation Strategy

### Three-phase lifecycle

1. **Announce** - add a deprecation notice to the documentation and the
   `@ Deprecated` decorator on the controller or route.
2. **Support** - keep the old version available for at least one release cycle
   while clients migrate.
3. **Remove** - delete the deprecated route after the support window and
   document the removal in the changelog.
