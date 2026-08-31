# LumenPulse Backend

NestJS API for LumenPulse.

## Setup

```bash
npm install
```

## Run

```bash
npm run start
npm run start:dev
npm run start:prod
```

## Test

```bash
npm run lint
npm run test
npm run test:e2e
```

## Demo bootstrap endpoint

The backend exposes an admin-only demo bootstrap endpoint that can populate a small set of sample crowdfund projects for reviewer/testnet validation.

To enable it locally or in a non-production test environment, set:

```bash
BOOTSTRAP_DEMO_DATA_ENABLED=true
```

Then call the endpoint with an admin JWT:

```bash
curl -X POST \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  http://localhost:3000/v1/crowdfund/admin/bootstrap-demo-data
```

The endpoint returns the created demo project IDs for verification.

> This endpoint is disabled by default and should not be enabled in production unless explicitly required.

## Testnet Friendbot bootstrap endpoint

The backend exposes an admin-only, testnet-only endpoint that funds fresh accounts via Stellar Friendbot:

```bash
FRIENDBOT_BOOTSTRAP_ENABLED=true
STELLAR_NETWORK=testnet
```

```bash
curl -X POST \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"publicKey":"G..."}' \
  http://localhost:3000/v1/dev/testnet-bootstrap/fund
```

Safeguards: feature flag, `STELLAR_NETWORK=testnet` gate, admin JWT, dedicated rate limit, and a hardcoded Friendbot URL.

## Bootstrap teardown and reset

Repeated bootstraps accumulate state. Every bootstrap — a demo seed *or* a Friendbot funding — is recorded as a **bootstrap run** with its own identifier and the list of resources it created, so an environment can be returned to a clean baseline one run at a time.

### 1. Find the run identifier

The `runId` is returned by the call that created the state:

```jsonc
// POST /v1/demo-bootstrap/seed
{ "success": true, "seededAt": "...", "runId": "3f6c1a6e-2f4b-4b2a-9c0a-5d8f0b1c2d3e", "details": { } }
```

If you no longer have it, list recorded runs (newest first):

```bash
curl -H "Authorization: Bearer <ADMIN_JWT>" \
  "http://localhost:3000/v1/demo-bootstrap/runs?kind=demo_seed&status=active"
```

Supported filters: `kind` (`demo_seed` | `testnet_account`), `status` (`active` | `torn_down`), `limit` (default 50, max 200).

### 2. Preview with a dry run

`dryRun` changes nothing and reports exactly what a real teardown would remove:

```bash
curl -X POST \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"dryRun":true}' \
  http://localhost:3000/v1/demo-bootstrap/runs/<RUN_ID>/teardown
```

```jsonc
{
  "success": true,
  "runId": "3f6c1a6e-...",
  "dryRun": true,
  "status": "active",
  "environment": { "network": "testnet", "nodeEnv": "development" },
  "resources": [
    { "type": "demo_contributor", "identifier": "GA5Z...KZVN", "label": "Demo contributor demo-alice", "action": "would_remove" },
    { "type": "demo_grant_round", "identifier": "0", "label": "Demo: Stellar Community Builders — Round 1", "action": "would_remove" }
  ],
  "summary": { "total": 2, "removed": 2, "notFound": 0, "skipped": 0 }
}
```

### 3. Tear the run down

Drop `dryRun` (or send `{"dryRun":false}`) to execute. Each resource comes back as `removed`, `not_found` (already gone) or `skipped`:

```bash
curl -X POST \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{}' \
  http://localhost:3000/v1/demo-bootstrap/runs/<RUN_ID>/teardown
```

The call is idempotent — tearing down an already torn-down run returns `status: "already_torn_down"` and removes nothing.

### Environment gate

Teardown is **refused with `403`** unless both hold:

1. `NODE_ENV` is not `production` — teardown is never permitted in production, whatever the network says; and
2. the environment is explicitly marked as testnet (`STELLAR_NETWORK=testnet`) **or** development (`NODE_ENV=development` or `test`).

The refusal response names which condition failed. The gate is re-evaluated on every request, so a misconfigured deploy cannot leave a stale "allowed" verdict behind.

### What teardown cannot undo

Friendbot-funded testnet accounts stay on-chain — Stellar has no way to delete an account the backend does not hold the secret key for. Those resources are reported as `skipped` with an explicit reason, and only the local bootstrap record is discarded. Demo seed data is in-memory, so it is genuinely removed.

`POST /v1/demo-bootstrap/reset` remains the blunt instrument: it clears **all** demo seed state regardless of which run produced it. Use the teardown endpoint when only one run should be undone. Runs whose data a `reset` already wiped tear down cleanly and report their resources as `not_found`.

Runs are recorded in the `bootstrap_runs` table (migration `1848000000000-CreateBootstrapRuns`), so run history survives a restart and a completed teardown stays auditable.

## Deployment smoke endpoint

A single public endpoint for CI and Vercel deployment checks:

```bash
curl -sf http://localhost:3000/v1/health/smoke
```

It confirms in one call that:

- every required environment variable is present (`DB_*`, `PORT`, `JWT_SECRET`, `STELLAR_SERVER_SECRET`, plus `CORS_ORIGIN` / `PYTHON_API_URL` where the environment requires them);
- core dependencies respond — database, Redis, and Stellar Horizon; and
- every configured Soroban contract ID is reachable.

The response is machine-readable, and each check carries a stable `id` so CI can assert on individual results:

```jsonc
{
  "status": "pass",          // "pass" | "warn" | "fail" — worst result across all checks
  "ready": true,             // false only when something failed
  "checkedAt": "2026-08-29T10:15:00.000Z",
  "durationMs": 412,
  "network": "testnet",
  "environment": "production",
  "summary": { "total": 14, "passed": 13, "warned": 1, "failed": 0 },
  "checks": [
    { "id": "env.JWT_SECRET", "category": "config", "status": "pass", "message": "JWT_SECRET is set" },
    { "id": "dependency.redis", "category": "dependency", "status": "warn", "message": "Redis cache is unreachable — the API runs uncached" },
    { "id": "contract.lumenToken", "category": "contract", "status": "pass", "message": "lumenToken contract is reachable" }
  ]
}
```

HTTP status mirrors readiness: **200** for `pass` and `warn`, **503** for `fail`. A plain `curl -sf` is therefore enough to gate a deploy; use `jq -e '.status == "pass"'` to also fail on warnings.

Redis is a warning rather than a failure because the API degrades to uncached rather than breaking. Missing required env vars, an unreachable database or Horizon, and any misconfigured or uncallable contract ID all fail the check.

**Safe to expose publicly.** Environment variables are reported by name and presence only — never a value, prefix or length. Contract IDs are redacted to `ABC123...XYZ789`. Dependency failures return fixed messages (`"Database is unreachable"`), never the driver's error text, so a connection string or internal host can never leak; the underlying error is written to the server log instead.

## Security defaults

The backend includes:

- Global rate limiting with route-specific overrides for authentication and portfolio endpoints
- Strict DTO validation with `whitelist`, `forbidNonWhitelisted`, and transformation enabled
- Safe error formatting with a shared `{ code, message, details, requestId }` contract
- Request ID propagation through the `X-Request-Id` response header

## Graceful Shutdown & Deployment Configuration

The backend natively supports graceful shutdown on `SIGTERM` and `SIGINT` signals, which handles draining in-flight requests and cleanly stopping background processes.

**Drain Sequence:**
1. Readiness probe (`/health/ready`) immediately reports unready (`503 Service Unavailable`).
2. Schedulers and queue consumers stop accepting new work immediately.
3. The server waits for `SHUTDOWN_GRACE_PERIOD_MS` (default: 15s) to allow the load balancer/Kubernetes to remove the pod from the pool and let active requests finish. During this period, the liveness probe (`/health/live`) continues to report healthy.
4. HTTP server closes.
5. Database and Redis connections close cleanly.

**Required Kubernetes Probe Configuration:**
Deployments should configure separate readiness and liveness endpoints instead of using the combined `/health` endpoint:
- **Liveness:** `GET /health/live`
- **Readiness:** `GET /health/ready`

Key environment variables:

```bash
RATE_LIMIT_TRACK_BY_IP=true
RATE_LIMIT_TRACK_BY_API_KEY=false
RATE_LIMIT_API_KEY_HEADER=x-api-key
RATE_LIMIT_REDIS_URL=redis://localhost:6379
RATE_LIMIT_GLOBAL_LIMIT=120
RATE_LIMIT_GLOBAL_TTL_MS=60000
RATE_LIMIT_AUTH_LIMIT=8
RATE_LIMIT_AUTH_TTL_MS=60000
RATE_LIMIT_PORTFOLIO_READ_LIMIT=90
RATE_LIMIT_PORTFOLIO_READ_TTL_MS=60000
RATE_LIMIT_PORTFOLIO_WRITE_LIMIT=10
RATE_LIMIT_PORTFOLIO_WRITE_TTL_MS=60000
```

Example error response:

```json
{
  "code": "SYS_004",
  "message": "Validation failed",
  "details": [
    {
      "field": "email",
      "message": "email must be an email"
    }
  ],
  "requestId": "f2c3cb1c-8c86-4505-b4ce-fca50da2d46d"
}
```
