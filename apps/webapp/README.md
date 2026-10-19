# LumenPulse Webapp

Next.js frontend for the LumenPulse decentralized crypto news and crowdfunding platform.

## Environment Variables

Copy `.env.local.example` to `.env.local` and fill in the required values.

### Required

| Variable | Scope | Description |
|---|---|---|
| `BACKEND_API_URL` | Server | Base URL for the NestJS backend API. Used in server-side API routes (e.g. `/api/news`, `/api/notifications`). Falls back to `http://localhost:3001`. |
| `NEXT_PUBLIC_API_URL` | Client | Base URL for the backend API, accessible from the browser. Used by all client-side service classes. Falls back to `http://localhost:3001`. |

### Optional

| Variable | Scope | Default | Description |
|---|---|---|---|
| `NEXT_PUBLIC_STELLAR_EXPLORER_URL` | Client | `https://stellar.expert/explorer` | Base URL for the Stellar explorer. Used to build links to transactions, accounts, and contracts. |

### Configuration Module

All environment variables are centralized in [`lib/config.ts`](lib/config.ts). The module exports:

- **`clientConfig`** — Safe to import in client components. Contains `apiUrl` and `stellarExplorerUrl`.
- **`serverConfig`** — Server-only. Contains `backendApiUrl`. Should not be imported in client bundles.

Validation happens at module load time with clear error messages for missing variables.

## API Type Generation

The webapp consumes shared TypeScript types generated from the backend OpenAPI contract. The generated output lives in `generated/` and is meant to be treated as a build artifact, not a hand-edited source file.

The input spec is the committed artifact at **`apps/backend/openapi.json`** (resolved by the script as `../backend/openapi.json`). The backend regenerates it on every `npm run build`, and backend CI fails if it is stale, so it always matches the backend code. See [`apps/backend/OPENAPI_CONTRACT.md`](../backend/OPENAPI_CONTRACT.md) for the error envelope, auth schemes and the `Idempotency-Key` header it describes.

```bash
# Regenerate the shared types from apps/backend/openapi.json
npm run generate:api-types

# Fail CI if the committed generated file is stale
npm run check:api-types
```

## Production deployment

### Current path: Vercel

The webapp is currently deployed on **Vercel**. There is no `vercel.json` in the
repository — Vercel detects Next.js and runs `npm run build` with the root
directory set to `apps/webapp`, then serves `next start` from the output.

Environment variables are set in the Vercel project settings, not in the
repository:

| Variable | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Vercel env | **Rebuild required.** Inlined into the client bundle at build time. |
| `NEXT_PUBLIC_STELLAR_EXPLORER_URL` | Vercel env | Rebuild required, if set. |
| `BACKEND_API_URL` | Vercel env | Read at request time by server components and API routes. |

The two variables are consumed by
[`lib/config.ts`](lib/config.ts) as `clientConfig` (browser-visible) and
`serverConfig` (server-only). Keeping that split intact is what allows
`BACKEND_API_URL` to point at an internal hostname while the browser gets a
public one.

### Container image

[`Dockerfile`](Dockerfile) builds a self-contained production image that does not
depend on any platform. It exists so the webapp is not tied to one vendor, and
so the local stack can run it.

```bash
docker build -f apps/webapp/Dockerfile -t lumenpulse-webapp apps/webapp
docker run --rm -p 3000:3000 -e BACKEND_API_URL=http://localhost:3001 lumenpulse-webapp
```

Or as part of the full stack — see [docs/LOCAL_STACK.md](../../docs/LOCAL_STACK.md):

```bash
docker compose up -d --build webapp
```

**The image does not replace the Vercel deployment.** Both are supported and both
should keep working; the image is the escape hatch, not a migration. They run the
same `next build` and the same `next start`, so a difference in behaviour between
them is a bug in one of them rather than an intended difference.

#### Build-time versus runtime variables

This is the one thing to get right when adapting the image to another platform.

| Variable | When it is read | Changing it requires |
|---|---|---|
| `NEXT_PUBLIC_*` | `next build` — inlined into the bundle | A rebuild |
| `BACKEND_API_URL` | Request time, on the server | A restart |

In the Dockerfile, `NEXT_PUBLIC_*` are build `ARG`s and `BACKEND_API_URL` is a
runtime environment variable. Passing `NEXT_PUBLIC_API_URL` to `docker run` does
nothing; it has to be passed to `docker build`.

## Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Run unit tests
npm test

# Run tests in watch mode
npm run test:watch

# Run end-to-end tests
npm run test:e2e

# Build for production
npm run build
```

## End-to-End Testing

Playwright is configured for browser-level smoke tests. See `playwright.config.ts` for details.

```bash
# Run all e2e tests
npm run test:e2e

# Run with UI mode
npx playwright test --ui

# Show test report
npx playwright show-report
```

Tests intercept backend and Stellar RPC calls with fixtures so no live services are required.
