# Authorization Matrix

This document enumerates all controller routes with their required authorization roles and guards.

## Summary

- **Total Controllers**: 50
- **Total Routes**: 150+
- **Authorization Patterns**:
  - Public (no auth)
  - JWT Authenticated only
  - Role-based (USER, REVIEWER, ADMIN)
  - Contract Admin (ADMIN only)
  - IP Allowlist
  - Bot Authorization

## Roles

- **USER** - Default user role, can access authenticated user endpoints
- **REVIEWER** - Can review and approve content
- **ADMIN** - Full administrative access

## Guards

- **JwtAuthGuard** - JWT authentication required
- **RolesGuard** - Role-based access control (used with @Roles decorator)
- **ContractAdminGuard** - Contract admin operations with audit logging
- **IpAllowlistGuard** - IP-based access control
- **AccessControlGuard** - Unified access control for permissions and trusted callers

---

## Controller Authorization Matrix

### admin-audit.controller.ts

| Route | Method | Auth Required | Roles | Guards |
|-------|--------|---------------|-------|--------|
| `/admin/audit/blockchain` | GET | Yes | ADMIN | JwtAuthGuard, RolesGuard |

### analytics.controller.ts

| Route | Method | Auth Required | Roles | Guards |
|-------|--------|---------------|-------|--------|
| *All routes* | *Various* | No | None | None |

### app.controller.ts

| Route | Method | Auth Required | Roles | Guards |
|-------|--------|---------------|-------|--------|
| `/` | GET | No | None | None |

### audit.controller.ts

| Route | Method | Auth Required | Roles | Guards |
|-------|--------|---------------|-------|--------|
| `/admin/audit-logs` | GET | Yes | ADMIN | JwtAuthGuard, RolesGuard |

### auth.controller.ts

| Route | Method | Auth Required | Roles | Guards |
|-------|--------|---------------|-------|--------|
| `/auth/register` | POST | No | None | None |
| `/auth/login` | POST | No | None | None |
| `/auth/refresh` | POST | No | None | None |
| `/auth/logout` | POST | Yes | USER | JwtAuthGuard |

### cache.controller.ts

| Route | Method | Auth Required | Roles | Guards |
|-------|--------|---------------|-------|--------|
| `/cache/warm` | POST | Yes | ADMIN | JwtAuthGuard, RolesGuard |
| `/cache/warm/status` | GET | Yes | ADMIN | JwtAuthGuard, RolesGuard |

### config.controller.ts

| Route | Method | Auth Required | Roles | Guards |
|-------|--------|---------------|-------|--------|
| `/config/stellar` | GET | No | None | None |

### contracts.controller.ts

| Route | Method | Auth Required | Roles | Guards |
|-------|--------|---------------|-------|--------|
| `/contracts/capabilities` | GET | No | None | None |
| `/contracts/capabilities/:contractId` | GET | No | None | None |

### contributor-registry.controller.ts

| Route | Method | Auth Required | Roles | Guards |
|-------|--------|---------------|-------|--------|
| `/contributor-registry/register` | POST | Yes | ADMIN | JwtAuthGuard, ContractAdminGuard, RolesGuard |
| `/contributor-registry/register-with-sig` | POST | Yes | ADMIN | JwtAuthGuard, ContractAdminGuard, RolesGuard |
| `/contributor-registry/wallet/:address` | GET | No | None | None |
| `/contributor-registry/github/:handle` | GET | No | None | None |
| `/contributor-registry/reputation/:address` | GET | No | None | None |
| `/contributor-registry/nonce/:address` | GET | No | None | None |

### contributor-feed.controller.ts

| Route | Method | Auth Required | Roles | Guards |
|-------|--------|---------------|-------|--------|
| *All routes* | *Various* | No | None | None |

### crowdfund.controller.ts

| Route | Method | Auth Required | Roles | Guards |
|-------|--------|---------------|-------|--------|
| `/crowdfund/projects` | GET | No | None | None |
| `/crowdfund/projects/:id` | GET | No | None | None |
| `/crowdfund/projects` | POST | Yes | USER | JwtAuthGuard |
| `/crowdfund/contribute` | POST | No | None | None |
| `/crowdfund/admin/bootstrap-demo-data` | POST | Yes | ADMIN | JwtAuthGuard, RolesGuard |
| `/crowdfund/projects/:id/contributors` | GET | No | None | None |
| `/crowdfund/projects/:id/balance` | GET | No | None | None |
| `/crowdfund/projects/:id/my-contributions` | GET | Yes | USER | JwtAuthGuard |

### crowdfund-sync.controller.ts

| Route | Method | Auth Required | Roles | Guards |
|-------|--------|---------------|-------|--------|
| *All routes* | *Various* | No | None | None |

### demo-bootstrap.controller.ts

| Route | Method | Auth Required | Roles | Guards |
|-------|--------|---------------|-------|--------|
| `/demo-bootstrap/status` | GET | No | None | None |
| `/demo-bootstrap/seed` | POST | Yes | ADMIN | JwtAuthGuard, RolesGuard |
| `/demo-bootstrap/reset` | POST | Yes | ADMIN | JwtAuthGuard, RolesGuard |
| `/demo-bootstrap/runs` | GET | Yes | ADMIN | JwtAuthGuard, RolesGuard |
| `/demo-bootstrap/runs/:runId/teardown` | POST | Yes | ADMIN | JwtAuthGuard, RolesGuard |

### export.controller.ts

| Route | Method | Auth Required | Roles | Guards |
|-------|--------|---------------|-------|--------|
| `/exports` | POST | Yes | USER (ADMIN for analytics) | JwtAuthGuard |
| `/exports/admin/analytics` | POST | Yes | ADMIN | JwtAuthGuard, RolesGuard |
| `/exports` | GET | Yes | USER | JwtAuthGuard |
| `/exports/:id` | GET | Yes | USER | JwtAuthGuard |
| `/exports/:id/download` | GET | Yes | USER | JwtAuthGuard |

### feature-flags.controller.ts

| Route | Method | Auth Required | Roles | Guards |
|-------|--------|---------------|-------|--------|
| `/feature-flags` | GET | No | None | None |
| `/feature-flags/check/:key` | GET | No | None | None |
| `/feature-flags/:key/history` | GET | No | None | None |
| `/feature-flags/:key` | GET | No | None | None |
| `/feature-flags` | POST | Yes | ADMIN | JwtAuthGuard, RolesGuard |
| `/feature-flags/:key` | DELETE | Yes | ADMIN | JwtAuthGuard, RolesGuard |

### grants.controller.ts

| Route | Method | Auth Required | Roles | Guards |
|-------|--------|---------------|-------|--------|
| `/grants/rounds` | GET | No | None | None |
| `/grants/rounds/:id` | GET | No | None | None |
| `/grants/rounds/:id/summary` | GET | No | None | None |
| `/grants/rounds/:id/export` | GET | No | None | None |
| `/grants/rounds` | POST | Yes | ADMIN | JwtAuthGuard, RolesGuard |
| `/grants/rounds/:id/finalize` | POST | Yes | ADMIN | JwtAuthGuard, RolesGuard |
| `/grants/rounds/fund` | POST | Yes | ADMIN | JwtAuthGuard, RolesGuard |
| `/grants/rounds/projects/approve` | POST | Yes | ADMIN, REVIEWER | JwtAuthGuard, RolesGuard |
| `/grants/rounds/:roundId/projects/:projectId` | DELETE | Yes | ADMIN | JwtAuthGuard, RolesGuard |
| `/grants/contributions` | POST | No | None | None |
| `/grants/rounds/distribute` | POST | Yes | ADMIN | JwtAuthGuard, RolesGuard |
| `/grants/leaderboard` | GET | No | None | None |

### health.controller.ts

| Route | Method | Auth Required | Roles | Guards |
|-------|--------|---------------|-------|--------|
| `/health` | GET | No | None | None |
| `/health/live` | GET | No | None | None |
| `/health/ready` | GET | No | None | None |
| `/health/contracts` | GET | No | None | None |
| `/health/latency` | GET | No | None | None |
| `/health/smoke` | GET | No | None | None |

### metrics.controller.ts

| Route | Method | Auth Required | Roles | Guards |
|-------|--------|---------------|-------|--------|
| `/metrics` | GET | Yes | IP Allowlist | IpAllowlistGuard |
| `/metrics/json` | GET | Yes | IP Allowlist | IpAllowlistGuard |
| `/metrics/health` | GET | No | None | None |

### moderation.controller.ts

| Route | Method | Auth Required | Roles | Guards |
|-------|--------|---------------|-------|--------|
| `/moderation/report` | POST | Yes | USER | JwtAuthGuard |
| `/moderation/my-reports` | GET | Yes | USER | JwtAuthGuard |
| `/moderation/queue` | GET | Yes | ADMIN | JwtAuthGuard, RolesGuard |
| `/moderation/queue/stats` | GET | Yes | ADMIN | JwtAuthGuard, RolesGuard |
| `/moderation/queue/:id` | GET | Yes | ADMIN | JwtAuthGuard, RolesGuard |
| `/moderation/queue/:id` | PATCH | Yes | ADMIN | JwtAuthGuard, RolesGuard |
| `/moderation/queue/:id/assign` | PATCH | Yes | ADMIN | JwtAuthGuard, RolesGuard |

### news.controller.ts

| Route | Method | Auth Required | Roles | Guards |
|-------|--------|---------------|-------|--------|
| `/news` | GET | No | None | None |
| `/news/search` | GET | No | None | None |
| `/news/categories` | GET | No | None | None |
| `/news/sentiment-summary` | GET | No | None | None |
| `/news/article` | GET | No | None | None |
| `/news/coin/:symbol` | GET | No | None | None |

### notification-preference.controller.ts

| Route | Method | Auth Required | Roles | Guards |
|-------|--------|---------------|-------|--------|
| `/notification-preferences` | POST | Yes | USER | JwtAuthGuard |
| `/notification-preferences` | GET | Yes | USER | JwtAuthGuard |
| `/notification-preferences/:userId` | GET | Yes | USER | JwtAuthGuard |
| `/notification-preferences/:id` | PUT | Yes | USER | JwtAuthGuard |
| `/notification-preferences/:id` | DELETE | Yes | USER | JwtAuthGuard |
| `/notification-preferences/:userId/channels/:eventCategory` | GET | Yes | USER | JwtAuthGuard |

### portfolio.controller.ts

| Route | Method | Auth Required | Roles | Guards |
|-------|--------|---------------|-------|--------|
| *All routes* | *Various* | Yes | USER | JwtAuthGuard |

### price-alert.controller.ts

| Route | Method | Auth Required | Roles | Guards |
|-------|--------|---------------|-------|--------|
| `/price-alerts` | GET | Yes | USER | JwtAuthGuard |
| `/price-alerts/:id` | GET | Yes | USER | JwtAuthGuard |
| `/price-alerts` | POST | Yes | USER | JwtAuthGuard |
| `/price-alerts/:id` | PATCH | Yes | USER | JwtAuthGuard |
| `/price-alerts/:id` | DELETE | Yes | USER | JwtAuthGuard |

### projects.controller.ts

| Route | Method | Auth Required | Roles | Guards |
|-------|--------|---------------|-------|--------|
| `/projects` | GET | No | None | None |
| `/projects/:projectId` | GET | No | None | None |
| `/projects/:projectId/health` | GET | No | None | None |

### read-model-rebuild.controller.ts

| Route | Method | Auth Required | Roles | Guards |
|-------|--------|---------------|-------|--------|
| `/api/read-model/rebuild` | POST | Yes | ADMIN | JwtAuthGuard, RolesGuard |
| `/api/read-model/jobs/:jobId` | GET | Yes | ADMIN | JwtAuthGuard, RolesGuard |
| `/api/read-model/jobs` | GET | Yes | ADMIN | JwtAuthGuard, RolesGuard |
| `/api/read-model/jobs/:jobId/cancel` | DELETE | Yes | ADMIN | JwtAuthGuard, RolesGuard |
| `/api/read-model/jobs/cleanup` | DELETE | Yes | ADMIN | JwtAuthGuard, RolesGuard |
| `/api/read-model/datasets` | GET | Yes | ADMIN | JwtAuthGuard, RolesGuard |

### search.controller.ts

| Route | Method | Auth Required | Roles | Guards |
|-------|--------|---------------|-------|--------|
| `/search/projects` | GET | No | None | None |
| `/search/assets` | GET | No | None | None |
| `/search/ecosystem` | GET | No | None | None |
| `/search/entity-links` | GET | No | None | None |

### scheduler-health.controller.ts

| Route | Method | Auth Required | Roles | Guards |
|-------|--------|---------------|-------|--------|
| `/health/schedulers` | GET | No | None | None |

### stellar.controller.ts

| Route | Method | Auth Required | Roles | Guards |
|-------|--------|---------------|-------|--------|
| *All routes* | *Various* | No | None | None |

### matching-pool-admin.controller.ts

| Route | Method | Auth Required | Roles | Guards |
|-------|--------|---------------|-------|--------|
| `/admin/matching-pool/rounds` | POST | Yes | ADMIN | JwtAuthGuard, ContractAdminGuard, RolesGuard |
| `/admin/matching-pool/rounds/:roundId/approve-project` | POST | Yes | ADMIN | JwtAuthGuard, ContractAdminGuard, RolesGuard |

### telegram-bot.controller.ts

| Route | Method | Auth Required | Roles | Guards |
|-------|--------|---------------|-------|--------|
| `/telegram-bot/broadcast` | POST | Yes | ADMIN | JwtAuthGuard, RolesGuard |

### testnet-bootstrap.controller.ts

| Route | Method | Auth Required | Roles | Guards |
|-------|--------|---------------|-------|--------|
| *All routes* | *Various* | No | None | None |

### treasury.controller.ts

| Route | Method | Auth Required | Roles | Guards |
|-------|--------|---------------|-------|--------|
| `/treasury/streams` | POST | Yes | ADMIN | JwtAuthGuard, ContractAdminGuard, RolesGuard |
| `/treasury/streams/:beneficiary` | GET | No | None | None |
| `/treasury/streams/:beneficiary/history` | GET | Yes | ADMIN | JwtAuthGuard, ContractAdminGuard, RolesGuard |
| `/treasury/beneficiary-history` | GET | Yes | ADMIN | JwtAuthGuard, ContractAdminGuard, RolesGuard |
| `/treasury/streams/rotate` | POST | Yes | ADMIN | JwtAuthGuard, ContractAdminGuard, RolesGuard |
| `/treasury/streams/preview` | GET | No | None | None |

### users.controller.ts

| Route | Method | Auth Required | Roles | Guards |
|-------|--------|---------------|-------|--------|
| `/users` | GET | Yes | ADMIN | JwtAuthGuard, RolesGuard |
| `/users/:id` | GET | Yes | ADMIN | JwtAuthGuard, RolesGuard |
| `/users/me` | GET | Yes | USER | JwtAuthGuard |
| `/users/me` | PATCH | Yes | USER | JwtAuthGuard |
| `/users/me/accounts` | POST | Yes | USER | JwtAuthGuard |
| `/users/me/accounts` | GET | Yes | USER | JwtAuthGuard |
| `/users/me/accounts/:id` | GET | Yes | USER | JwtAuthGuard |
| `/users/me/accounts/:id` | DELETE | Yes | USER | JwtAuthGuard |
| `/users/me/accounts/:id/label` | PATCH | Yes | USER | JwtAuthGuard |
| `/users/me/avatar` | PATCH | Yes | USER | JwtAuthGuard |
| `/users/me/accounts/:id/primary` | POST | Yes | USER | JwtAuthGuard |

---

## Bot Authorization Matrix

### Bot Commands (Telegram Bot)

| Command | Action Type | Requires Admin | Requires Trusted Chat |
|---------|-------------|----------------|----------------------|
| `/start` | MUTATION | No | Yes |
| `/status` | READ | No | No |
| `/price` | READ | No | No |
| `/sentiment` | READ | No | No |
| `/trend` | READ | No | No |
| `/subscribe` | MUTATION | No | Yes |
| `/unsubscribe` | MUTATION | No | Yes |
| `/silence` | MUTATION | No | Yes |
| `/unsilence` | MUTATION | No | Yes |
| `/subscriptions` | READ | No | No |
| `/help` | READ | No | No |
| `/broadcast` | PRIVILEGED | Yes | Yes |

---

## Identified Security Concerns

### Medium Priority

1. **testnet-bootstrap.controller.ts** - Bootstrap operations may need authorization in production
   - Currently no guards, but may be environment-gated
   - **Risk**: If environment gating fails, unauthorized bootstrap could occur

### Previously Fixed (Resolved)

1. ~~**feature-flags.controller.ts** - Mutation endpoints (POST, DELETE) have no authorization guards~~
   - **FIXED**: Added `JwtAuthGuard` and `RolesGuard` with `@Roles(UserRole.ADMIN)` to POST and DELETE endpoints
   - Now requires admin authentication to create/update/delete feature flags

2. ~~**telegram-bot.controller.ts** - Broadcast endpoint has no authorization~~
   - **FIXED**: Added `JwtAuthGuard` and `RolesGuard` with `@Roles(UserRole.ADMIN)` to broadcast endpoint
   - Now requires admin authentication to broadcast alerts to Telegram subscribers

---

## Authorization Patterns

### Pattern 1: Public Endpoints
- No guards
- Used for health checks, public data, configuration
- Examples: `/health`, `/config/stellar`, `/contracts/capabilities`

### Pattern 2: Authenticated User Endpoints
- `JwtAuthGuard` only
- Used for user-specific data and actions
- Examples: `/users/me`, `/price-alerts`, `/notification-preferences`

### Pattern 3: Role-Based Endpoints
- `JwtAuthGuard` + `RolesGuard` with `@Roles` decorator
- Used for admin/reviewer operations
- Examples: `/admin/audit-logs`, `/moderation/queue`, `/grants/rounds` (POST)

### Pattern 4: Contract Admin Endpoints
- `JwtAuthGuard` + `ContractAdminGuard` + `RolesGuard` with `@Roles(UserRole.ADMIN)`
- Used for blockchain contract operations with audit logging
- Examples: `/treasury/streams`, `/contributor-registry/register`, `/admin/matching-pool/rounds`

### Pattern 5: IP Allowlist
- `IpAllowlistGuard`
- Used for metrics endpoints
- Examples: `/metrics`, `/metrics/json`

---

## Testing Recommendations

1. **Automated Matrix Test**: Generate a test that validates each route against this matrix
2. **Missing Guard Detection**: Automatically detect routes without explicit authorization decisions
3. **Role Validation**: Test each role (USER, REVIEWER, ADMIN) against all routes
4. **Guard Combination Validation**: Ensure proper guard combinations (e.g., ContractAdminGuard always with RolesGuard)

---

## Maintenance

This matrix should be updated whenever:
- A new controller is added
- A new route is added to an existing controller
- Authorization requirements change for existing routes
- New roles or guards are introduced

**Last Updated**: 2026-09-23
**Generated By**: Authorization Matrix Generator
