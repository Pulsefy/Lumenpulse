# Webapp Contribution Guide

This guide covers app-specific standards for `apps/webapp`. The webapp is the
Next.js App Router frontend. For migration context, see
[Stellar Migration Notes](STELLAR_MIGRATION_NOTES.md); for the full documentation
index, see [README.md](README.md).

There is no webapp equivalent in `CONTRIBUTING.md` today. This file closes that
gap.

## Setup

```bash
cd apps/webapp
npm install
```

The backend must be running for anything that talks to the API. Bring the whole
stack up with [Local Stack](../docs/LOCAL_STACK.md) if you need it.

## Daily Commands

```bash
# Start the dev server
npm run dev

# Lint
npm run lint

# Type gate (tsconfig has noEmit, so this emits nothing)
npx tsc --noEmit

# Unit tests — also verifies the generated API types are current
npm run test

# Tests in watch mode
npm run test:watch

# Production build
npm run build

# Regenerate API types from the backend OpenAPI document
npm run generate:api-types

# Verify the generated types match the backend spec without rewriting them
npm run check:api-types
```

`npm run test` runs `check:api-types` first, so a stale `generated/` directory
fails the suite before any test runs. Run `npm run generate:api-types` and commit
the result in the same PR.

> There is no `typecheck` script. `npm run build` typechecks as a side effect,
> but it is slow enough that using `npx tsc --noEmit` while iterating is
> noticeably faster. If you add a `typecheck` script, wire it into CI as well.

## Standards

### Server component, client component, context or hook?

Default to **not** writing `"use client"`. The tree is mostly server components
and each one you add ships JavaScript to the browser.

| Reach for | When | Example |
| --- | --- | --- |
| **Server component** (no directive) | The component renders static markup and needs no state, effect or browser API. This is the default. | `app/admin/page.tsx`, `app/grants/[id]/page.tsx` |
| **Client component** (`"use client"`) | It needs `useState`, `useEffect`, an event handler, or a browser API. | `app/admin/actions/AdminActionsClient.tsx`, `app/admin/audit/AuditLogsClient.tsx` |
| **Context** (`contexts/`) | The value is genuinely global and needed deep in the tree — wallet connection, environment config, theme. | `contexts/WalletContext.tsx`, `contexts/StellarConfigContext.tsx`, `contexts/theme-context.tsx` |
| **Hook** (`hooks/`) | Behaviour is reusable but the state is not global. | `hooks/useAuthGuard.ts`, `hooks/useExplorerUrl.ts`, `hooks/usePortfolioSnapshot.ts` |

The test for context vs hook: **would two unrelated parts of the tree need the
same value at the same time?** If yes, context. If only one feature needs it, a
hook or local state. Do not add a context for a value that one page reads.

Keep a client boundary as low in the tree as possible. A `"use client"` file
makes **everything it imports** part of the client bundle, so a client component
that imports a large server-only module drags that module along.

Pages follow a consistent split: a thin `page.tsx` that exports `metadata` and
renders a client sibling.

```tsx
// app/admin/actions/page.tsx
import { Metadata } from 'next';
import AdminActionsClient from './AdminActionsClient';

export const metadata: Metadata = {
  title: 'Contract Actions | Admin Console',
  description: 'Execute contract operations with confirmation safeguards.',
};

export default function AdminActionsPage() {
  return <AdminActionsClient />;
}
```

`metadata` cannot be exported from a client component, so this shape is not
optional if the page wants a title.

### The data-fetching rule

In order of preference:

1. **Server component fetch** — when the data is needed for the initial render
   and the user is not logged in. Use `next: { revalidate: N }` for cached data.
   See `app/grants/[id]/page.tsx`, which also fetches in `generateMetadata`.
2. **Route handler** (`app/api/*/route.ts`) — when the browser must call the
   backend and a proxy is needed to keep the backend URL off the client. The
   existing ones are `config/stellar`, `market`, `news`, `notifications` and
   `wallets`.
3. **Direct client call** — the default for anything behind a login, where the
   request carries the session cookie and the page is already a client component.
   Put the call in `lib/api-services.ts` or a feature `lib/` module rather than
   inlining `fetch` in a component, and take the base URL from
   `clientConfig.apiUrl` — never a hardcoded host.

```tsx
import { clientConfig } from '@/lib/config';

const API_BASE = clientConfig.apiUrl;
const response = await fetch(`${API_BASE}/admin/audit-logs?limit=50`);
```

Admin and other authenticated surfaces additionally sit behind `AuthGate` in
`app/admin/layout.tsx`, which gives the whole subtree its auth gate for free. Use
`useAuthGuard` inside a client component when you need a role decision.

### Generated API types

`generated/openapi-types.ts` is generated from `apps/backend/openapi.json` by
`scripts/generate-api-types.mjs`. **Never edit it by hand** — the next
regeneration silently discards the change.

It exports a single `components` interface. Derive response and enum types from
it rather than redeclaring an API shape:

```ts
import type { components } from '@/generated/openapi-types';

export type PortfolioSummaryResponse =
  components['schemas']['PortfolioSummaryWithCurrencyResponseDto'];

export type AnomalyStatus =
  components['schemas']['ReviewPortfolioAnomalyDto']['status'];
```

Regenerate whenever a backend DTO changes, and commit the diff in the same PR.
CI runs `check:api-types`, which fails if the file is out of date. The webapp's
test script runs the same check locally, so `npm run test` is enough to catch it
before pushing.

### Loading, empty and error states

Every view that can be empty, slow or broken gets all three. Reuse the shared
components rather than writing another inline spinner:

| State | Use |
| --- | --- |
| Route-level error | `components/route-error-boundary.tsx` — wrap a route that renders a child component which can throw. |
| Configuration missing or wrong | `components/config-error-banner.tsx` |
| A dependency is degraded | `components/DependencyStatusBanner.tsx` |
| Wallet not ready | `components/WalletReadinessBanner.tsx` |

An empty result is not an error. Show an empty state with a way forward; do not
show a spinner that never resolves, and do not show an error message for a
successful response that contained nothing.

### Conventions

- `strict` TypeScript. No `any` in new code — widen the generated type or narrow
  at the boundary instead.
- Import with the `@/` alias rather than a relative chain.
- Keep API shapes in `lib/`, not inside components.
- Add a test alongside behaviour changes and bug fixes, next to the source as
  `<name>.test.tsx`.
- Never commit a secret or a real wallet key. See
  [Personal Data Policy](personal-data-policy.md) for what must not reach the
  client.

## Done for Webapp Changes

```bash
npm run lint
npx tsc --noEmit
npm run test
npm run build
```

Then confirm by hand:

- [ ] The affected route loads, and its states (loading, empty, error) all render.
- [ ] You checked the change at mobile width as well as desktop.
- [ ] If the backend contract changed, `npm run generate:api-types` was run and
      the diff committed.
- [ ] If you added a `"use client"` boundary, you checked it was necessary and
      that it did not pull a server-only module into the client bundle.
