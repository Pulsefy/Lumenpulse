# Review Playbook

**Version**: 1.0.0
**Audience**: Maintainers and contributors reviewing PRs against `main`
**Purpose**: Define a repeatable, area-aware review process so every merge is traceable, tested, and low-risk — especially during the 8-week MVP sprint.

---

## 1. Branch Checkout and Local Verification

### 1.1 Checkout the Branch

```bash
git fetch origin
git checkout <contributor-branch>
```

Verify the branch targets `main` and is rebased on the latest `main`:

```bash
git log main..HEAD --oneline
git merge-base --is-ancestor main HEAD && echo "Up to date" || echo "Needs rebase"
```

If the branch is behind `main`, ask the contributor to rebase before review continues.

### 1.2 Prerequisites

Ensure the following runtimes and services are available before running area-specific checks:

| Requirement | Minimum Version | Notes |
|---|---|---|
| Node.js | 18+ | Mobile, Webapp, Backend |
| Python | 3.9+ | Data Processing |
| Rust | 1.75+ (with `wasm32-unknown-unknown` target) | Smart Contracts |
| PostgreSQL | 14+ | Backend (required for E2E tests) |
| Redis | — | Backend (required for cache/queue features) |

### 1.3 Run Local Verification

Install dependencies and run checks for every affected area before reading any code:

| Area | Install | Lint | Test |
|---|---|---|---|
| **Mobile** (`apps/mobile`) | `npm install` | `npm run lint && npm run tsc` | Verify on emulator/device |
| **Webapp** (`apps/webapp`) | `npm install` | `npm run lint` | `npm run test` |
| **Backend** (`apps/backend`) | `npm install` | `npm run lint` | `npm run test` (and `npm run test:e2e` for endpoint changes) |
| **Data-processing** (`apps/data-processing`) | `pip install -e ".[dev]"` | `ruff check . && mypy src` | `pytest` |
| **Contracts** (`apps/onchain`) | — | `cargo fmt --all -- --check && cargo clippy --all-targets --all-features -- -D warnings` | `cargo test --workspace` |

If any of these fail, stop and request fixes. Do not review logic until CI-green state is confirmed locally.

### 1.4 Quick Smoke Test

For runtime-facing changes, confirm the app starts without errors:

- **Mobile**: `npm run start` — verify Expo loads without red screen.
- **Webapp**: `npm run dev` — verify `localhost:3000` renders without console errors.
- **Backend**: `npm run start:dev` — verify NestJS boots and health endpoint responds.
- **Contracts**: `cargo test --workspace` passing is sufficient for smoke.

---

## 2. Issue-to-PR Traceability

Every PR must link to an issue. Verify the chain before reviewing code:

1. **PR description** contains `Closes #<number>` or `Fixes #<number>`.
2. **Issue acceptance criteria** are listed in the PR description or referenced.
3. **Scope match**: changed files map to the issue scope. Flag unrelated changes for removal or a separate PR.
4. **Branch naming**: branch uses `feat/`, `fix/`, or `docs/` prefix per [CONTRIBUTING.md](../CONTRIBUTING.md).

If traceability is broken — no linked issue, missing acceptance criteria, or scope mismatch — block the review and ask the contributor to resolve before proceeding.

---

## 3. Area-Specific Review Checklists

Use the checklist that matches the changed area. Skip sections that do not apply, but never skip a section that does.

### 3.1 Frontend (Mobile / Webapp)

- [ ] TypeScript types are explicit — no `any` without justification.
- [ ] Components are functional and hook-based; no class components introduced.
- [ ] No inline styles where `StyleSheet` (mobile) or Tailwind classes (webapp) apply.
- [ ] State management follows existing context/hook patterns (see `contexts/` and `hooks/`).
- [ ] Navigation/routing changes are consistent with the existing router setup.
- [ ] Accessibility: interactive elements have appropriate labels and roles.
- [ ] No hardcoded strings that should be localized (see `locales/` for mobile).
- [ ] Visual changes include screenshots or screen recordings in the PR.
- [ ] Verified on at least one target platform (iOS/Android for mobile; Chrome for webapp).

### 3.2 Backend

- [ ] Business logic lives in services, not controllers.
- [ ] DTOs are validated with `class-validator` decorators.
- [ ] API-facing changes include updated Swagger/OpenAPI annotations.
- [ ] Database changes have a corresponding TypeORM migration that runs cleanly.
- [ ] Error responses follow the standardized contract: `{ code, message, details, requestId }`.
- [ ] Rate-limiting or throttling is documented when public endpoints change.
- [ ] No secrets or credentials in source; all config via environment variables.
- [ ] `npm run test` passes; `npm run test:e2e` passes when endpoints are added or modified.

### 3.3 Smart Contracts

- [ ] `cargo fmt --all -- --check` passes.
- [ ] `cargo clippy --all-targets --all-features -- -D warnings` passes.
- [ ] `cargo test --workspace` passes, including edge-case tests.
- [ ] Contract storage keys and types remain backward-compatible (no silent breaking changes).
- [ ] Events and errors are explicit and documented for on-chain observability.
- [ ] Interface-impacting changes are documented in `document/SMART_CONTRACTS.md`.
- [ ] No unchecked arithmetic — `overflow-checks = true` is preserved in `Cargo.toml`.

### 3.4 Data Processing

- [ ] `ruff check .` passes with zero violations.
- [ ] `mypy src` passes with no new errors.
- [ ] `pytest` passes; new analysis/pipeline logic has corresponding tests.
- [ ] Alembic migrations (if any) are forward-only and tested.
- [ ] Model or schema changes are reflected in `models/` and any relevant docs.

### 3.5 Documentation

- [ ] Spelling and grammar are correct.
- [ ] File is placed in `document/` (project-level guides) or alongside the relevant code (area-specific).
- [ ] Links to other docs, issues, or code are valid.
- [ ] No redundant duplication of information that lives elsewhere — prefer linking.

---

## 4. Evidence and Risk Requirements

### 4.1 Screenshots and Video Evidence

| Change type | Evidence required |
|---|---|
| New or modified screen (mobile/webapp) | Screenshot or short screen recording showing before/after |
| Layout or styling fix | Screenshot showing the fix |
| Animation or interaction change | Screen recording |
| No visual change (logic-only) | State "N/A — no visual change" in PR |

Evidence must be embedded directly in the PR description or linked from a comment — do not require reviewers to build and navigate to the change.

### 4.2 Test Evidence

| Change type | Test evidence required |
|---|---|
| New API endpoint | Unit test + E2E test showing request/response |
| Bug fix | Regression test that fails before the fix and passes after |
| New contract function | Integration test covering happy path and edge cases |
| New data pipeline step | Pytest covering input/output and error handling |
| Refactor with no behavior change | Existing tests still pass (confirm no coverage drop) |

Contributors should paste passing test output or link to a green CI run. Do not assume CI will catch everything — local verification is required.

### 4.3 Risk Notes

The PR description must include a **Risk** section when any of the following apply:

- **Database migration** — note rollback path and data loss risk.
- **Breaking API change** — list affected consumers and migration steps.
- **Contract upgrade** — note storage compatibility and upgrade mechanism.
- **Auth or security change** — note attack surface impact.
- **Third-party dependency addition** — note license, maintenance status, and bundle size impact.
- **Performance-sensitive path** — note expected impact and any benchmarks.

If none apply, the contributor should write: `Risk: None identified`.

---

## 5. Confirming Acceptance Criteria

Before approving, the reviewer must verify every acceptance criterion from the linked issue:

1. **List the criteria**: Copy each criterion from the issue into the review comment.
2. **Match to evidence**: For each criterion, point to the code, test, or screenshot that satisfies it.
3. **Mark pass/fail**: Use a checklist in the review summary.

Example review summary:

```
## Acceptance Criteria Verification

- [x] Portfolio refresh triggers on pull-down — see `hooks/usePortfolioSync.ts:42`
- [x] Loading spinner shows during refresh — screenshot attached in PR
- [ ] Error state displays retry button — missing; requested in comment
```

Do not approve until every criterion is verified or explicitly deferred with a tracking issue.

---

## 6. Reviewer Quick Reference

Use this as a rapid checklist during every review:

```
1. [ ] PR links to an issue with acceptance criteria
2. [ ] Branch targets main, is rebased, and uses correct prefix
3. [ ] All affected areas pass lint and tests locally
4. [ ] Area-specific checklist (Section 3) is satisfied
5. [ ] Screenshots/video attached for visual changes
6. [ ] Test evidence provided for behavioral changes
7. [ ] Risk section present and complete
8. [ ] Every acceptance criterion is verified or deferred
9. [ ] No unrelated or out-of-scope changes mixed in
10. [ ] Commit messages follow Conventional Commits
```

If all 10 items pass, approve. If any fail, leave a clear comment explaining what is needed and mark the review as "Request changes."

---

## 7. MVP Sprint Notes

During the 8-week MVP sprint, apply these adjustments:

- **Speed over ceremony**: If a PR is small, well-scoped, and all checks pass, a single reviewer approval is sufficient. No need for two approvers.
- **Block only on real risk**: Skip optional niceties (minor style preferences, non-blocking docs) in review comments. File follow-up issues instead.
- **Pair on contract changes**: Any Soroban contract PR should have at least one reviewer with Rust/Soroban context. If unavailable, explicitly note the gap in the review.
- **Daily merge cadence**: Maintainers should merge approved PRs at least once per day to keep branches fresh and reduce rebase pain.
- **Hotfix path**: Critical fixes can merge with a single approval + verified CI green. Add a `fix(critical):` commit prefix and file a retrospective issue.
