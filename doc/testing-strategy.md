# Testing Strategy

## 1. Purpose

This document defines the expected test types, minimum coverage bar, and run commands for every application and library in the Lumenpulse monorepo. It serves two goals:

1. **Set expectations for contributors** — every change author knows how much and what kind of testing their PR must carry before review.
2. **Provide a single operational reference** — anyone can reproduce, locally, the exact suites that CI runs.

The baseline recorded in §3 is the state as of the writing of this document. Over time, coverage thresholds and file counts are expected to *rise*, never fall, without an explicit ADR-level decision.

---

## 2. Test Taxonomy & Mocking Guidance

Before listing per-app rules, we define the three layers every contributor should reason about, along with what should and should not be mocked at each layer.

### 2.1 Unit Tests

**Scope:** A single function, class, or module. No filesystem, no network, no subprocess. One behaviour = one assertion block.

**What belongs here:**
- Pure functions and utilities (math, mappers, parsers, formatters).
- Guards, interceptors, middleware, DTO validators.
- Service methods when all collaborators can be meaningfully stubbed.
- Edge cases: empty inputs, boundary values, error paths.

**What to mock:**
- Everything *outside* the unit under test (other services, repositories, network clients, clocks).
- Use the framework's built-in mocking primitives: `jest.mock`, Vitest auto-mocks, `pytest-mock`, Rust `#[cfg(test)]` + trait objects / dummy `Env`.
- Database: always mock. Do not spin up Postgres/Redis in a unit test.
- External APIs (Horizon, Soroban RPC, Telegram, SMTP, S3): always mock with static fixtures.

**What NOT to mock:**
- The unit under test itself.
- DTOs, types, value objects — test them with real values.
- Pure helper functions the unit calls internally within the same file.

**Naming convention:**
- TypeScript / Jest — `*.spec.ts` (unit) colocated next to source in `src/`.
- TypeScript / Vitest — `*.test.ts` or `*.test.tsx` colocated or in `__tests__/`.
- Python / pytest — `tests/unit/test_<module>.py`, marker `@pytest.mark.unit`.
- Rust — `#[cfg(test)] mod test` in `src/lib.rs` or `src/test.rs`.

### 2.2 Integration Tests

**Scope:** Two or more real units collaborating across a module boundary. May involve real (but local, containerised) infrastructure.

**What belongs here:**
- Controllers + services + validators wired together (no real HTTP server needed — use the testing module / `Test.createTestingModule`).
- DB queries / repositories against a real Postgres in a container or throwaway schema.
- Soroban contract *wrappers* against the actual compiled WASM via a local sandbox where feasible; otherwise against a well-defined fake that enforces the same interface shape.
- Outbox pattern: enqueue → poll → dequeue with a real Redis/BullMQ instance.
- Event ingestion pipeline: raw event bytes → mapper → persistence → read model rebuild.

**What to mock:**
- Third-party *external* APIs that have no local sandbox (e.g. news providers, email senders).
- Authentication sources that require OAuth/Stellar signer interaction.

**What NOT to mock:**
- Your own service-to-service calls within the bounded context under test.
- Database or message broker when the behaviour being validated *is* the DB/broker interaction.
- ORM query builders — let them run real SQL.

**Naming / location convention:**
- Backend NestJS — `*.integration.spec.ts` inside `src/` (e.g. `src/stellar/tests/contract-rotation.integration.spec.ts`), or `test/*.e2e-spec.ts` for HTTP layer.
- Data-processing Python — `tests/integration/test_<scenario>.py`, marker `@pytest.mark.integration`.
- Onchain Rust — `contracts/tests/` workspace crate for cross-contract flows; `src/tests/mod.rs` inside individual crates for multi-function scenarios.

### 2.3 End-to-End (E2E) Tests

**Scope:** The full application stack from the user-visible surface (HTTP route, Expo screen, on-chain transaction) down to real side effects. Slowest and most expensive layer; use sparingly.

**What belongs here:**
- HTTP API journeys: `POST /auth/login` → use token → `GET /users/me` → `POST /auth/logout`.
- Idempotency & rate-limiting surfaces (the backend `test/idempotency.e2e-spec.ts` and `test/rate-limit-validation.e2e-spec.ts` pattern).
- Contract admin flows that cross Rust + backend boundaries (deploy → register role → invoke protected endpoint).
- Critical user journeys in mobile/web only where a bug would block a release or cause financial loss.

**What to mock:**
- As little as possible — ideally only payment rails and third-party accounts that cannot be sandboxed.
- Web/Mobile E2E: mock wallet browser extensions / biometric modules that do not exist in CI.

**What NOT to mock:**
- HTTP servers, routers, DI containers.
- Database migrations or the real schema.
- Contract WASM blobs — deploy to testnet or a local sandbox (e.g. Stellar Quickstart) rather than stubbing.

**Naming convention:**
- Backend: `apps/backend/test/*.e2e-spec.ts`, run via `jest --config ./test/jest-e2e.json`.
- Mobile/Web: to be added under `e2e/` subdirectories when Playwright / Detox suites are introduced.

### 2.4 Mocking Boundary Cheat Sheet

| Dependency                | Unit | Integration | E2E |
|---------------------------|:----:|:-----------:|:---:|
| In-module helpers         |  ✅  |     ✅      |  ✅ |
| Other services (same app) |  🧪  |     ✅      |  ✅ |
| DB / ORM / Redis          |  🧪  |     ✅      |  ✅ |
| BullMQ / queues           |  🧪  |     ✅      |  ✅ |
| Stellar / Soroban RPC     |  🧪  |     🧪*     |  ✅ |
| News / sentiment APIs     |  🧪  |     🧪      |  🧪** |
| Email / Telegram push     |  🧪  |     🧪      |  🧪 |
| S3 / file storage         |  🧪  |     🧪      |  ✅ (localstack or mocks acceptable) |
| Auth (OAuth / 2FA)        |  🧪  |     🧪      |  🧪 |

✅ = Use the real thing.
🧪 = Mock / stub.
\*  Soroban calls: prefer the Soroban test harness (Env::default()) in integration tests rather than a live RPC.
\** News API at E2E: record-and-replay (VCR-style) fixtures are acceptable in place of a live call.

---

## 3. Baseline Coverage Position

This section records the *current* state of test investment across the monorepo at the time this strategy was adopted. It is a baseline — the bar can only be raised.

### 3.1 File Count Baseline

| App / Area           | Framework | Unit Files | Integration / E2E | Current Totals        | Target (min bar §4) |
|----------------------|-----------|:----------:|:-----------------:|-----------------------|--------------------|
| Backend (NestJS)     | Jest      |    ~81     |        7 E2E      | 88 total spec files  | see §4.1           |
| Webapp (Next.js)     | Vitest    |    ~22     |         0         | 22 total test files  | see §4.2           |
| Mobile (Expo)        | Jest      |    ~13     |         0         | 13 total test files  | see §4.3           |
| Data-processing      | pytest    |    ~62     |    4 integration  | 66 total test files  | see §4.4           |
| Onchain contracts    | cargo test|    13†     |         0         | 13/19 tested crates  | see §4.5           |

† 12 crates have a `src/test.rs`; 1 additional crate (`reentrancy-guard`) carries inline `#[cfg(test)]` tests directly in `lib.rs`.

### 3.2 Coverage Thresholds (Where Configured)

| Area           | Threshold                                                                                                |
|----------------|----------------------------------------------------------------------------------------------------------|
| Mobile (Expo)  | branches ≥ 26% · functions ≥ 24% · lines ≥ 25% · statements ≥ 25% — enforced in `jest.config.js`.       |
| Backend        | Coverage collected via `jest --coverage` → `apps/backend/coverage/`; no numeric floor enforced yet.     |
| Webapp         | `vitest run --coverage` available; no numeric floor enforced yet.                                       |
| Data-processing| pytest coverage not yet wired into the `pyproject.toml` / `pytest.ini`; install `pytest-cov` to enable. |

### 3.3 Contract Crate Baseline (Untested = 6 crates)

**Tested contract crates (13 / 19 workspace + extra):**

| Crate                     | Workspace | Tests location                               |
|---------------------------|:---------:|----------------------------------------------|
| contributor_registry      |    ✅     | `src/test.rs`                                |
| crowdfund_vault           |    ✅     | `src/test.rs`, `src/test_yield.rs`, `src/tests/` (4 files) |
| feature_flags             |    ✅     | `src/test.rs`                                |
| lumen_token               |    ✅     | `src/test.rs`                                |
| matching_pool             |    ✅     | `src/test.rs`, `src/tests/` (3 files, proptest) |
| pricing_adapter           |    ✅     | `src/test.rs`                                |
| project_registry          |    ✅     | `src/test.rs`                                |
| protocol_registry         |    ✅     | `src/test.rs`                                |
| reentrancy-guard          |    ✅     | inline `#[cfg(test)] mod tests` in `lib.rs`  |
| treasury                  |    ✅     | `src/test.rs`                                |
| upgradable-contract       |    ✅     | `src/test.rs`                                |
| vesting-wallet            |    ✅     | `src/test.rs`                                |
| yield_vault               |    ✅     | `src/test.rs`                                |

**Untested contract crates (6 / 19 — no `test.rs`, no inline `#[cfg(test)]`):**

| Crate                     | Workspace | Notes                                                  |
|---------------------------|:---------:|--------------------------------------------------------|
| idempotency-guard         |    ✅     | Tiny guard crate; needs at least acquire/release tests |
| liquidity_pool            |    ✗      | Not in workspace, has Cargo.toml + src/*.rs            |
| lumenpulse-curation       |    ✅     | Full crate (errors/events/storage/types/lib) — no tests|
| notification_broker       |    ✗      | Not in workspace, has Cargo.toml + src/*.rs            |
| notification_interface    |    ✅     | Trait-only interface crate; at minimum doctests needed |
| stable_swap_pool          |    ✗      | Not in workspace, has Cargo.toml + src/*.rs            |

Action items recorded for the six untested crates are tracked in the repo issue tracker; adding even a single happy-path unit test for each will clear this list.

---

## 4. Per-App Expected Test Types & Minimum Bar

### 4.1 Backend — `apps/backend` (NestJS / Jest)

**Framework:** Jest (unit), Supertest (E2E HTTP).
**Runner config:** `jest` key in `package.json` for unit; `test/jest-e2e.json` for E2E.

**Expected test distribution:**
| Change type                                      | Min expected tests                                                                |
|--------------------------------------------------|-----------------------------------------------------------------------------------|
| DTO / validation / guard / interceptor / pipe    | 2+ unit specs per class (happy path + at least one error path).                   |
| Service method logic change                      | 1+ unit spec per changed branch; add integration spec if DB/RPC behaviour shifts. |
| New controller route                             | 1+ unit spec on the controller + 1 E2E spec in `test/*.e2e-spec.ts`.              |
| DB migration / entity change                     | Integration spec that exercises the changed read/write paths.                     |
| Auth / RBAC / security surface                   | Unit + E2E for every new role / permission combination.                           |
| Soroban contract client wrapper                  | Unit with mock `Env`; integration spec against the compiled WASM where possible.  |

**Minimum bar per PR:**
- Unit test count for touched files ≥ the number of meaningful logic branches added.
- E2E: if the PR touches any HTTP contract used by webapp or mobile, at least one e2e-spec must exercise or be updated for it.
- Lint + typecheck + build green (see §6).

### 4.2 Webapp — `apps/webapp` (Next.js / Vitest)

**Framework:** Vitest with jsdom, React Testing Library, user-event.
**Runner config:** `vitest.config.ts` (globals: true, setupFiles: `./vitest.setup.ts`).

**Expected test distribution:**
| Change type                                      | Min expected tests                                                                 |
|--------------------------------------------------|------------------------------------------------------------------------------------|
| Pure utility / hook                              | 1+ unit test per exported function / hook — cover loading, error, and data states.|
| Context provider / consumer                      | Render test + at least one assertion on default vs. provided state.                |
| New component with branching UI / props          | Test every boolean prop / conditional render branch.                               |
| Form flows (input → submit → state update)       | Single behavioural test that fires user events, not shallow snapshots.             |
| Layout, route, or admin console page             | Smoke render test asserting no throw + critical text content present.              |
| API route under `app/api/.../route.ts`           | 1+ test calling the route handler directly (import `GET`/`POST`).                  |

**Minimum bar per PR:**
- No new *unconditional* render code ships without at least one passing test that mounts it.
- If coverage is reported, each PR must not lower overall % (run `npm run test:coverage` locally and compare).
- Lint + build green (see §6).

### 4.3 Mobile — `apps/mobile` (Expo / Jest)

**Framework:** Jest (node test environment), ts-jest, native-module mocks in `lib/__tests__/mocks/`.
**Runner config:** `jest.config.js` (coverageThresholds enforced at 26/24/25/25 %).

**Expected test distribution:**
| Change type                                      | Min expected tests                                                                 |
|--------------------------------------------------|------------------------------------------------------------------------------------|
| `lib/` utility (api-client, cache, stellar, …)   | 1+ spec per new function; add mocks for new native / network calls.                |
| Wallet adapter / registry logic                  | Spec covering register → resolve → error fallback behaviour.                      |
| Secure storage / biometric lock                  | Test with the existing mock adapters, not real `expo-*` modules.                   |
| Contexts (`contexts/`)                           | Smoke test wrapping children + asserting context values propagate.                 |
| Hooks (`hooks/`)                                 | Unit test each exported hook's loading / data / error states.                      |

**Minimum bar per PR:**
- Coverage thresholds in `jest.config.js` are **hard floors**. A PR must not lower any of branches / functions / lines / statements. If a floor legitimately needs adjusting, it must be raised in a separate chore PR before the code change, never lowered.
- `npm run tsc -- --noEmit` must pass before review.
- Lint green.

### 4.4 Data-processing — `apps/data-processing` (Python / pytest)

**Framework:** pytest with pytest-asyncio, pytest-mock; markers `unit` and `integration` registered in `pytest.ini`.
**Runner config:** `pytest.ini` (`testpaths = tests`, `python_files = test_*.py`).

**Expected test distribution:**
| Change type                                      | Min expected tests                                                                 |
|--------------------------------------------------|------------------------------------------------------------------------------------|
| Core engine / algorithm / pure function          | 1+ per branch; add a property test or parametrize edge cases if numeric.           |
| DB model / KPI computation / reconciliation      | Integration test with real (containerised or temp) Postgres + migrated schema.     |
| Fetcher / ingestion path                         | Unit with httpx mock / recorded cassette; integration test asserting write path.   |
| ML / model registry / shadow predictor           | Unit spec on input/output schema + at least one integration smoke on a tiny fixture.|
| Alert rule / notifier                             | Unit + integration asserting a round-trip message lands in the expected outbox.    |

**Minimum bar per PR:**
- If adding a Python source file under `src/`, a sibling test file under `tests/` or `tests/unit/` must exist.
- Ruff + flake8 green per `data-processing.yml`.
- mypy strict config (`pyproject.toml` [tool.mypy]) passes for touched modules; test files are relaxed.

### 4.5 Onchain contracts — `apps/onchain` (Rust / Soroban SDK)

**Framework:** `cargo test` with `soroban-sdk` test `Env`; proptest-style regression files where used.
**Runner config:** workspace `Cargo.toml` (resolver = "2", members = 16 crates).

**Expected test distribution:**
| Change type                                      | Min expected tests                                                                 |
|--------------------------------------------------|------------------------------------------------------------------------------------|
| New public `#[contractimpl]` entrypoint          | 1 happy path + 1 auth/error guard per entrypoint; 1 spec per event fired.          |
| Storage layout / `#[contracttype]`               | Round-trip write → read spec + a migration spec if layout is non-additive.         |
| Math / curve / fee logic                         | Parametrized / invariant-style specs covering 0, boundaries, and typical values.   |
| Cross-contract call (client-to-vault etc.)       | Add to the crate's `src/tests/` sub-module; prefer mock client contract in-process.|
| New standalone contract crate                    | `src/test.rs` must exist before PR merge; cover at minimum the deploy + init flow. |

**Minimum bar per PR:**
- `cargo fmt --all -- --check` green.
- `cargo clippy --all-targets --all-features -- -D warnings` green.
- `cargo build --target wasm32-unknown-unknown --release` green.
- Every touched crate that currently has tests must still pass `cargo test -p <crate>`.
- Every new crate added to `Cargo.toml` workspace `members` must include a `src/test.rs` (or equivalent `#[cfg(test)]` module) — the 6 crates in §3.3 are a **legacy** list, not a precedent. New crates ship with tests.

---

## 5. Commands to Run Each Suite (Locally)

Every command below is the exact invocation CI uses, unless otherwise noted. All commands are run from the repository root unless the `--prefix` argument or `working-directory` changes it.

### 5.1 Root workspace shortcuts

```bash
# Install JS deps for all three JS apps at once
npm run install:apps

# Run backend + webapp tests in one shot (mobile excluded by default — see §5.3)
npm test
```

### 5.2 Backend

```bash
cd apps/backend
npm install

# Unit tests — 81 *.spec.ts files in src/
npm run test

# Watch mode during development
npm run test:watch

# Unit tests with coverage → coverage/
npm run test:cov

# E2E HTTP tests — 7 *e2e-spec.ts files in test/
# (Requires backend env vars; copy .env.example → .env and start DB/Redis)
npm run test:e2e

# Debug a single unit test
npm run test:debug -- <pattern>
```

### 5.3 Webapp

```bash
cd apps/webapp
npm install

# Run all 22 Vitest suites once and exit (CI mode)
npm run test

# Watch mode during development
npm run test:watch

# Interactive browser UI (optional @vitest/ui)
npm run test:ui

# Run with coverage
npm run test:coverage

# Bundle budget regression (pre-deploy gate, not a "test" but part of validation)
npm run bundle:budget
```

### 5.4 Mobile

```bash
cd apps/mobile
npm install

# Run all 13 Jest suites (--runInBand is the default — required for mocks)
npm run test

# Run tests with coverage (enforces the 26/24/25/25 % floor from jest.config.js)
npm run test:coverage

# Type-check (separate step — not part of `test`)
npm run tsc -- --noEmit
```

### 5.5 Data-processing

```bash
cd apps/data-processing
python -m venv .venv
source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Run all 66 pytest suites (unit + integration together — default CI invocation)
pytest

# Run only unit tests (uses the marker registered in pytest.ini)
pytest -m unit

# Run only integration tests
pytest -m integration

# Lint gates that CI runs before tests
flake8 . --count --select=E9,F63,F7,F82 --show-source --statistics
flake8 . --count --exit-zero --max-complexity=10 --max-line-length=127 --statistics
```

### 5.6 Onchain contracts

```bash
cd apps/onchain

# Prereq — Rust stable + wasm32 target
rustup default stable
rustup target add wasm32-unknown-unknown

# Format check
cargo fmt --all -- --check

# Lint
cargo clippy --all-targets --all-features -- -D warnings

# Build all contract WASMs (release)
cargo build --target wasm32-unknown-unknown --release

# Run all unit tests across every workspace member
cargo test

# Test a single crate
cargo test -p matching_pool

# Test a single crate with extra verbosity for env logs
cargo test -p crowdfund_vault -- --nocapture
```

---

## 6. Required CI Checks Before Review

The pull request template (`/.github/pull_request_template.md`) already lists a validation checklist. The following CI workflows are the **gatekeeping** checks. A PR is not ready for review until every applicable check has passed.

### 6.1 Workflow Matrix

| Workflow file                | Trigger paths                       | Required before review? | Checks performed                                                                                                    |
|------------------------------|-------------------------------------|:-----------------------:|---------------------------------------------------------------------------------------------------------------------|
| `backend.yml`                | `apps/backend/**` + `.ci-trigger`   |           YES           | Lint (`eslint`) · Type-check (conditional script) · Tests (`jest`) · Build (`nest build`)                           |
| **Webapp** (new workflow)    | `apps/webapp/**` (tracked below)    |           YES           | `next lint` · Vitest (`npm run test`) · `next build`                                                                |
| `mobile.yml` + `mobile-ci.yml` | `apps/mobile/**` + `.ci-trigger` | YES (both combined)   | Typecheck (`tsc --noEmit`) · Unit tests w/ coverage floor (`npm run test:coverage`)                                 |
| `data-processing.yml`        | `apps/data-processing/**` + trigger |           YES           | flake8 syntax gate · flake8 style gate · pytest                                                                     |
| `onchain.yml`                | `apps/onchain/**` + `.ci-trigger`   |           YES           | `cargo fmt` · `cargo clippy -- -Dw` · `cargo build --release wasm32` · `cargo test`                                 |

### 6.2 Webapp Workflow (to be created — reflected in the new strategy)

The webapp currently lacks a `webapp.yml` in `.github/workflows/`. The required new-webapp gate, and the one reviewers must treat as blocking per this document, is:

```yaml
# .github/workflows/webapp.yml  (not yet committed — adopt this alongside this strategy doc)
name: Webapp CI
on:
  push: { branches: [main], paths: ['apps/webapp/**'] }
  pull_request: { branches: [main], paths: ['apps/webapp/**', 'apps/webapp/.ci-trigger'] }
jobs:
  webapp-checks:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: ./apps/webapp } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20.x', cache: 'npm', cache-dependency-path: './apps/webapp/package-lock.json' }
      - run: npm ci
      - run: npm run lint
      - run: npm run test            # vitest run
      - run: npm run build           # next build
```

Until the workflow above is present, reviewers **must ask** the author to confirm they ran `lint` + `test` + `build` locally and paste evidence, before approving.

### 6.3 Mobile Workflow — Combining Both Files

Two workflows touch mobile (`mobile.yml` and `mobile-ci.yml`). Reviewers should treat them as a single required gate:

- **Type safety:** `npx tsc --noEmit --project apps/mobile/tsconfig.json` (from `mobile-ci.yml`).
- **Tests + coverage floors:** `npm run test:coverage` from `mobile.yml` in the `apps/mobile` directory — must pass *without* raising thresholds or lowering them.

### 6.4 Bypassing Tests

Every workflow honors `env.SKIP_TESTS=true` for the onchain, backend, and data-processing jobs. This is intended **only** for docs-only or cosmetic PRs, and must be justified explicitly in the PR description. A reviewer who did not author the PR should confirm the bypass is appropriate before merging.

Mobile and webapp have no such override; their test steps always run.

---

## 7. Raising the Bar

Baselines recorded in §3 and coverage thresholds in §3.2 are **floors**, not targets. The expected motion is:

1. Every new crate under `apps/onchain/contracts` ships with a `test.rs` (erodes the §3.3 untested list one crate at a time).
2. Every backend PR that touches a currently-untested service adds at least one spec for that service.
3. Mobile coverage thresholds are reviewed quarterly; the numbers in `jest.config.js` should march upward as pure logic migrates from screens into `lib/`.
4. Once webapp coverage is wired to a numeric floor, it should follow the same quarterly raise model as mobile.

Proposals to change any minimum bar, add a new layer (e.g. browser E2E with Playwright, Detox mobile E2E, fuzz testing), or to permanently lower any threshold must be filed as an ADR under `doc/adr/` and referenced in this document.

---

## 8. Quick Reference Card

| Goal                              | From repo root, run:                                                                                    |
|-----------------------------------|---------------------------------------------------------------------------------------------------------|
| All JS unit tests (backend + web) | `npm test`                                                                                              |
| Backend unit                      | `npm run test --prefix apps/backend`                                                                    |
| Backend E2E                       | `npm run test:e2e --prefix apps/backend`                                                                |
| Webapp unit                       | `npm run test --prefix apps/webapp`                                                                     |
| Mobile unit + coverage floor      | `npm run test:coverage --prefix apps/mobile`                                                            |
| Mobile typecheck                  | `npm run tsc --prefix apps/mobile -- --noEmit`                                                          |
| Data-processing pytest            | `(cd apps/data-processing && pytest)`                                                                   |
| Onchain all tests                 | `(cd apps/onchain && cargo test)`                                                                       |
| Onchain single crate tests        | `(cd apps/onchain && cargo test -p <crate>)`                                                            |
