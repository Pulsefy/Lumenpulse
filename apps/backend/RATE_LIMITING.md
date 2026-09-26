# Rate Limiting

Infrastructure lives in `src/common/rate-limit/`. A single global guard
(`RateLimitGuard`, registered as `APP_GUARD`) applies to every HTTP route.

## 1. Who is limited — principal scoping

Budgets are keyed by the **authenticated principal**, falling back to the
**source address** only for anonymous callers. `RateLimitPrincipalResolver` resolves the principal
once per request, in this order:

| Order | Source | Principal / tracker key |
|---|---|---|
| 1 | `req.user` already set upstream | `user:<id>` (or `bot:`/`service:` if `principalType` is set) |
| 2 | `X-Service-Token` / `X-Bot-Token` validated by bot-auth (`BotPrincipalService`) | `service:<id>` / `bot:<id>` |
| 3 | Signed, unexpired `Authorization: Bearer <JWT>` (verified with `JWT_SECRET`) | `user:<sub>`; JWTs with `type: bot \| service` → `bot:<sub>` / `service:<sub>` |
| 4 | Otherwise (anonymous) | `ip:<address>` (plus `api-key:` when `RATE_LIMIT_TRACK_BY_API_KEY=true`) |

The guard runs before route-level `JwtAuthGuard`, which is why it verifies the
JWT itself. Forged, expired or malformed tokens are ignored and fall back to
source-address limiting, so they can't be used to create new budgets.

## 2. Endpoint classes

Apply a class with `@RateLimitPolicy('<class>')`. This sets the `@Throttle`
profile and adds class metadata. Routes without a class use `global`.

| Class | Metric label | Applied to |
|---|---|---|
| `searchRead` | `search` | `SearchController` |
| `analyticsRead` | `analytics` | `AnalyticsController` |
| `exportJob` | `export` | `POST /exports`, `POST /exports/admin/analytics`, `GET /exports/:id/download` |
| `contractSimulation` | `contract_simulation` | `ContributorRegistryController`, `MatchingPoolAdminController`, `POST /health/contracts/snapshots` |
| `auth`, `portfolioRead`, `portfolioWrite`, `watchlistRead`, `watchlistWrite`, `newsRead`, `projectRead`, `crowdfundRead`, `stellarRead`, `friendbotBootstrap` | snake_case of the class | existing controllers |
| `global` (default) | `default` | everything else |

**Expensive classes** (`searchRead`, `analyticsRead`, `exportJob`, `contractSimulation`):

- have stricter limits than `global` in every environment, and
- use **one bucket for all routes in the class**, so spreading calls across
  several endpoints doesn't increase a client's budget.

Production defaults (per 60s window): global 120, search 30, analytics 30,
export 5 (block 300s), contract simulation 10 (block 120s).
Override them with `RATE_LIMIT_<CLASS>_{LIMIT,TTL_MS,BLOCK_MS}`, e.g.
`RATE_LIMIT_EXPORT_JOB_LIMIT`, `RATE_LIMIT_CONTRACT_SIMULATION_LIMIT`.

## 3. Bot and service principals (bot-auth)

Credentials: `BOT_AUTH_BOT_TOKENS` / `BOT_AUTH_SERVICE_TOKENS`, each a
comma-separated list of `principalId:token` pairs. Callers send the token in
`X-Bot-Token` / `X-Service-Token`. Tokens are compared in constant time.

Limits are set separately per principal type and class:

```
RATE_LIMIT_<BOT|SERVICE>_<CLASS>_{LIMIT,TTL_MS,BLOCK_MS}
CLASS = GLOBAL | SEARCH_READ | ANALYTICS_READ | EXPORT_JOB | CONTRACT_SIMULATION
```

For every other class (e.g. `auth`), machine principals get the standard profile.
Routes with their own `@Throttle` override also keep that override. The bot/service
global budget never loosens a strict route.

## 4. Response headers

Every limited response includes:

- `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (seconds),
  `RateLimit-Policy` (`<limit>;w=<window-seconds>`) — IETF standard headers
- `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` — legacy headers
- On **429**: `Retry-After: <seconds>` (the remaining block time). The body's
  `details.retryAfterSeconds` and `details.endpointClass` carry the same data.

CORS exposes these headers to browsers. Blocks now last their full
`BLOCK_MS`, even when that's longer than the counting window, so
`Retry-After` is always accurate.

## 5. Metrics

```
rate_limit_rejections_total{endpoint_class="<label>", principal_type="user|bot|service|anonymous"}
```

Both labels have a small, fixed set of values. Example alert query:
`sum by (endpoint_class) (rate(rate_limit_rejections_total[5m]))`.
