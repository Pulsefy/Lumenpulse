# Breaking Changes: API Response Envelope

## Summary
All 2xx responses from the LumenPulse backend API are now wrapped in a standard envelope:

```json
{
  "data": "<original payload>",
  "meta": {
    "requestId": "uuid",
    "timestamp": "ISO-8601"
  }
}
```

## Effective Version
This change is in effect from the release that includes this document.

## Affected Clients
- `apps/webapp` — all `fetch()` calls in `apps/webapp/lib/*.ts` that expect domain-specific response shapes directly
- `apps/mobile` — `ApiClient.get/post/...` already wraps in `{success, data?, error?}`; the `data` field will now be `{data: <payload>, meta: {...}}` instead of `<payload>` directly

## Endpoint Exceptions (not enveloped)
| Path | Reason |
|------|--------|
| `GET /health` and sub-paths | Health check tooling expects plain Terminus format |
| `GET /metrics` | Prometheus scraper expects plain text |
| `POST /telegram-bot/broadcast` | Telegram admin endpoint exempt by policy |
| `GET /api/docs` and `GET /api/docs-json` | Swagger UI |
| Any `204 No Content` response | No body |

## Removed Ad-hoc Shapes
| Endpoint | Old shape | New `data` value |
|----------|-----------|------------------|
| `POST /portfolio/snapshot` | `{ success: true, snapshot: { id, createdAt, totalValueUsd } }` | `{ id, createdAt, totalValueUsd }` |

## Migration Guide

### webapp (`apps/webapp/lib`)
Every call site that does:
```typescript
const res = await fetch('/api/portfolio/summary');
const summary = await res.json(); // was: PortfolioSummaryDto directly
```
Must become:
```typescript
const res = await fetch('/api/portfolio/summary');
const envelope = await res.json(); // { data: PortfolioSummaryDto, meta: {...} }
const summary = envelope.data;
```

### mobile (`apps/mobile/lib`)
ApiClient already wraps in `{success, data?}`. The `data` field now contains the envelope:
```typescript
// Before
const result = await apiClient.get<PortfolioSummaryDto>('/portfolio/summary');
if (result.success) result.data.totalValueUsd; // was: PortfolioSummaryDto

// After
const result = await apiClient.get<ApiResponseDto<PortfolioSummaryDto>>('/portfolio/summary');
if (result.success) result.data.data.totalValueUsd;
```

Alternatively, unwrap at the ApiClient layer — see the recommendation section below.

### Recommendation: Unwrap in ApiClient (mobile)
Update `apps/mobile/lib/api-client.ts` `attempt<T>` to automatically unwrap the envelope:
```typescript
// In the successful JSON branch:
const raw = await response.json();
const data = (raw && typeof raw === 'object' && 'data' in raw && 'meta' in raw)
  ? raw.data
  : raw;
return { success: true, data: data as T };
```
This preserves backward compatibility across all call sites with no other changes.

## Sequencing
1. **Backend** deploys with envelope interceptor (this PR)
2. **Mobile** updates ApiClient to unwrap the envelope at the transport layer (zero call-site changes)
3. **Webapp** updates each call site in `apps/webapp/lib/*.ts` to read `.data` from responses
4. Validate with E2E smoke tests
