# CI job timeouts

Every job in `.github/workflows/` declares a `timeout-minutes` budget. Each budget
is derived from the job's observed runtime distribution, and each job reports its
actual runtime back into the run summary so the budgets can be re-derived instead
of guessed.

| | |
|---|---|
| Issue | [#1714](https://github.com/Pulsefy/Lumenpulse/issues/1714) |
| Applies to | all jobs under `.github/workflows/` |
| Introduced | 2026-10-18 |

---

## Observed versus configured

Observed durations are sampled from the 40 most recent completed runs per
workflow and were collected with
[`scripts/ci-queue-stats.mjs`](../scripts/ci-queue-stats.mjs) immediately before
this change. The runtime column is re-measured on every run by the timeout guard
action, so drift is visible without re-running the script.

| Workflow | Job | p50 | p90 | max | `timeout-minutes` | Headroom over p90 |
|---|---|---|---|---|---|---|
| `backend.yml` | `backend-checks` | 1.4 | 1.8 | 1.9 | **10** | 5.5x |
| `backend.yml` | `migration-safety` | 1.1 | 1.2 | 1.2 | **10** | 8.3x |
| `backend.yml` | `db-e2e` | 2.6 | 2.8 | 2.9 | **20** | 7.1x |
| `mobile.yml` | `mobile-checks` | 0.7 | 0.8 | 0.9 | **10** | 12.5x |
| `mobile.yml` | `mobile-size` | 1.6 | 2.1 | 2.2 | **15** | 7.1x |
| `mobile.yml` | `mobile-startup` | 1.5 | 1.9 | 2.0 | **15** | 7.9x |
| `mobile.yml` | `mobile-e2e` | 1.4 | 1.8 | 11.3 | **25** | 13.9x over p50 |
| `data-processing.yml` | `data-processing-checks` | 2.6 | 3.2 | 3.5 | **15** | 4.7x |
| `onchain.yml` | `onchain-checks` | 0.9 | 4.5 | 6.5 | **30** | 6.7x |
| `mobile-e2e-flake-check.yml` | `repeat-suite` | — | — | 11.3 | **30** | 2.6x over the worst run |
| `mobile-e2e-flake-check.yml` | `report` | — | — | — | **5** | four `echo` lines |

All figures are minutes.

### Why these values and not the p90

A budget equal to the observed p90 fails roughly one run in ten on cold caches,
which trains everyone to ignore a red job. A budget of three to eight times p90
costs a runner a little longer in the rare bad case and removes essentially all
false timeouts. The outliers where that rule bends:

- **`mobile-e2e` — 25 min.** The p90 is 1.8 min but the worst observed run was
  11.3 min, a bimodal distribution caused by whether `expo start --web` boots
  before the suite begins polling. The budget is set from the tail.
- **`onchain-checks` — 30 min.** Also bimodal: 1 min when `Swatinem/rust-cache`
  hits, 4.5 min when it misses, because a pull request compiles the workspace to
  `wasm32-unknown-unknown` **twice** — once for the branch, once for the
  base-branch worktree used by the size check. The cache-miss tail sets the value.
- **`db-e2e` — 20 min, unchanged.** This job already had a budget and the
  observed p90 of 2.8 min does not justify *lowering* it. It provisions Postgres
  and Redis from scratch and migrates a clean database before any assertion
  runs, so the cold-runner floor is several times the warm p90. Lowering it
  would have traded a real reliability property for no gain.
- **`data-processing-checks` — 15 min.** Installs the hash-pinned
  `requirements.lock`, which pulls the torch CPU wheel. A cache miss is
  dominated by that download, not by the tests.

---

## Distinguishing a timeout from a test failure

GitHub cancels a timed-out job outright: no step of the workflow runs, and the
check shows as `cancelled` with no output. On a repository this busy that is
indistinguishable from someone force-cancelling a run, and it hides the fact that
the interesting question — *which step was hanging* — was never answered.

Two mechanisms fix that.

### 1. The timeout guard action

Every job opens and closes
[`.github/actions/job-timeout-guard`](../.github/actions/job-timeout-guard/action.yml),
which records the observed runtime into the job summary next to the configured
budget, and raises a titled error once the job has consumed 80% of its budget:

```
Job timeout — `db-e2e` consumed 84% of its 20-minute timeout budget after
16.8 min. This job is about to be cancelled by the runner rather than failing
on its own merits; raise `timeout-minutes` for db-e2e (see docs/ci-timeouts.md)
or find the step that is blocking.
```

Because it fires at the soft threshold rather than at the ceiling, it gives the
diagnostic **before** the runner takes the decision.

A job adds two steps. The first, immediately after the job opens:

```yaml
- name: Start timeout guard
  uses: ./.github/actions/job-timeout-guard
  with:
    phase: start
    job-id: db-e2e
    budget-minutes: '20'
    note: Provisions Postgres+Redis, migrates a clean database, runs the serial DB-backed e2e suite.
```

The last, with `if: always()` so it also runs on failure:

```yaml
- name: Report timeout guard
  if: always()
  uses: ./.github/actions/job-timeout-guard
  with:
    phase: finish
    job-id: db-e2e
    budget-minutes: '20'
    note: Provisions Postgres+Redis, migrates a clean database, runs the serial DB-backed e2e suite.
```

`budget-minutes` **must** equal the job's `timeout-minutes`. If the two drift
apart the guard measures against a budget that does not exist, and the soft
threshold means nothing. When you change one, change both.

### 2. An explicit soft limit inside the two long-running jobs

`db-e2e` and `mobile-e2e` wrap their command in `timeout(1)` at a limit several
minutes below the job ceiling, and remap exit code 124 to a titled error naming
the job and what to look at:

```yaml
- name: Run DB-backed e2e suite
  env:
    DB_E2E_SOFT_LIMIT_SECONDS: '900'
  run: |
    set +e
    timeout --signal=TERM --kill-after=30s "${DB_E2E_SOFT_LIMIT_SECONDS}" npm run test:e2e:db
    code=$?
    if [ "$code" -eq 124 ] || [ "$code" -eq 137 ]; then
      echo "::error title=db-e2e timed out::The DB-backed e2e suite did not finish within"
      exit 1
    fi
    exit "$code"
```

| Job | Job ceiling | Soft limit | Reason for the gap |
|---|---|---|---|
| `db-e2e` | 20 min | 15 min | Enough time to flush the result, upload teardown state and print the summary. |
| `mobile-e2e` | 25 min | 18 min | The Playwright report is uploaded on failure; the gap lets that upload finish. |

---

## Changing a budget

1. Run the measurement and read the job's current p50/p90:

   ```bash
   GITHUB_TOKEN=<token> node scripts/ci-queue-stats.mjs --repo Pulsefy/Lumenpulse --limit 40
   ```

2. Set `timeout-minutes` to roughly 3-8x the p90, or to the observed maximum
   when the distribution is bimodal. Never set it below the p90.
3. Update `budget-minutes` in **both** guard steps in that job, and update the
   table above.
4. For `db-e2e` and `mobile-e2e`, update the soft limit too, keeping the gap in
   the table.

**Raising a budget is cheap; lowering one is a claim that the job got faster.**
Do not lower a budget to make the Actions tab look tidy. If a job is close to its
ceiling regularly, the budget is telling you the truth and the job is the problem.