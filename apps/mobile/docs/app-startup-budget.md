# Mobile cold-start time budget

Issue #1576 — Wave 10 tracks how long the Expo app takes to become usable on a
low-end device profile. Size budgets (issue #1413) guard download weight; this
budget guards **time to first paint and interactivity**.

Tooling: `e2e/startup-budget.spec.ts`, `scripts/check-mobile-startup.mjs`
(budgets: `mobile-startup-budgets.json`, baseline: `mobile-startup-baseline.json`).
CI: `mobile-startup` job in `.github/workflows/mobile.yml`.

## What is measured

| Metric | Definition |
| --- | --- |
| `coldStartMs` | First load: `navigation.domContentLoadedEventEnd` on `/` (empty cache). |
| `warmStartMs` | Immediate `reload()` on the same tab (warm cache). |
| `timeToInteractiveMs` | Navigation start → app `timeToInteractive` mark (after `InteractionManager.runAfterInteractions`). The 0×0 `app-interactive` test id is a sentinel only; E2E waits on `__LUMENPULSE_STARTUP__`, not visibility. |

Measurements run against the **Expo web** build (same as the smoke E2E suite) under:

- Device profile: **Pixel 5** (Playwright)
- **4× CPU** throttle and **Fast 3G** network emulation (CDP)

Native Hermes cold start on physical hardware is not measured in default CI; use
the same `startup-metrics` marks locally with `expo run:android` profiling when
needed.

## Baseline (recorded)

See `mobile-startup-baseline.json`. Initial ceilings were calibrated for **GitHub Actions**
(Expo web + 4× CPU throttle), which is slower than a local dev machine. Refresh after
intentional startup work:

```sh
cd apps/mobile
npm run startup:baseline
```

## Thresholds

Each metric has `warningMs` (CI `::warning::`) and `maxMs` (job failure). Values
live in `mobile-startup-budgets.json`.

## Deferred work (first paint)

The following must **not** block time-to-interactive:

- `CachedApi.preloadCriticalData()` — scheduled via `scheduleAfterInteractive`
  in `components/DataPreloader.tsx` (mounted from `app/_layout.tsx` only after
  auth is known, never on the critical render path).

## Local commands

```sh
npm run startup:measure   # Playwright spec + budget check (non-failing warnings)
npm run startup:baseline  # Rewrite mobile-startup-baseline.json from latest run
```

Report before/after numbers in your pull request when changing startup behaviour.
