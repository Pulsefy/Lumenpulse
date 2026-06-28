# Public Testnet Rate Limiting

Per-endpoint-group rate limits protect public testnet read endpoints from abuse while keeping generous thresholds for legitimate users.

## Profiles

| Profile            | Dev/Default | Staging  | Production | Group                   |
|--------------------|-------------|----------|------------|-------------------------|
| Global (default)   | 120/min     | 100/min  | 60/min     | Catch-all               |
| Auth               | 8/min       | 8/min    | 5/min      | Login,register,refresh  |
| Portfolio Read     | 90/min      | 60/min   | 30/min     | Portfolio GET           |
| Portfolio Write    | 10/min      | 10/min   | 5/min      | Portfolio POST/PUT/DEL  |
| Watchlist Read     | 100/min     | 60/min   | 30/min     | Watchlist GET           |
| Watchlist Write    | 15/min      | 10/min   | 5/min      | Watchlist POST/PUT/DEL  |
| **News Read**      | 60/min      | 40/min   | 20/min     | GET /news/*             |
| **Project Read**   | 100/min     | 60/min   | 40/min     | GET /grants/*           |
| **Crowdfund Read** | 60/min      | 40/min   | 20/min     | GET /crowdfund/*        |
| **Stellar Read**   | 60/min      | 40/min   | 20/min     | GET /stellar/*          |
| **Search Read**    | 30/min      | 20/min   | 10/min     | GET /search/*           |
| **Analytics Read** | 60/min      | 40/min   | 20/min     | GET /analytics/*        |

Block duration equals the TTL window (one full window) for all public read profiles.

## IP Access Control

- `IP_ALLOWLIST` — Comma-separated IPs/CIDRs. When set, **only** these IPs are allowed.
- `IP_DENYLIST` — Comma-separated IPs/CIDRs. Requests from these IPs are rejected immediately.

Both are optional. When empty, no IP filtering is applied.

## Environment Variables

```
# ── Public read rate limit profiles ──
RATE_LIMIT_NEWS_READ_LIMIT=60
RATE_LIMIT_NEWS_READ_TTL_MS=60000
RATE_LIMIT_NEWS_READ_BLOCK_MS=60000
RATE_LIMIT_PROJECT_READ_LIMIT=100
RATE_LIMIT_PROJECT_READ_TTL_MS=60000
RATE_LIMIT_PROJECT_READ_BLOCK_MS=60000
RATE_LIMIT_CROWDFUND_READ_LIMIT=60
RATE_LIMIT_CROWDFUND_READ_TTL_MS=60000
RATE_LIMIT_CROWDFUND_READ_BLOCK_MS=60000
RATE_LIMIT_STELLAR_READ_LIMIT=60
RATE_LIMIT_STELLAR_READ_TTL_MS=60000
RATE_LIMIT_STELLAR_READ_BLOCK_MS=60000
RATE_LIMIT_SEARCH_READ_LIMIT=30
RATE_LIMIT_SEARCH_READ_TTL_MS=60000
RATE_LIMIT_SEARCH_READ_BLOCK_MS=60000
RATE_LIMIT_ANALYTICS_READ_LIMIT=60
RATE_LIMIT_ANALYTICS_READ_TTL_MS=60000
RATE_LIMIT_ANALYTICS_READ_BLOCK_MS=60000

# ── IP access control (optional) ──
IP_ALLOWLIST=203.0.113.0/24,198.51.100.42
IP_DENYLIST=192.0.2.0/24
```

## How It Works

1. Each public controller is decorated with `@Throttle(get*ThrottleOverride())`.
2. `RateLimitGuard` checks the IP allowlist/denylist **before** the rate limit check.
3. If the IP is denied (denylist match) or not allowed (allowlist set but IP not found), a 403 is returned.
4. If the IP passes, the `@Throttle()` override creates a route-specific throttler that runs before the global default.
5. When the rate limit is exceeded, a 429 is returned with `SYS_008`, including the limit, TTL, and retry-after duration.

## Error Responses

### 429 Too Many Requests
```json
{
  "code": "SYS_008",
  "message": "Too many requests. Please try again later.",
  "details": {
    "limit": 60,
    "ttlSeconds": 60,
    "retryAfterSeconds": 45
  }
}
```

### 403 IP Denied
```json
{
  "code": "SYS_007",
  "message": "Access denied."
}
```
