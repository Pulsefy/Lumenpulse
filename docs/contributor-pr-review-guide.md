# Contributor PR Review Guide

## 1. Overview

This guide exists to enable **fast, consistent, and high-quality pull request reviews** during the MVP stage of Lumenpulse. The project moves quickly, and maintainers need a shared standard to:

- Unblock contributors without sacrificing correctness
- Prevent bundled or out-of-scope changes from silently merging
- Ensure every merged PR maps cleanly to a tracked issue with well-defined acceptance criteria
- Keep the commit history focused, bisectable, and revertible

**MVP review philosophy:** Ship correct work fast. Nitpicks on style (spacing, variable naming taste preferences) should be follow-up issues, not blockers — unless they violate project conventions documented in this repo or directly impact readability/correctness.

---

## 2. PR Triage Process

Follow these steps **in order** for every pull request. Do not skip earlier steps to jump to line-by-line code review — most review problems are caught at triage.

### Step 1: Check that a linked issue exists

- Open the PR description. It **must** reference at least one issue by number (e.g. `Closes #142`, `Fixes #87`, or at minimum `Related to #209`).
- If no issue is linked → **Request changes immediately.** Leave a comment linking to Section 4 (Branch Naming) and Section 6 (Mapping PR → Issue → AC) of this guide and ask the contributor to open an issue first. Exception: trivial documentation typo fixes of ≤ 3 lines may skip issue linkage with explicit maintainer approval.
- Follow the linked issue. Does it still exist and is it open? Closed/stale issues referenced by a PR may signal the work is no longer needed — confirm before proceeding.

### Step 2: Compare PR changes to the issue's acceptance criteria

- Read the issue description top to bottom. Locate its acceptance criteria (AC) — typically a `## Acceptance Criteria` or `## Done` section.
- Mentally check off each AC against the PR diff:
  - ✅ Explicitly met → proceed
  - ⚠️ Partially met or ambiguous → flag in review comments with a line-level note asking for either implementation or clarification
  - ❌ Missing or contradicted → mark PR as "Request changes" and quote the specific AC that is not satisfied
- If the issue lacks defined acceptance criteria **and** the PR is non-trivial: request the contributor to add an AC list to the issue before continuing review. Ambiguous requirements produce ambiguous reviews.

### Step 3: Confirm scope is focused (single responsibility)

- Ask: *"Does this PR do exactly one coherent thing?"*
- A focused PR typically touches a single domain (e.g. backend model-retraining service only, or mobile lockfile fix only, or docs for one feature) and has a title that fits naturally in the imperative mood: "Add rollback endpoint to model registry", not "Misc fixes + feature + doc updates".
- If you cannot state the PR's purpose in one sentence without using "and also", it almost certainly has bundled scope (see Section 3).

### Step 4: Verify no unrelated changes are included

- Scan the **Files changed** tab for file paths that clearly don't belong:
  - A feature PR touching CI config files without explanation
  - A backend PR changing unrelated frontend asset files
  - Any "oops I accidentally committed…" commits
- Unrelated changes that are beneficial (e.g. a typo fix caught while working on the feature) should still be split into their own PR. Say: *"Thanks for fixing the typo — can you split that into a separate `chore/docs-typo` PR so this one stays focused on #142?"*
- Rebase noise (merge commits into `develop`, etc.) → ask for a clean rebase before reviewing.

---

## 3. Detecting Bundled Scope (Very Important)

Bundled scope is the single biggest source of review debt, regressions on unrelated areas, and unrevertable commits in MVP projects. Catch it early.

### The Golden Rule

> **One PR = One issue = One concern**

Every PR should map to exactly one issue, and that issue should describe exactly one coherent concern (one bug fix, one feature, one docs page, one chore task). If a PR needs an "and" in its description, it is bundled.

### Examples of bundled PRs (REJECT / SPLIT REQUEST)

| PR Title | Why it's bundled | Correct split |
|---|---|---|
| "Fix CI flake + add escrow release endpoint + update README" | Three unrelated concerns: CI reliability, backend feature, docs | 3 PRs: `fix/ci-flaky-token-test`, `feat/escrow-release`, `docs/readme-escrow` |
| "Update mobile lockfile and add model retraining scheduler" | Touches two domains with zero overlap (build tooling vs ML pipeline) | 2 PRs: `chore/mobile-lockfile`, `feat/retraining-scheduler` |
| "Refactor db layer and add sentiment batch endpoint and fix lint in 5 files" | Refactor + feature + lint drive-by are three concerns | 3 PRs: `refactor/db-layer`, `feat/sentiment-batch`, `chore/lint-fixes` |
| "Hotfix login and bump all npm dependencies to latest" | Critical security path mixed with broad dependency churn | 2 PRs: `fix/login-hotfix`, `chore/npm-deps-bump` |

### How to identify bundled scope quickly

1. **Count the issue references.** If the PR closes `#12` and `#47` and `#88` — three issues, three PRs minimum.
2. **Look at the root directories touched.** `apps/backend/` + `apps/mobile/` + `docs/` all modified in the same PR is a red flag unless the feature genuinely spans all three (e.g. end-to-end integration of one shared concept — and even then, ask whether it can be stacked).
3. **Read the commit list.** Multiple commits with subjects like "wip", "fix previous", "add docs", "fix CI" mixed together frequently indicate the author dumped their working branch into a single PR.
4. **Count the concepts in the PR description.** "Also…" and "while I was here…" are telltale bundle phrases.

### What maintainers should do

- **Mild bundling (1 unrelated small change):** Leave a polite comment requesting the extra change be split off. Approve once split (or approve the main change contingent on the follow-up PR being opened). Template:

  > Thanks for the contribution. I noticed this PR also changes [X] which isn't part of the acceptance criteria for #142 per our One PR = One Issue = One Concern rule. Could you move that into a separate `[type]/[area]` PR? Then we can merge this one cleanly.

- **Moderate bundling (2–3 concerns):** Mark review as **Request changes**, list each concern, and ask the contributor to open separate PRs. Do not review the code in detail until the split happens — you will only waste time re-reviewing.

- **Severe bundling (4+ concerns or critical-path mixed with noise):** Reject/close with an explanation and ask for resubmission as stacked PRs. Never merge these just to "be nice" — they produce revert-holes and production incidents.

---

## 4. Branch Naming Conventions

Enforce consistent branch naming. Well-named branches make the review queue instantly scannable and reduce triage time. Reject PRs that come from branches named `patch-1`, `fix-stuff`, `dev`, or contributor usernames alone.

### Format

```
<type>/<area>-<short-description>
```

### Allowed types

| Type | When to use |
|---|---|
| `fix` | Bug fix — resolves an existing defect |
| `feat` | New feature, endpoint, component, or behavior |
| `docs` | Documentation-only changes (README, API docs, lifecycle docs, this guide) |
| `chore` | Build/CI config, dependency bumps, lockfile updates, tooling, or routine maintenance with no runtime behavior change |
| `refactor` | Code restructure with zero user-visible behavior change (if behavior changes, it's `feat` or `fix`) |
| `test` | Adding or fixing tests only, with no code change |

### `<area>` guidance

- Use the top-level module or domain: `backend`, `mobile`, `data-processing`, `ml`, `db`, `ci`, `contracts`
- Or use a fine-grained domain: `escrow`, `sentiment`, `lockfile`, `inventory`, `model-registry`, `scheduler`
- Prefer the more specific area when obvious

### `<short-description>` guidance

- 2–5 kebab-case words
- Imperative mood: `add-*`, `fix-*`, `update-*`, `bump-*`
- Avoid issue numbers in the branch name (reference them in the PR body instead)

### Valid examples

```
fix/mobile-lockfile
fix/ml-rollback-atomic-swap
feat/escrow-release-flow
feat/model-retraining-scheduler
docs/mock-inventory-setup
docs/ai-model-lifecycle
chore/npm-deps-august
chore/ci-timeout-bump
refactor/db-layer-models
test/sentiment-batch-parallel
```

### Invalid examples (with corrections)

| Bad | Good | Reason |
|---|---|---|
| `patch-1` | `docs/readme-typo` | No type or context |
| `john/fix-login` | `fix/backend-login-jwt` | Usernames don't belong in branch names |
| `feature/doing-stuff` | `feat/escrow-release` | Imperative, specific |
| `fix-bug` | `fix/ml-empty-feature-frame` | Describe *what* is fixed |
| `chore` | `chore/bump-python-3.12` | Chore what? |

---

## 5. Evidence Expectations

A PR is a claim that the issue's acceptance criteria are met. Evidence proves the claim. Require evidence proportional to change risk.

### What a good PR includes by change type

| Change type | Required evidence | Optional but helpful |
|---|---|---|
| **UI / frontend visual** | Screenshots (or short video) of **Before → After** on the exact changed screens. Dark + light mode if theme applies. | Storybook link, mobile device screenshots, accessibility tree snippet |
| **CI fix / build flake** | CI log excerpt showing the **failure before** + a link to the **green run after** on this branch. Explanation of root cause. | Comparison of runtimes, link to upstream issue if third-party tooling caused it |
| **Backend endpoint / API change** | `curl` command + 200 OK response (or OpenAPI diff) showing the contract. Error case response for failure path. | Load test snippet for perf-sensitive routes, DB migration plan |
| **Bug fix** | Steps to reproduce the bug before (commit hash) + confirmation the same steps produce correct behavior after. | Link to added regression test proving the fix |
| **Dependency bump / lockfile** | Changelog link for the bumped package's release notes. CI green on the PR branch. | Summary of any breaking changes assessed and accepted |
| **ML / model pipeline change** | Training run metrics (loss, R², coverage_ratio) before/after or vs baseline from `promotion_log.jsonl`. Link to `ModelCard` JSON if produced. | Shadow-mode comparison report agreement rate (≥ 99% = safe per docs) |
| **Documentation only** | Link to rendered markdown or screenshots of any diagrams/flowcharts. Nothing else required for pure typo fixes. | N/A |

### Practical enforcement

- If evidence is missing and the change is non-trivial: **Request changes** with a comment linking to the relevant row above. Template:

  > Thanks for this. To help review quickly, could you add evidence per Section 5 of the PR review guide? For a [type] change we expect [required evidence]. Specifically for this PR: [1-2 concrete asks].

- Do not merge a PR whose behavior you cannot verify from evidence alone — that is not a review, that is a trust exercise.

---

## 6. Mapping PR → Issue → Acceptance Criteria

Clean mapping is the backbone of accountability. Every step in the chain must be explicit.

### PR must reference the issue number

Acceptable formats (anywhere in the PR body — but prefer the first line):

- `Closes #142` (auto-closes on merge — use when the PR fully resolves the issue)
- `Fixes #87` (same auto-close behavior, for bugfixes)
- `Resolves #209` (same)
- `Related to #301` (use for partial work, stacked PRs, or when work on the issue continues after this PR)

Unacceptable: "see issue tracker", pasting issue title only, or referring to a different repo's issue without full URL.

### Reviewer checklist for each acceptance criterion

For every AC in the linked issue, the reviewer must mark in their review comment:

```
AC1: [Description of AC1]  →  ✅ Met (see src/foo.ts#L42-L58 and screenshot in PR body)
AC2: [Description of AC2]  →  ⚠️ Partial — edge case X not covered (see comment)
AC3: [Description of AC3]  →  ❌ Not met — see blocking comment on src/bar.py#L99
```

This serves three purposes:
1. Contributors know *exactly* what to fix before re-requesting review — no guesswork.
2. Future maintainers auditing the merge history can confirm why a PR was approved.
3. It forces the reviewer to read both the issue and the code, not just skim diffs.

### If criteria are not met → Request changes

- Mark each missing/partial AC explicitly with `❌` or `⚠️` and a line-level code comment.
- Never approve with an `❌` outstanding. You may approve with tracked follow-ups for `⚠️` items, but only if the contributor opens separate issues for the partial items and links them in the PR body before merge.

---

## 7. Handling Overlapping PRs

When multiple PRs touch the same area (same file, same module, same feature), you need to decide which one is canonical to avoid merge hell.

### Step 1: Identify the source-of-truth PR

Compare the competing PRs on:
- **Issue linkage:** Which PR is tied to the original, well-scoped issue? Duplicate PRs spun off from Slack messages or ad-hoc asks usually lose.
- **Completeness:** Which PR satisfies all acceptance criteria? A WIP PR is never the source of truth — finish or close it.
- **Timeline:** All else equal, the PR that was opened first (and has active review comments) is canonical. Latecomers should rebase onto it.
- **Scope cleanliness:** If PR A is focused and PR B is bundled, PR A wins even if it was opened later.

### Step 2: Avoid merging conflicting PRs

- If two PRs modify the same function/class with incompatible changes: **do not merge the second until the first merges** and the second is rebased on top. Merging both produces a silent third state that neither PR author tested.
- For Git-level conflicts: GitHub's red "This branch has conflicts that must be resolved" banner — request a rebase from the author of the non-canonical PR.
- For semantic conflicts (no Git conflict but different behavior): Leave a detailed comment on both PRs explaining the overlap and designate one as the source of truth. Example:

  > Heads up — this PR overlaps with #158 which is further along and already has 2 rounds of review. Let's make #158 the source of truth. @author-of-this-PR could you rebase this on top of #158 once it merges, or cherry-pick just your unique additions into #158 as a stacked commit? Happy to help decide which chunks belong where.

### Step 3: Close or rebase duplicates

- **True duplicates** (same fix, same feature, no unique changes): Close the later one with a comment linking to the canonical PR and thanking the contributor. Never leave duplicate PRs open — they waste CI minutes and confuse which PR to review.
- **Partial overlaps:** Ask the author of the non-canonical PR to rebase on `develop` after the canonical PR merges, then re-open. The rebase will surface exactly which changes are new vs. which were already merged upstream.
- **Stacked PRs (intentional, e.g. PR #210 builds on PR #209):** Merge from the bottom of the stack up. Do not merge PR #210 before #209 — it makes #209 unreviewable because its changes are already in #210's diff.

### Step 4: Communicate clearly in comments

Say *who* should do *what* by *when*. Vague "this overlaps" comments leave the situation unresolved. Good comment:

> Overlap detected: both this PR and #173 modify `ModelRetrainingService.triggerRetraining()`. Based on AC completeness and timeline, #173 is the source of truth PR for the force-promotion feature.
>
> Action items:
> 1. I will review #173 first (ETA today).
> 2. @contributor — once #173 merges, please rebase this PR on develop so only your unique scheduler-cron addition remains in the diff.
> 3. Re-request review and I'll do a focused pass on just the cron piece.
>
> Let me know if you'd rather cherry-pick the cron change into a new standalone PR — that works too.

---

## 8. Fast MVP Review Strategy

MVP stage: contributors are frequently blocked on waiting for review. Optimize for **correct, fast decisions** — not exhaustive cosmetic feedback.

### Priorities in order

1. **Correctness first.** Does the code do what the AC says, without obvious bugs? If correctness is in doubt, everything else is secondary — resolve that before commenting on style.
   - Catch: missing null checks, SQL injection / unparameterized queries, hardcoded secrets, unbounded loops, race conditions, wrong API contract.
   - Defer: variable naming taste, whitespace, import ordering (unless auto-fixable).

2. **Scope second.** Use Section 3 ruthlessly. Bundled scope wastes more review time than any style issue — split it early and split it often.

3. **Unblock quickly.** Turn around simple reviews (≤ 20 files, focused) within one working day. If a PR is large and correct: approve it immediately with notes for follow-up improvements as separate issues. Do not hold a correct PR hostage to polish.

4. **Style is last, and is non-blocking.** If the only changes you'd request are cosmetic:
   - Approve the PR.
   - Leave your style notes as non-blocking "Nit:" comments (GitHub's "Approve" + regular comments, not "Request changes").
   - Open a follow-up `chore/style-*` issue and link it in your approval comment so the contributor can address it in their next idle moment without pressure.

### Speed heuristics

- **"Ship / Fix / Split" triage (5 minute pass):** After Step 2 of triage, decide:
  - ✅ **Ship** — approve, or approve with non-blocking nits
  - 🔧 **Fix** — 1–2 concrete correctness asks, re-request review
  - ✂️ **Split** — bundled scope, close with split instructions
  - If you can't decide in 5 minutes, it's "Split" 9 times out of 10.

- **The 80/20 rule for code comments:** Spend review effort on the top 20% of the code that handles 80% of the risk (hot paths, auth, DB writes, money/escrow logic, model promotion). Trivial helper functions and UI chrome get a cursory scan — deep review of those is not high-leverage.

---

## 9. Maintenance Section

This guide is a living document. It reflects the MVP workflow Lumenpulse uses today — and workflows change.

### When to update this guide

Update [contributor-pr-review-guide.md](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/docs/contributor-pr-review-guide.md) whenever:

- **A new section is needed.** Example: the team adopts squash-merge vs. merge-commit policy; add a Section 10 for merge strategy.
- **A rule changes.** Example: branch naming grows a `hotfix/` type; update Section 4.
- **A gap is identified during review.** If you had to make a judgment call not covered by this guide and the call becomes recurring, codify it. Add the rule plus 1 concrete example.
- **Project stages change.** MVP priorities (Section 8) shift as the project matures — the "speed over perfection" weighting will move toward "perfection over speed" as the release date approaches. Update Section 8 to match the current stage.

### How to update

1. Open a `docs/pr-guide-update` PR.
2. Link an issue describing *why* the guide is changing (e.g. `#244: Add hotfix branch type for production incidents`).
3. Tag **all maintainers** on the PR — guide changes affect the whole review team and require consensus.
4. In the PR body, add a **Change summary** table:

   | Section | Old rule | New rule | Rationale |
   |---|---|---|---|
   | 4. Branch Naming | 6 types: fix/feat/docs/… | 7 types: + `hotfix/` | Need distinct branch type for off-cycle prod patches to avoid confusion with regular `fix/` work |

5. After merge, notify the contributor channel (Slack/Discourse/etc.) so reviewers know the standard has changed.

### Who owns this guide

The **Lead Maintainer** (or equivalent role) is the default owner. Ownership means:
- Proactively reviewing the guide once per release cycle (~monthly) for gaps.
- Curating the backlog of guide-update issues.
- Ensuring maintainer onboarding includes reading and signing off on this guide.
