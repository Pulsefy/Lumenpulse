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

## Deprecation Strategy

### Three-phase lifecycle

---

## Response Envelope Migration

The standard envelope (see `OPENAPI_CONTRACT.md`, "Response envelope") is
**opt-in** with the `X-Response-Envelope: v1` request header, so introducing it
breaks no existing client.

### Changes a client sees after opting in

These are breaking for any call site that switches on the header, and are the
list to sequence client work against:

1. **Success bodies move under `data`.** `GET /v1/watchlist` returns
   `{ success: true, data: <old body>, meta }` instead of the old body.
2. **Paginated lists are flattened.** Handlers returning
   `{ items, total, page, limit }` now return `data: items`, and the counts move
   into `meta`, which also adds `totalPages`, `hasNext` and `hasPrevious`.
3. **Errors move under `error`.** `{ code, message, details, requestId, correlationId }`
   becomes `{ success: false, error: { ...same fields } }`. Code that reads
   `body.message` (for example `apps/webapp/lib/auth-service.ts`) must read
   `body.error.message`.
4. **Empty success bodies become `data: null`.**
5. **Existing `{ success: true, ... }` bodies are wrapped as is.** Endpoints
   that already return their own `success` flag (for example in `auth`,
   `grants`, `portfolio`) appear as `data.success`. Normalizing those
   handlers is follow-up work.

### Not affected

Health probes, `/metrics`, file exports, CSV/PDF downloads, event streams and
WebSocket messages are never wrapped.

### Suggested sequence

1. **Now:** the envelope ships opt-in. Default responses are unchanged.
2. **Clients migrate:** webapp and mobile add the header behind a shared
   fetch helper and update their call sites endpoint by endpoint.
3. **Default flip:** once both clients send the header, a later major version
   (or `/v2`) makes the envelope the default, using the deprecation
   lifecycle above with a `Sunset` date for un-enveloped responses.

