# Query Profiling Mode

> **Off by default.** No code changes are needed to run the app normally.
> Enable only during local development or performance investigations.

---

## Overview

The profiling middleware counts and logs the number of tracked external calls
(DB queries, RPC round-trips, price fetches) made during each HTTP request.
It is implemented in `src/common/profiling/` and uses Node.js
`AsyncLocalStorage` to carry per-request state through the entire middleware →
controller → service pipeline without any explicit prop-drilling.

When disabled (the default), the entire profiling path compiles away to
no-ops with zero runtime overhead.

---

## Enabling Profiling

Set the environment variable before starting the dev server:

```bash
QUERY_PROFILING=true npm run start:dev
# or
QUERY_PROFILING=true nest start --watch
```

That's all. No code changes required.

---

## What Gets Logged

With `QUERY_PROFILING=true` you will see log lines like:

```
[QueryProfilerService] [QUERY COUNT] GET /portfolio/summary → 1 call(s)
[QueryProfilerService] [SLOW QUERY] PortfolioService.getPortfolioHistory took 312.40ms (threshold: 150ms)
[QueryProfilerService] [CALL TRACKED] PriceService.getPricesForAssets – total so far: 1
```

Each line includes:

| Field | Meaning |
|-------|---------|
| `[QUERY COUNT]` | End-of-request summary: `METHOD /path → N call(s)` |
| `[SLOW QUERY]` | A single tracked call exceeded its threshold |
| `[CALL TRACKED]` | Verbose trace of each individual tracked call |

---

## Architecture

```
AppModule.configure()
  └── QueryCountMiddleware          (wraps each request in ALS context)
        └── QueryProfilerService.runInContext()
              ├── profile()         (timing + increments call counter)
              └── trackCall()       (lightweight counter-only path)
```

### Key files

| File | Role |
|------|------|
| `src/common/profiling/query-profiler.service.ts` | Core service — `profile()`, `trackCall()`, `runInContext()` |
| `src/common/profiling/query-count.middleware.ts` | NestJS middleware that wraps each request in an ALS context |
| `src/common/profiling/query-profiler.interceptor.ts` | Controller-level interceptor for the `@ProfileQuery` decorator |
| `src/common/profiling/profile-query.decorator.ts` | `@ProfileQuery(label, thresholdMs)` method decorator |
| `src/common/profiling/profiling.module.ts` | NestJS module exporting all the above |

---

## Using `@ProfileQuery` on a Controller Method

```typescript
import { ProfileQuery } from '../common/profiling/profile-query.decorator';

@Get('history')
@ProfileQuery('PortfolioController.getHistory', 200)
async getHistory(@Param('userId') userId: string) { ... }
```

This logs the total response time for that endpoint and warns when it
exceeds 200 ms.

---

## Using `profiler.profile()` in a Service

```typescript
const [snapshots, total] = await this.profiler.profile(
  () => this.snapshotRepository.findAndCount({ ... }),
  { label: 'PortfolioService.getPortfolioHistory', thresholdMs: 150 },
);
```

Each `profile()` call also increments the per-request counter when
`QUERY_PROFILING=true`.

---

## Five Fixed N+1 Endpoints

The following endpoints were identified as having N+1 patterns and fixed.
Before/after call-count ratios are shown for a typical 10-item page.

| # | Endpoint | Before (10 items) | After | Fix |
|---|----------|-------------------|-------|-----|
| 1 | `POST /portfolio/snapshots` (primary path) | 10 price calls | **1** | `getAssetValuesUsd()` batch |
| 2 | `POST /portfolio/snapshots` (fallback path) | 10 price calls | **1** | `getAssetValuesUsd()` batch |
| 3 | `GET /portfolio/account/:key` | 10 price calls | **1** | `getAssetValuesUsd()` batch |
| 4 | `GET /portfolio/allocation` | 10 price calls | **1** | `getAssetValuesUsd()` batch |
| 5 | `GET /projects` (list) | N RPC calls (one per row) | **N concurrent** then O(1) when batched RPC available | Preload states before mapping |

> **Note on projects:** the current implementation fires all N RPC calls
> concurrently (not sequentially), which is already a significant
> improvement.  A true O(1) fix requires a batched `get_vault_states`
> contract entry-point — stub the `fetchOnChainStateBatch` method in
> `ProjectsService` when that endpoint is available.

The scheduled job `refreshMaterializedSnapshots` was also changed from a
sequential `for` loop to a batched `Promise.allSettled` with a concurrency
cap of 10.

---

## Disabling Profiling

Simply unset (or do not set) the env var:

```bash
# default — profiling is off
npm run start:dev

# explicitly off
QUERY_PROFILING=false npm run start:dev
```

---

## Running the N+1 Regression Tests

```bash
# from apps/backend
npm test -- portfolio-n-plus-one
```

The test file is `src/portfolio/portfolio-n-plus-one.spec.ts`.
It asserts that `PriceService.getPricesForAssets` is called exactly **once**
per request regardless of portfolio size (1, 5, or 10 assets).
