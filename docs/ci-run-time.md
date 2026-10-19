# CI run time

Budgets live in `.github/ci-budgets.json` (p90, minutes) and are checked weekly by
`.github/workflows/ci-metrics.yml`, which measures recent runs with
`scripts/ci-run-time.mjs` and warns when a workflow or job exceeds its budget. The
baseline the budgets were derived from is committed in `docs/ci-baseline.json`;
budgets sit roughly 1.5x above it so only a real regression trips them.

## Slowest three jobs

| Job | Baseline p90 | Where the time goes | Proposed improvement |
| --- | --- | --- | --- |
| `onchain.yml` / Test Suite | 6.1 min | Cold Rust compile of the workspace and contract builds | Share the cargo target cache across the test and contract-build steps; split contract tests per crate in a matrix |
| `data-processing.yml` / data-processing-checks | 3.2 min | Dependency install and the unit-test suite | Cache keyed on `requirements.lock` (done by `setup-python-app`); run lint and tests as parallel jobs |
| `backend.yml` / db-e2e | 2.8 min | Postgres/Redis service start, migrations, then the e2e suite | Reuse the built `dist/` from the checks job; run e2e spec files in two shards |

## Implemented: cache the Playwright browsers

The mobile e2e and startup jobs downloaded Chromium on every run (steps measured in
the Actions API). They now restore `~/.cache/ms-playwright` with `actions/cache`,
keyed on `apps/mobile/package-lock.json`, so the browser download is skipped until
the Playwright version changes.

| Step: Install Playwright browsers | Before | After (cache hit) | Saved |
| --- | --- | --- | --- |
| mobile-e2e | 22 s | 12 s | 10 s |
| mobile-startup | 21 s | 16 s | 5 s |

The remaining time is Playwright installing its system libraries, which the cache
cannot hold. The saving is per run of each job, about 15 s per mobile workflow run.
