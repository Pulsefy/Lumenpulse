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

## Security defaults

The backend includes:

- Global rate limiting with route-specific overrides for authentication and portfolio endpoints
- Strict DTO validation with `whitelist`, `forbidNonWhitelisted`, and transformation enabled
- Safe error formatting with a shared `{ code, message, details, requestId }` contract
- Request ID propagation through the `X-Request-Id` response header

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

## Observability & Logging

The backend uses a structured JSON logging system with request-scoped correlation IDs to improve traceability across the API, background workers, and external integrations.

### Key Features

- **Correlation IDs**: Automatically generated for every incoming request and propagated through asynchronous operations using `AsyncLocalStorage`.
- **Structured Logs**: All logs are output as JSON objects, making them easy to index and search in log management tools (e.g., ELK, CloudWatch).
- **Trace Propagation**: Correlation IDs are automatically passed to:
  - **BullMQ Workers**: Portfolio snapshots and Stellar synchronization jobs.
  - **External APIs**: Outgoing requests to CoinDesk, Sentiment Analysis, and Exchange Rate providers.
- **Rich Context**: API logs include method, URL, status code, response time, and client metadata.

### Example Structured Log

```json
{
  "level": "log",
  "timestamp": "2026-04-25T13:15:00.000Z",
  "context": "LoggerMiddleware",
  "message": "GET /api/portfolio/summary 200 45ms",
  "correlationId": "f2c3cb1c-8c86-4505-b4ce-fca50da2d46d",
  "method": "GET",
  "url": "/api/portfolio/summary",
  "status": 200,
  "duration": "45ms",
  "ip": "127.0.0.1"
}
```

### Manual Usage

To log with correlation context in your services:

```typescript
import { Logger } from '@nestjs/common';

private readonly logger = new Logger(MyService.name);

this.logger.log({ message: 'Processing data', detail: 'Additional metadata' });
```
