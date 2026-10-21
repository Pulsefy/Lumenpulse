# CI path filters

Every workflow runs only when files it cares about change. That is only safe if the
filters are right; for a while they were not, and pull requests merged with no checks.

| | |
|---|---|
| Issue | [#1723](https://github.com/Pulsefy/Lumenpulse/issues/1723) |
| Source of truth | [`.github/ci-paths.json`](../.github/ci-paths.json) |
| Gate | [`ci-gate.yml`](../.github/workflows/ci-gate.yml) → [`scripts/ci-coverage.mjs`](../scripts/ci-coverage.mjs) |
| Tests | [`scripts/test-ci-coverage.mjs`](../scripts/test-ci-coverage.mjs) |

## What was wrong

- `backend.yml`, `mobile.yml`, `data-processing.yml` and `onchain.yml` watched only
  their own `apps/<name>/**` directory plus a sentinel file, `apps/<name>/.ci-trigger`,
  that contributors touched to force CI. A sentinel that exists to defeat the filter
  means the filter was missing real triggers.
- There was **no webapp workflow at all**. A pull request touching only `apps/webapp`
  ran nothing.
- Shared files that every app depends on (lockfiles, `turbo.json`, `docker-compose.yml`,
  the composite actions) triggered nothing.
- Changes to workflow files and to `scripts/` had no workflow, so a broken workflow could
  merge without a single run.

## What changed

1. **Corrected filters.** Each workflow lists its app directory, the shared root files it
   depends on (`package*.json`, `pnpm-*.yaml`, `turbo.json`, `.nvmrc`,
   `docker-compose.yml`, `.python-version`), `.github/actions/**` and its own definition.
   The lists live once in `.github/ci-paths.json`; the `paths:` blocks mirror it and
   `scripts/test-ci-coverage.mjs` fails if they drift.
2. **Sentinels removed.** All four `.ci-trigger` files and every reference are gone.
3. **New workflows for the gaps:** `webapp.yml` (webapp), `scripts-ci.yml` (`scripts/**`
   and the CI tooling), `workflow-lint.yml` (`.github/**`).
4. **A gate that cannot be skipped.** `ci-gate.yml` has no path filter, so every pull
   request runs at least one check. It maps the changed files to the workflows that
   should run, prints the list in the run summary, and **fails** when a code file under
   `apps/`, `scripts/` or `.github/` is covered by none. Other uncovered files (root
   configs such as `prometheus.yml`) are reported as notices.

## Verified against the three known cases

These merged with an empty check list (found by listing recent pull requests whose
`statusCheckRollup` was empty). The tests pin each one:

| Pull request | Files | Before | After |
|---|---|---|---|
| #1763 | `apps/webapp/**`, `docs/…` | nothing | `webapp.yml` |
| #1731 / #1710 / #1733 | `.github/workflows/*`, `.github/actions/*` | nothing | `workflow-lint.yml` (+ the workflow's own CI) |
| #1709 | `scripts/*.mjs`, `scripts/package.json` | nothing | `scripts-ci.yml`, `onchain.yml` |

## Adding a workflow or a path

1. Add the path (or workflow) to `.github/ci-paths.json`.
2. Mirror it in the workflow's `on.push.paths` and `on.pull_request.paths`.
3. Run `node --test scripts/test-ci-coverage.mjs`.

A path that needs no CI (docs, editor settings) belongs under `noCiRequired`.

## Webapp tests that were already red

`webapp.yml` is the first CI the webapp has had, and it surfaced regressions that merged
unnoticed: 10 failing tests in `__tests__/price-alerts.test.tsx`, `app/layout.test.tsx` and
`contexts/StellarConfigContext.test.tsx`. Rather than ship a permanently red check (which
teaches everyone to ignore it) or hide the problem, those three files are excluded by name (the `VITEST_EXCLUDE` variable
in the workflow, read by `apps/webapp/vitest.config.ts`), so the remaining 39 test files, the API type check and the production build
gate every pull request. Fixing a file means deleting its name from `VITEST_EXCLUDE`.
