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
