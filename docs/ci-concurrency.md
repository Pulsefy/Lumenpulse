# CI concurrency groups

Every workflow in `.github/workflows/` declares a `concurrency` group keyed by
workflow and ref, and cancels the in-flight run when a newer commit lands on the
same pull request.

| | |
|---|---|
| Issue | [#1713](https://github.com/Pulsefy/Lumenpulse/issues/1713) |
| Applies to | all files under `.github/workflows/` |
| Introduced | 2026-10-18 |

---

## The pattern

Copy this block verbatim into any new workflow. It belongs at the top level of
the file, next to `on:` and above `jobs:`.

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.head_ref || github.ref }}
  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
```

Both halves are load-bearing.

**`group: ${{ github.workflow }}-${{ github.head_ref || github.ref }}`**

- `github.workflow` keeps each workflow in its own queue. Backend CI, Mobile CI
  and the flake check can all watch `apps/mobile/**` on the same commit without
  cancelling each other.
- `github.head_ref` is only set for `pull_request` events and is the **branch
  name**, not the merge ref `refs/pull/N/merge`. Two different PRs that happen to
  sit at the same number would collide on the ref alone.
- `github.ref` is the fallback, so `push` and `workflow_dispatch` runs are still
  grouped and still deduplicated.

**`cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}`**

Cancellation is enabled everywhere except `main`. A superseded pull-request run
produces a result nobody reads, so cancelling it is free. A run on `main` is a
post-merge check or a deploy — cancelling it can leave a merge commit with no
verification at all. The workflows that only ever run on demand
(`mobile-e2e-flake-check.yml`) use a plain `true`, since there is no `main` run
to protect.

---

## Adding it to a new workflow

1. Paste the block above into the new workflow.
2. Nothing else is required. There is no shared YAML anchor — GitHub does not
   support one across files, and a duplicated four-line block is cheaper to read
   than a generator step.
3. Add `timeout-minutes` to every job in the same PR, following
   [ci-timeouts.md](ci-timeouts.md).

---

## Effect on the queue

Measured with [`scripts/ci-queue-stats.mjs`](../scripts/ci-queue-stats.mjs),
sampled over the 40 most recent completed runs per workflow on `main`.

### Before this change

| Metric | Value |
|---|---|
| Queue wait p50 | 0.0 min |
| Queue wait p90 | 0.0 min |
| Queue wait max | 1153.8 min (19.2 h) |
| Runner time burned on superseded PR runs | 107.3 min |

The median is zero because most commits land while runners are free. The damage
is entirely in the tail: the worst sampled run waited 19 hours for a runner, and
107 minutes of already-started CI produced results that were obsolete before
they finished.

### After this change

Not yet measurable — the change has to be on `main` and accumulate pushes before
the comparison is meaningful. Re-run the script and record the result here:

```bash
GITHUB_TOKEN=<token> node scripts/ci-queue-stats.mjs --repo Pulsefy/Lumenpulse --limit 40
```

| Metric | Value |
|---|---|
| Queue wait p50 | _measure after merge_ |
| Queue wait p90 | _measure after merge_ |
| Queue wait max | _measure after merge_ |
| Runner time burned on superseded PR runs | _measure after merge_ |

**The expected effect is on the tail, not the median.** A contributor who pushes
three times while a 25-minute `mobile-e2e` job is running now pays for one run
instead of three. The `main` column does not change at all, which is the point:
deploy-time verification stays exactly as reliable as it was.

---

## Caveats worth knowing

- **Cancelling frees the runner but not the queue position of everyone behind
  it.** The 19-hour tail above is a capacity problem, not a cancellation problem;
  this change does not add runners. It stops the queue from being made worse by
  work that nobody needs.
- **A cancelled check is reported as `cancelled`, not `success`.** Required status
  checks on the PR still resolve, because the newest commit produces a fresh run.
  Do not mark a job `continue-on-error` to "avoid" cancellation — that is a
  different problem.
- **Changing this block is a workflow change.** It takes effect on the next run;
  in-flight runs keep the group they started with.