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
