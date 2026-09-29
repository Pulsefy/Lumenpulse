# Contributor PR Review Guide

The single reference for reviewing a pull request and closing an issue in this repository.
It replaces the former `review-playbook.md` and `review-guide.md`, whose content is folded in
here.

[CONTRIBUTING.md](../CONTRIBUTING.md) is written for the **author** of a change; this guide is
written for the **reviewer**. Where the two overlap, CONTRIBUTING.md defines the standard and
this guide defines how a reviewer confirms it was met.

| Section | Use it for |
|---|---|
| [1. Philosophy](#1-philosophy) | What this guide optimises for |
| [2. Local verification](#2-local-verification) | Getting the branch running before you read code |
| [3. Triage](#3-triage) | The first pass on every PR, in order |
| [4. Definition of done for issue closure](#4-definition-of-done-for-issue-closure) | Confirming the work actually exists |
| [5. Detecting bundled scope](#5-detecting-bundled-scope) | The biggest source of review debt |
| [6. Branch naming](#6-branch-naming) | Allowed prefixes and areas |
| [7. Area-specific checklists](#7-area-specific-checklists) | Per-app review criteria |
| [8. Evidence expectations](#8-evidence-expectations) | What proof a change needs |
| [9. Mapping PR to issue to acceptance criteria](#9-mapping-pr-to-issue-to-acceptance-criteria) | Recording the verdict |
| [10. Overlapping PRs](#10-overlapping-prs) | Deciding which PR is canonical |
| [11. Fast MVP review strategy](#11-fast-mvp-review-strategy) | Where to spend review effort |
| [12. Reviewer quick reference](#12-reviewer-quick-reference) | The checklist to run every time |
| [13. Maintaining this guide](#13-maintaining-this-guide) | Changing the standard |

---

## 1. Philosophy

This guide exists to enable **fast, consistent, high-quality reviews** during the MVP stage.
The project moves quickly, and maintainers need a shared standard to:

- Unblock contributors without sacrificing correctness
- Prevent bundled or out-of-scope changes from silently merging
- Ensure every merged PR maps cleanly to a tracked issue with defined acceptance criteria
- Keep history focused, bisectable, and revertible
- Ensure a closed issue corresponds to work that is actually on `main` (§4)

**Ship correct work fast.** Style nitpicks — spacing, naming taste — are follow-up issues, not
blockers, unless they violate a documented convention or directly harm readability or
correctness.

---

## 2. Local verification

### 2.1 Check out the branch

```bash
git fetch origin
git checkout <contributor-branch>
```

Verify it targets `main` and is rebased on the latest `main`:

```bash
git log main..HEAD --oneline
git merge-base --is-ancestor main HEAD && echo "Up to date" || echo "Needs rebase"
```

If the branch is behind `main`, ask for a rebase before review continues.

### 2.2 Prerequisites

| Requirement | Minimum version | Needed for |
|---|---|---|
| Node.js | 18+ | Mobile, webapp, backend |
| Python | 3.9+ | Data processing |
| Rust | 1.75+ with `wasm32-unknown-unknown` | Smart contracts |
| PostgreSQL | 14+ | Backend E2E tests |
| Redis | — | Backend cache and queue features |

### 2.3 Run the checks

Run these for every affected area **before reading any code**:

| Area | Install | Lint | Test |
|---|---|---|---|
| **Mobile** (`apps/mobile`) | `npm install` | `npm run lint && npm run tsc` | `npm test`, plus emulator/device verification |
| **Webapp** (`apps/webapp`) | `npm install` | `npm run lint` | `npm run test` |
| **Backend** (`apps/backend`) | `npm install` | `npm run lint` | `npm run test`, and `npm run test:e2e` for endpoint changes |
| **Data processing** (`apps/data-processing`) | `pip install -e ".[dev]"` | `ruff check . && mypy src` | `pytest` |
| **Contracts** (`apps/onchain`) | — | `cargo fmt --all -- --check && cargo clippy --all-targets --all-features -- -D warnings` | `cargo test --workspace` |

If any fail, stop and request fixes. Do not review logic before a green local state.

### 2.4 Smoke test

For runtime-facing changes, confirm the app starts:

- **Mobile**: `npm run start` — Expo loads with no red screen
- **Webapp**: `npm run dev` — `localhost:3000` renders with no console errors
- **Backend**: `npm run start:dev` — NestJS boots and the health endpoint responds
- **Contracts**: a passing `cargo test --workspace` is sufficient

---

## 3. Triage

Follow these **in order** for every PR. Most review problems are caught here, not in
line-by-line reading.

### Step 1 — A linked issue exists

- The PR description must reference an issue: `Closes #142`, `Fixes #87`, or at minimum
  `Related to #209`.
- No linked issue → **request changes immediately**, pointing at §6 and §9. Exception: a
  documentation typo fix of three lines or fewer, with explicit maintainer approval.
- Open the issue. Is it still open? A closed or stale issue may mean the work is no longer
  wanted — confirm before reviewing.

### Step 2 — Changes match the acceptance criteria

Read the issue top to bottom and check each criterion against the diff:

- ✅ Explicitly met → proceed
- ⚠️ Partial or ambiguous → line-level comment asking for implementation or clarification
- ❌ Missing or contradicted → request changes, quoting the specific criterion

If the issue has no acceptance criteria and the PR is non-trivial, ask for them to be added to
the issue first. Ambiguous requirements produce ambiguous reviews.

### Step 3 — Scope is focused

Ask: *does this PR do exactly one coherent thing?* If you cannot state its purpose in one
sentence without "and also", it is bundled — go to §5.

### Step 4 — No unrelated changes

Scan **Files changed** for paths that do not belong: a feature PR touching CI config without
explanation, a backend PR changing frontend assets, accidental commits. Even a beneficial
drive-by fix should be split:

> Thanks for fixing the typo — could you split that into a separate `chore/docs-typo` PR so
> this one stays focused on #142?

Rebase noise (stray merge commits) → ask for a clean rebase before reviewing.

---

## 4. Definition of done for issue closure

An issue is closed only when the work it describes is present on `main`. **A merged pull
request with a matching title is not sufficient evidence, and is not accepted as evidence on
its own.** §13.1 lists four audited cases where it was accepted and the work did not exist.

The authoring side of this policy is in
[CONTRIBUTING.md](../CONTRIBUTING.md#definition-of-done-for-issue-closure). The reviewer's side
is below, and it is not optional.

### 4.1 The PR must name its artefacts

Every PR that closes an issue carries an **Artefacts** section listing, by repository path,
each file it creates or changes:

```markdown
## Artefacts

- `.github/workflows/webapp.yml` - new CI workflow for `apps/webapp`
- `apps/webapp/e2e/checkout.spec.ts` - Playwright coverage for the checkout flow
```

- [ ] An Artefacts section is present.
- [ ] Every path in it is a real repository path, not a description of the work.
- [ ] Every path appears in the PR's **Files changed** tab.
- [ ] Each artefact is non-empty and contains the implementation — not a stub or placeholder.
- [ ] A claimed **test suite** is discovered and executed by the runner, not merely present as
      files. Check CI output for the new test names, or run the suite.
- [ ] A claimed **CI workflow** lives under `.github/workflows/` and has appeared in the
      Actions tab for the merge commit.
- [ ] Documentation issues are no exception — a doc issue is closed by a document existing at
      a stated path.

### 4.2 Confirm the artefacts on the merged branch

Reading the GitHub diff summary does not satisfy this. Run it:

```bash
git fetch origin main
git ls-tree -r --name-only origin/main -- <path>   # prints the path if it exists
git show origin/main:<path> | head                 # prints the content, fails if absent
```

If an artefact named by a merged PR is missing, **reopen the issue** and post the output
showing its absence.

### 4.3 Closing without a merged PR

Requires an explicit written reason as a comment before the close, stating which case applies:

- **Superseded** — name the issue or PR that replaced it.
- **Already satisfied** — name the existing artefact path and the commit that added it.
- **Not doing** — state the decision and who made it.
- **Cannot reproduce / invalid** — state what was tried.
- **Duplicate** — link the original issue.

"Done", "fixed", "completed", or a bare close with no comment is not a reason. An issue closed
with neither a linked merged PR nor a written reason should be reopened by anyone who notices.

---

## 5. Detecting bundled scope

Bundled scope is the single biggest source of review debt, unrelated regressions, and
unrevertable commits. Catch it early.

> **One PR = one issue = one concern**

If a PR needs an "and" in its description, it is bundled.

### Examples

| PR title | Why it is bundled | Correct split |
|---|---|---|
| "Fix CI flake + add escrow release endpoint + update README" | CI reliability, backend feature, docs | `fix/ci-flaky-token-test`, `feat/escrow-release`, `docs/readme-escrow` |
| "Update mobile lockfile and add model retraining scheduler" | Build tooling vs ML pipeline, zero overlap | `chore/mobile-lockfile`, `feat/retraining-scheduler` |
| "Refactor db layer and add sentiment batch endpoint and fix lint in 5 files" | Refactor + feature + drive-by lint | `refactor/db-layer`, `feat/sentiment-batch`, `chore/lint-fixes` |
| "Hotfix login and bump all npm dependencies" | Critical security path mixed with broad dependency churn | `fix/login-hotfix`, `chore/npm-deps-bump` |

### How to spot it quickly

1. **Count issue references.** `Closes #12` and `#47` and `#88` means three PRs minimum.
2. **Look at the root directories touched.** `apps/backend/` + `apps/mobile/` + `docs/` in one
   PR is a red flag unless the feature genuinely spans all three — and even then ask whether it
   can be stacked.
3. **Read the commit list.** "wip", "fix previous", "add docs", "fix CI" mixed together usually
   means a working branch was dumped into one PR.
4. **Count the concepts in the description.** "Also…" and "while I was here…" are tells.

### What to do

- **Mild (one small unrelated change):** polite comment requesting a split; approve once split,
  or approve contingent on a follow-up PR being opened.

  > Thanks for the contribution. This PR also changes [X], which isn't part of the acceptance
  > criteria for #142 per our one PR = one issue = one concern rule. Could you move that into a
  > separate `[type]/[area]` PR? Then we can merge this one cleanly.

- **Moderate (two or three concerns):** **request changes**, list each concern, ask for separate
  PRs. Do not review the code in detail until the split happens — you will only re-review it.
- **Severe (four or more, or critical path mixed with noise):** close with an explanation and
  ask for resubmission as stacked PRs. Never merge these to be nice; they produce revert-holes
  and incidents.

---

## 6. Branch naming

Reject PRs from branches named `patch-1`, `fix-stuff`, `dev`, or a bare username.

```
<type>/<area>-<short-description>
```

| Type | When to use |
|---|---|
| `fix` | Resolves an existing defect |
| `feat` | New feature, endpoint, component, or behaviour |
| `docs` | Documentation-only changes |
| `chore` | Build/CI config, dependency bumps, lockfiles, tooling — no runtime change |
| `refactor` | Restructure with zero user-visible behaviour change |
| `test` | Adding or fixing tests only |

> **Known discrepancy:** [CONTRIBUTING.md](../CONTRIBUTING.md) currently names only `feat/`,
> `fix/`, and `docs/` as required prefixes, while this guide and the existing history also use
> `chore/`, `refactor/`, and `test/`. Until the two are reconciled, accept any of the six and
> do not block a PR on this alone.

- **`<area>`** — the top-level module (`backend`, `mobile`, `webapp`, `data-processing`,
  `onchain`, `ci`) or a finer domain (`escrow`, `sentiment`, `lockfile`, `model-registry`).
  Prefer the more specific one when it is obvious.
- **`<short-description>`** — two to five kebab-case words, imperative mood, no issue numbers
  (those go in the PR body).

| Bad | Good | Reason |
|---|---|---|
| `patch-1` | `docs/readme-typo` | No type or context |
| `john/fix-login` | `fix/backend-login-jwt` | Usernames don't belong in branch names |
| `feature/doing-stuff` | `feat/escrow-release` | Imperative and specific |
| `fix-bug` | `fix/ml-empty-feature-frame` | Describe *what* is fixed |
| `chore` | `chore/bump-python-3.12` | Chore what? |

---

## 7. Area-specific checklists

Use the checklist matching the changed area. Skip what does not apply; never skip what does.

### 7.1 Frontend (mobile / webapp)

- [ ] Explicit TypeScript types — no `any` without justification.
- [ ] Functional, hook-based components; no new class components.
- [ ] No inline styles where `StyleSheet` (mobile) or Tailwind classes (webapp) apply.
- [ ] State follows existing `contexts/` and `hooks/` patterns.
- [ ] Routing changes are consistent with the existing router setup.
- [ ] Interactive elements have accessible labels and roles.
- [ ] No hardcoded strings that should be localized (see `locales/` for mobile).
- [ ] Screenshots or recordings attached for visual changes.
- [ ] Verified on at least one target platform.

### 7.2 Backend

- [ ] Business logic in services, not controllers.
- [ ] DTOs validated with `class-validator` decorators.
- [ ] API changes include updated Swagger/OpenAPI annotations.
- [ ] Database changes have a TypeORM migration that runs cleanly.
- [ ] Error responses follow `{ code, message, details, requestId }`.
- [ ] Rate limiting or throttling documented when public endpoints change.
- [ ] No secrets in source; all config via environment variables.
- [ ] `npm run test` passes, and `npm run test:e2e` when endpoints change.

### 7.3 Smart contracts

- [ ] `cargo fmt --all -- --check` passes.
- [ ] `cargo clippy --all-targets --all-features -- -D warnings` passes.
- [ ] `cargo test --workspace` passes, including edge cases.
- [ ] Storage keys and types stay backward-compatible — no silent breaking changes.
- [ ] Events and errors are explicit and documented for on-chain observability.
- [ ] Interface-impacting changes documented in [SMART_CONTRACTS.md](SMART_CONTRACTS.md).
- [ ] No unchecked arithmetic — `overflow-checks = true` preserved in `Cargo.toml`.
- [ ] A new contract carries a test module (`src/test.rs` or `#[cfg(test)]`), matching siblings
      such as `crowdfund_vault` and `vesting-wallet`.

### 7.4 Data processing

- [ ] `ruff check .` passes with zero violations.
- [ ] `mypy src` passes with no new errors.
- [ ] `pytest` passes; new pipeline logic has tests.
- [ ] Alembic migrations are forward-only and tested.
- [ ] Model or schema changes reflected in `models/` and the relevant docs.

### 7.5 Documentation

- [ ] Spelling and grammar are correct.
- [ ] The file is in `docs/` (project-level) or beside the relevant code (area-specific).
- [ ] Links to other docs, issues, and code resolve.
- [ ] No duplication of information that lives elsewhere — prefer linking.

---

## 8. Evidence expectations

A PR is a claim that the acceptance criteria are met. Evidence proves the claim. Require it in
proportion to risk.

| Change type | Required evidence | Helpful extras |
|---|---|---|
| **UI / visual** | Before → after screenshots or video of the changed screens; both themes if theming applies | Device screenshots, accessibility tree snippet |
| **Layout or styling fix** | Screenshot showing the fix | — |
| **Animation or interaction** | Screen recording | — |
| **CI fix / build flake** | Log excerpt of the failure, link to the green run on this branch, root-cause explanation | Runtime comparison, upstream issue link |
| **Backend endpoint / API** | `curl` plus response (or OpenAPI diff) showing the contract, and the error-path response; unit + E2E test | Load test for perf-sensitive routes, migration plan |
| **Bug fix** | Repro steps before (with commit hash) and the same steps passing after; a regression test that fails before and passes after | — |
| **New contract function** | Integration test covering happy path and edge cases | — |
| **New pipeline step** | Pytest covering input/output and error handling | — |
| **Dependency bump** | Changelog link for the release, CI green on the branch | Breaking changes assessed |
| **ML / model pipeline** | Metrics before/after or vs baseline from `promotion_log.jsonl`; `ModelCard` JSON if produced | Shadow-mode agreement rate (≥ 99% is safe) |
| **Refactor, no behaviour change** | Existing tests pass with no coverage drop | — |
| **Logic-only, no visual change** | State "N/A — no visual change" in the PR | — |
| **Documentation only** | Link to the rendered markdown; nothing more for pure typos | — |

Evidence goes in the PR description or a comment. Do not make reviewers build the branch to see
the change, and **do not merge a PR whose behaviour you cannot verify from the evidence** —
that is not a review, it is a trust exercise.

### Risk notes

The PR must include a **Risk** section when any of these apply:

- **Database migration** — rollback path and data-loss risk
- **Breaking API change** — affected consumers and migration steps
- **Contract upgrade** — storage compatibility and upgrade mechanism
- **Auth or security change** — attack-surface impact
- **New third-party dependency** — license, maintenance status, bundle size
- **Performance-sensitive path** — expected impact and benchmarks

If none apply: `Risk: None identified`.

---

## 9. Mapping PR to issue to acceptance criteria

### Accepted reference formats

- `Closes #142` / `Fixes #87` / `Resolves #209` — auto-close; use when the PR fully resolves it
- `Related to #301` — partial work, stacked PRs, or work continuing after this PR

Not accepted: "see issue tracker", pasting only the issue title, or another repo's issue
without a full URL.

### Record the verdict

For every acceptance criterion, mark it in your review comment:

```
AC1: [description]  →  ✅ Met (see src/foo.ts#L42-L58 and the screenshot in the PR body)
AC2: [description]  →  ⚠️ Partial — edge case X not covered (see comment)
AC3: [description]  →  ❌ Not met — see blocking comment on src/bar.py#L99
```

This does three things: contributors know exactly what to fix; anyone auditing the merge history
can see why the PR was approved; and it forces the reviewer to read both the issue and the code
rather than skimming the diff.

**Never approve with an ❌ outstanding.** You may approve with tracked follow-ups for ⚠️ items,
but only if the contributor opens separate issues and links them in the PR body before merge.

---

## 10. Overlapping PRs

### Step 1 — Identify the canonical PR

- **Issue linkage** — which PR is tied to the original, well-scoped issue? Duplicates spun off
  from ad-hoc asks usually lose.
- **Completeness** — which satisfies all the acceptance criteria? A WIP PR is never canonical.
- **Timeline** — all else equal, the one opened first with active review comments wins.
- **Scope cleanliness** — a focused PR beats a bundled one even if opened later.

### Step 2 — Do not merge conflicting PRs

- Two PRs changing the same function incompatibly: do not merge the second until the first
  merges and the second is rebased. Merging both produces a third state neither author tested.
- Git-level conflicts: request a rebase from the non-canonical author.
- Semantic conflicts (no Git conflict, different behaviour): comment on both, designate one as
  canonical.

### Step 3 — Close or rebase duplicates

- **True duplicates:** close the later one, linking the canonical PR and thanking the
  contributor. Never leave duplicates open — they burn CI minutes and confuse the queue.
- **Partial overlaps:** ask for a rebase on `main` after the canonical PR merges; the rebase
  surfaces exactly which changes are genuinely new.
- **Stacked PRs:** merge from the bottom up. Merging #210 before #209 makes #209 unreviewable,
  because its changes are already in #210's diff.

### Step 4 — Say who does what

Vague "this overlaps" comments leave the situation unresolved:

> Overlap detected: this PR and #173 both modify `ModelRetrainingService.triggerRetraining()`.
> On completeness and timeline, #173 is canonical for the force-promotion feature.
>
> 1. I'll review #173 first (ETA today).
> 2. @contributor — once #173 merges, rebase this on `main` so only your scheduler-cron
>    addition remains in the diff.
> 3. Re-request review and I'll do a focused pass on the cron piece.

---

## 11. Fast MVP review strategy

Optimise for **correct, fast decisions**, not exhaustive cosmetic feedback.

1. **Correctness first.** Does it do what the acceptance criteria say, without obvious bugs?
   Catch missing null checks, unparameterized queries, hardcoded secrets, unbounded loops, race
   conditions, wrong API contracts. Defer naming taste, whitespace, import ordering.
2. **Scope second.** Apply §5 ruthlessly. Bundled scope wastes more review time than any style
   issue.
3. **Unblock quickly.** Turn around focused reviews (≤ 20 files) within one working day. A large
   but correct PR gets approved now, with improvements filed as separate issues. Do not hold a
   correct PR hostage to polish.
4. **Style last, and non-blocking.** If your only requests are cosmetic: approve, leave "Nit:"
   comments, and open a follow-up `chore/style-*` issue.

### Heuristics

- **Ship / Fix / Split (five-minute pass)** after triage step 2:
  - ✅ **Ship** — approve, or approve with non-blocking nits
  - 🔧 **Fix** — one or two concrete correctness asks, re-request review
  - ✂️ **Split** — bundled scope, close with split instructions
  - If you cannot decide in five minutes, it is Split nine times out of ten.
- **80/20 on comments.** Spend effort on the 20% of code carrying 80% of the risk: hot paths,
  auth, DB writes, escrow and money logic, model promotion. Helper functions and UI chrome get
  a cursory scan.

### MVP sprint adjustments

- **Single approval** is enough for a small, well-scoped PR with green checks.
- **Block only on real risk.** File follow-ups instead of blocking on niceties.
- **Pair on contract changes.** Any Soroban PR wants a reviewer with Rust/Soroban context; if
  none is available, note the gap explicitly in the review.
- **Daily merge cadence** keeps branches fresh and reduces rebase pain.
- **Hotfix path:** critical fixes may merge on a single approval plus green CI. Use a
  `fix(critical):` prefix and file a retrospective issue.

---

## 12. Reviewer quick reference

```
 1. [ ] PR links to an issue with acceptance criteria
 2. [ ] Branch targets main, is rebased, and uses an allowed prefix
 3. [ ] All affected areas pass lint and tests locally
 4. [ ] Area-specific checklist (§7) is satisfied
 5. [ ] Artefacts section present; every path is in Files changed and is not a stub  (§4.1)
 6. [ ] Artefacts confirmed to exist on the merged branch via git ls-tree / git show  (§4.2)
 7. [ ] Screenshots or video attached for visual changes
 8. [ ] Test evidence provided for behavioural changes
 9. [ ] Risk section present and complete
10. [ ] Every acceptance criterion verified or explicitly deferred
11. [ ] No unrelated or out-of-scope changes mixed in
12. [ ] Commit messages follow Conventional Commits
```

All twelve pass → approve. Any fail → comment on what is needed and request changes.

### A review blocks when

- The Artefacts section is missing, or names paths absent from the diff
- A claimed file exists but is empty or a stub
- Scope does not match the linked issue
- Tests or lint were skipped without a stated reason
- Required docs are missing

---

## 13. Maintaining this guide

### 13.1 Worked examples of the failure mode

An audit of Wave 8 found four issues closed with no corresponding artefact on `main`. Each had
a pull request merged under a matching title; in each case the work was not there afterwards.
Each row gives the command that demonstrates the absence.

| # | Claimed artefact | Expected path | Verification that would have caught it |
|---|---|---|---|
| 1 | Webapp CI workflow | `.github/workflows/webapp.yml` | `ls .github/workflows` — no webapp workflow, and none had ever run in the Actions tab. |
| 2 | Playwright end-to-end suite | `apps/webapp/playwright.config.ts`, `apps/webapp/e2e/` | `find . -iname '*playwright*' -not -path '*/node_modules/*'` returned nothing, and `playwright` was absent from `apps/webapp/package.json`. |
| 3 | Webapp i18n catalogs | `apps/webapp/messages/*.json` | No catalog directory and no i18n dependency in `apps/webapp/package.json`; no component imported a translation hook. |
| 4 | `notification_interface` test module | `apps/onchain/contracts/notification_interface/src/test.rs` | The crate held only `Cargo.toml` and `src/lib.rs`, with no `#[cfg(test)]` module — unlike sibling contracts such as `crowdfund_vault` and `vesting-wallet`, whose convention it claimed to follow. |

The shared pattern: each was accepted on the strength of the PR title and description alone. In
every case one command against the merged branch would have shown the work was not there. That
command is now §4.2.

### 13.2 When to update

Update this file whenever:

- **A new section is needed** — e.g. the team adopts a squash-merge policy.
- **A rule changes** — e.g. branch naming grows a `hotfix/` type; update §6.
- **A gap is found during review.** If you made a judgment call this guide does not cover and
  it recurs, codify it with one concrete example.
- **Project stage changes.** The speed-over-perfection weighting in §11 should move as the
  release date approaches.

### 13.3 How to update

1. Open a `docs/pr-guide-update` PR.
2. Link an issue describing *why* the guide is changing.
3. Tag all maintainers — guide changes affect the whole review team and need consensus.
4. Include a change-summary table in the PR body:

   | Section | Old rule | New rule | Rationale |
   |---|---|---|---|
   | §6 Branch naming | six types | seven types, adding `hotfix/` | Distinct type for off-cycle production patches |

5. After merge, tell the contributor channel so reviewers know the standard moved.

### 13.4 Ownership

The **lead maintainer** owns this guide: reviewing it once per release cycle for gaps, curating
guide-update issues, and ensuring maintainer onboarding includes reading it.
