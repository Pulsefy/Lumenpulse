# LumenPulse Testnet Operations Runbook

## Purpose

This runbook defines the release-readiness, deployment verification, smoke-check, rollback, escalation, and routine-maintenance procedures for the LumenPulse testnet stack.

It covers the monorepo's:

* Backend API
* Web application
* Mobile application
* Data-processing service
* Soroban/Stellar contracts

The runbook is intended for contributors and reviewers preparing a testnet release or diagnosing a failed deployment.

This document describes the repository's current operational interfaces. It does not assume that a service has a deployment platform or rollback mechanism that is not documented in the repository.

---

## 1. Stack and Operational Boundaries

The LumenPulse repository is a monorepo containing independent application and contract components.

| Component       | Location               | Primary runtime     | Operational responsibility                                                                 |
| --------------- | ---------------------- | ------------------- | ------------------------------------------------------------------------------------------ |
| Backend         | `apps/backend`         | Node.js / NestJS    | API, database access, Redis-backed workloads, Stellar/Horizon integration                  |
| Webapp          | `apps/webapp`          | Next.js             | Browser UI and client-facing API integration                                               |
| Mobile          | `apps/mobile`          | Expo / React Native | Mobile client, wallet and API integration                                                  |
| Data processing | `apps/data-processing` | Python              | News ingestion, sentiment, market analysis, anomaly detection, scheduled processing        |
| Contracts       | `apps/onchain`         | Rust / Soroban      | On-chain project, contributor, treasury, token, funding and related protocol functionality |

The testnet contract deployment set is represented by:

`apps/onchain/testnet-manifest.json`

The backend can seed and read this manifest through its deployment-manifest service.

---

# 2. Release Readiness Gate

A testnet release should not be considered ready until all applicable gates below pass.

## Required gates

* [ ] Git working tree contains only intended release changes.
* [ ] Backend CI passes.
* [ ] Data-processing CI passes.
* [ ] Mobile CI passes.
* [ ] On-chain CI passes.
* [ ] Webapp tests and build pass.
* [ ] Backend migration checks pass.
* [ ] Testnet contract manifest validates.
* [ ] Backend health checks pass against testnet dependencies.
* [ ] Contract health check passes.
* [ ] Backend deployment smoke check passes.
* [ ] Webapp can reach the configured backend.
* [ ] Mobile client points to the intended testnet API and Stellar configuration.
* [ ] Data-processing service can reach its configured external dependencies.
* [ ] No release-blocking alerts are active.
* [ ] Rollback target is known before deployment.

If any release-blocking gate fails, stop the release and investigate before promoting the affected component.

---

# 3. Pre-Deployment Checks

## 3.1 Repository and branch checks

From the repository root:

```powershell
git status
git branch --show-current
git log -1 --oneline
```

Confirm:

1. The intended branch is checked out.
2. The working tree does not contain accidental changes.
3. The commit being released is the commit that was reviewed.
4. CI corresponds to the same commit.

For a release candidate, record the commit SHA:

```powershell
git rev-parse HEAD
```

Use that SHA when comparing deployments, failures, and rollback candidates.

---

# 4. Backend Operations

## 4.1 Backend CI gate

The backend workflow is:

```text
.github/workflows/backend.yml
```

It runs:

* dependency installation with `npm ci`
* ESLint
* optional TypeScript type checking
* Jest tests
* NestJS build
* migration safety checks
* migration verification against a clean PostgreSQL database

Run the equivalent local checks:

```powershell
cd apps/backend

npm ci
npm run lint
npm run test
npm run build
npm run migration:check
```

For migration verification:

```powershell
npm run migration:verify
```

Do not treat a successful application build as sufficient if database migrations are part of the release.

---

## 4.2 Backend startup check

Start the backend using:

```powershell
cd apps/backend
npm run start:dev
```

The application exposes Swagger documentation at:

```text
/api/docs
```

The configured production Swagger server is:

```text
https://api.lumenpulse.io
```

Do not assume this hostname is currently reachable unless the deployment environment confirms it.

---

## 4.3 Backend health checks

The backend provides several operational endpoints.

### General health

```text
GET /health
```

Expected behavior:

* HTTP `200` when the service is healthy or degraded but available.
* HTTP `503` when a critical health condition is reported.

### Liveness

```text
GET /health/live
```

### Readiness

```text
GET /health/ready
```

Readiness should be treated as the deployment gate because it explicitly reports the service as unavailable while graceful shutdown is in progress.

### Contract health

```text
GET /health/contracts
```

This checks configured Stellar contract reachability and readiness.

### Dependency latency

```text
GET /health/latency
```

This reports Horizon and Soroban RPC latency-budget state.

### Deployment smoke check

```text
GET /health/smoke
```

This is the preferred backend release smoke check.

The endpoint verifies:

* required environment variables
* database availability
* Redis availability
* Horizon availability
* configured Soroban contract reachability

The response contains a machine-readable status:

```text
pass
warn
fail
```

The deployment should not be considered ready when the smoke response reports `ready: false`.

Example:

```powershell
Invoke-RestMethod https://<testnet-backend-host>/health/smoke
```

If the endpoint returns HTTP `503`, stop the release and inspect the failing check IDs before continuing.

---

# 5. Backend Failure Signals and Escalation

Treat the following as release blockers:

| Signal                                                 | Severity | Action                                        |
| ------------------------------------------------------ | -------- | --------------------------------------------- |
| `/health/smoke` returns `fail`                         | Critical | Stop release                                  |
| `/health/ready` returns `503` after deployment settles | Critical | Stop traffic/promotion and investigate        |
| `/health/contracts` returns `503`                      | Critical | Verify testnet manifest, contract IDs and RPC |
| Database migration fails                               | Critical | Do not continue deployment                    |
| Redis unavailable for required workloads               | High     | Investigate before promotion                  |
| Horizon unavailable                                    | High     | Investigate Stellar dependency                |
| Soroban RPC unavailable                                | High     | Investigate RPC dependency                    |
| `/health/latency` reports `hard_down`                  | High     | Do not promote                                |
| API responds but contract calls fail                   | Critical | Treat as partial deployment failure           |

When escalating, capture:

```text
release commit SHA
affected service
deployment timestamp
endpoint/check that failed
HTTP status
response body
relevant application logs
dependency status
last known-good commit/deployment
```

Do not paste secrets, wallet secrets, API keys, JWT secrets, or private credentials into issues or chat.

---

# 6. Webapp Operations

The web application is located at:

```text
apps/webapp
```

It is a Next.js application.

## 6.1 Pre-deployment validation

Run:

```powershell
cd apps/webapp

npm install
npm run check:api-types
npm test
npm run build
```

The API type check is important because the webapp consumes generated types derived from the backend OpenAPI contract.

Run:

```powershell
npm run generate:api-types
```

only when regeneration is intentionally required.

The generated API artifacts should not be manually edited.

---

## 6.2 Environment validation

The webapp uses:

```text
BACKEND_API_URL
NEXT_PUBLIC_API_URL
NEXT_PUBLIC_STELLAR_EXPLORER_URL
```

Before a testnet deployment, verify that:

* server-side API calls target the intended testnet backend;
* browser-side API calls target the intended testnet backend;
* Stellar explorer links point to the intended environment;
* no production/mainnet endpoint is accidentally configured.

The webapp configuration is centralized in:

```text
apps/webapp/lib/config.ts
```

---

## 6.3 Webapp smoke check

After deployment:

1. Open the deployed webapp.
2. Confirm the application loads without a server error.
3. Confirm the browser can reach the backend.
4. Verify a representative API-backed page.
5. Verify wallet connection using a testnet wallet.
6. Verify that the application identifies the expected testnet environment.
7. Verify that transaction/contract links resolve to the expected Stellar testnet explorer.
8. Check the browser console for unexpected API, wallet, or hydration failures.

A frontend page loading successfully is not sufficient if API calls are failing.

---

# 7. Webapp Failure and Rollback Signals

Rollback or stop promotion when:

* the application cannot load;
* the application points at the wrong backend;
* authentication fails for all test users;
* API requests consistently return `5xx`;
* wallet connection targets the wrong network;
* testnet contract calls fail consistently;
* a release introduces unrecoverable client-side errors;
* generated API types no longer match the backend contract.

For a frontend-only regression, restore the previous known-good web deployment rather than changing backend or contract state unnecessarily.

If the frontend failure is caused by an API contract change, coordinate the frontend rollback with the backend deployment owner.

---

# 8. Mobile Operations

The mobile application is located at:

```text
apps/mobile
```

It uses Expo and React Native.

## 8.1 CI checks

The repository has mobile workflows under:

```text
.github/workflows/mobile.yml
.github/workflows/mobile-ci.yml
```

The primary mobile workflow runs:

```powershell
cd apps/mobile

npm ci
npm run tsc -- --noEmit
npm run test:coverage
```

The mobile CI configuration should be reviewed carefully when validating release readiness because the repository contains two mobile workflows with different behavior.

---

## 8.2 Environment validation

Testnet configuration is represented by variables including:

```text
EXPO_PUBLIC_API_URL
EXPO_PUBLIC_TESTNET_API_URL
EXPO_PUBLIC_STELLAR_NETWORK
EXPO_PUBLIC_SOROBAN_RPC_URL
EXPO_PUBLIC_TESTNET_SOROBAN_RPC_URL
EXPO_PUBLIC_TESTNET_CROWDFUND_CONTRACT_ID
EXPO_PUBLIC_STELLAR_EXPLORER_URL
```

Before a testnet build, verify:

* `EXPO_PUBLIC_STELLAR_NETWORK=testnet`
* testnet API URL points to the testnet backend;
* Soroban RPC points to Stellar testnet;
* testnet contract IDs are correct;
* mainnet variables are not accidentally selected.

---

## 8.3 Mobile smoke check

Perform the following on a test device or emulator:

1. Launch the application.
2. Confirm the initial screen loads.
3. Confirm API connectivity.
4. Load the news feed.
5. Load portfolio or another API-backed feature.
6. Test authentication/session restoration where applicable.
7. Connect a testnet wallet using the supported wallet flow.
8. Confirm the application remains on testnet.
9. Exercise one representative transaction or contract-backed flow when available.
10. Confirm failures are presented without leaving the application in a corrupted state.

The mobile README specifies that production builds use the SEP-0007 wallet adapter and that development builds may use a mock adapter when the SEP-0007 wallet is unavailable.

Do not interpret a mock transaction as evidence that a real testnet transaction succeeded.

---

# 9. Data-Processing Operations

The data-processing service is located at:

```text
apps/data-processing
```

It is a Python 3.9+ service responsible for compute-heavy processing including sentiment analysis, market analysis, ingestion, anomaly detection and scheduled jobs.

## 9.1 CI checks

The workflow is:

```text
.github/workflows/data-processing.yml
```

Run locally:

```powershell
cd apps/data-processing

python -m pip install --upgrade pip
pip install flake8 pytest
pip install -r requirements.txt

flake8 . --count --select=E9,F63,F7,F82 --show-source --statistics
pytest
```

---

## 9.2 Single pipeline smoke check

The service supports a single pipeline execution:

```powershell
python src/main.py run
```

A successful run should complete the pipeline stages without an exception.

The pipeline processes:

1. news;
2. price feeds;
3. sentiment;
4. Stellar on-chain data;
5. market analysis;
6. anomaly detection;
7. ingestion alerting.

A successful process exit alone should not be considered sufficient if the output reports unavailable or invalid upstream data.

---

## 9.3 Scheduled-service check

The scheduled service can be started with:

```powershell
python src/main.py serve
```

The service starts background scheduled processing and exposes worker metrics on port `9091`.

The `RUN_IMMEDIATELY` environment variable can be used to trigger an immediate run when the service starts:

```text
RUN_IMMEDIATELY=true
```

Use this intentionally during validation; do not enable it merely to compensate for an unknown scheduler state.

---

## 9.4 Data-processing API

The FastAPI service can be started with:

```powershell
python -m uvicorn src.api.server:app --host 0.0.0.0 --port 8000 --reload
```

When running, inspect:

```text
/docs
```

for the generated OpenAPI/Swagger interface.

The service also documents security requirements for its API, including API-key protection and rate limiting.

---

## 9.5 Data-processing smoke signals

Investigate immediately when:

* the pipeline exits with `success: false`;
* upstream news/price/Horizon fetches fail repeatedly;
* validation drops unexpected volumes of records;
* database persistence fails;
* scheduled jobs stop executing;
* anomaly detection produces unexplained persistent failures;
* API authentication or rate limiting behaves differently from the documented configuration.

Review:

```text
logs/data_processor.log
```

and the service's metrics when diagnosing repeated failures.

---

# 10. Soroban Contract Operations

Contracts live under:

```text
apps/onchain
```

The workspace contains multiple Soroban contracts.

The active workspace is defined in:

```text
apps/onchain/Cargo.toml
```

## 10.1 Contract CI gate

The on-chain workflow is:

```text
.github/workflows/onchain.yml
```

Run:

```powershell
cd apps/onchain

cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo build --target wasm32-unknown-unknown --release
cargo test
```

A release should not proceed when formatting, Clippy, build, or tests fail.

---

# 11. Testnet Contract Manifest

The authoritative repository testnet deployment metadata is:

```text
apps/onchain/testnet-manifest.json
```

Validate it with:

```powershell
cd apps/onchain
node scripts/validate-manifest.js
```

The validator requires every expected contract to have either:

1. valid deployment metadata containing a Soroban contract ID and WASM hash; or
2. a non-empty `reason` explaining why the contract is intentionally not deployed.

The manifest currently identifies the Stellar testnet RPC as:

```text
https://soroban-testnet.stellar.org:443
```

Do not replace contract IDs or WASM hashes in the manifest merely to make a smoke check pass.

If a deployed contract's ID or WASM hash changes, update the manifest only after verifying the actual deployment.

---

# 12. Contract Deployment Verification

Before deploying a contract:

```powershell
cd apps/onchain
cargo build --target wasm32-unknown-unknown --release
cargo test
```

After deployment:

1. Record the deployed contract ID.
2. Record the resulting WASM hash.
3. Verify the deployment against Stellar testnet.
4. Update the testnet manifest when the deployment is intentionally part of the release.
5. Run:

```powershell
node scripts/validate-manifest.js
```

6. Verify backend contract health:

```text
GET /health/contracts
```

7. Run the backend deployment smoke endpoint:

```text
GET /health/smoke
```

A contract deployment is not release-ready until the backend can resolve and reach the configured contract.

---

# 13. Contract Rollback Signals

Smart contracts require a different rollback strategy from web and backend services.

Do not assume that deploying an older WASM binary automatically restores the previous on-chain state.

For the current public testnet configuration:

* deployed contracts are represented by contract IDs and WASM hashes in the testnet manifest;
* several contracts are intentionally not deployed;
* upgradeability is explicitly disabled for the current public deployment according to the manifest.

If a contract release is faulty:

1. Stop further promotion.
2. Stop frontend/mobile flows that invoke the affected contract.
3. Preserve the failing contract ID and transaction/error information.
4. Identify the last known-good deployment metadata.
5. Determine whether the affected contract supports an approved upgrade path.
6. If no safe upgrade path exists, do not attempt an ad-hoc state reset.
7. Coordinate any replacement deployment and consumer configuration change.
8. Update the deployment manifest only after the replacement deployment has been verified.
9. Re-run backend contract health and smoke checks.

For on-chain incidents, preserve transaction hashes and ledger information before attempting remediation.

---

# 14. Full-Stack Smoke Test

After all components are deployed, perform the following sequence.

## Step 1 — Backend

```text
GET /health
GET /health/ready
GET /health/contracts
GET /health/latency
GET /health/smoke
```

All critical checks must be healthy.

## Step 2 — Webapp

Verify:

* page load;
* API connectivity;
* authentication;
* news data;
* portfolio data;
* wallet connection;
* testnet contract interaction.

## Step 3 — Mobile

Verify:

* application startup;
* API connectivity;
* authentication/session;
* representative data flow;
* testnet wallet connection;
* representative transaction/contract flow.

## Step 4 — Data processing

Run:

```powershell
cd apps/data-processing
python src/main.py run
```

Confirm that the pipeline completes successfully and that no critical upstream source is unavailable.

## Step 5 — Contracts

Run:

```powershell
cd apps/onchain
node scripts/validate-manifest.js
cargo test
```

Then confirm:

```text
GET /health/contracts
```

reports the configured contracts as reachable.

---

# 15. Release Failure Classification

Use the following classification when a smoke test fails.

### Class A — Client-only failure

Examples:

* webapp rendering failure;
* mobile UI regression;
* incorrect frontend environment variable.

Action:

* rollback the affected client;
* leave backend and contracts unchanged unless dependency compatibility is also affected.

### Class B — Backend failure

Examples:

* `/health/ready` returns `503`;
* database connection failure;
* Redis failure;
* API contract regression.

Action:

* stop promotion;
* inspect application and dependency logs;
* rollback backend if the previous release is known good.

### Class C — Data-processing failure

Examples:

* pipeline cannot fetch required sources;
* persistence failure;
* scheduled worker failure.

Action:

* stop relying on new analytics output;
* investigate upstream dependency and worker logs;
* avoid deleting persisted data while diagnosing.

### Class D — Contract failure

Examples:

* contract ID cannot be reached;
* incorrect WASM hash;
* contract invocation fails;
* backend contract health fails.

Action:

* stop contract-dependent promotion;
* preserve transaction and ledger evidence;
* do not perform an improvised on-chain rollback.

### Class E — Cross-stack failure

Examples:

* backend points to a different contract version than the frontend;
* API response shape differs from generated frontend types;
* mobile and webapp use different testnet endpoints;
* contract manifest and backend deployment metadata disagree.

Action:

* stop the release;
* identify the first incompatible boundary;
* restore a consistent last-known-good combination of components.

---

# 16. Rollback Procedure

## 16.1 General rollback

When a release is confirmed faulty:

1. Stop additional deployments.
2. Record the failing commit SHA.
3. Record the first observed failure time.
4. Identify the last known-good release.
5. Determine which layer introduced the failure.
6. Roll back the smallest affected layer.
7. Re-run the full-stack smoke test.
8. Confirm that dependent services use compatible versions.
9. Document the incident and follow-up work.

---

## 16.2 Database rollback caution

Database migrations require special care.

Before applying a migration:

```powershell
cd apps/backend
npm run migration:check
```

The CI pipeline also verifies migrations against a clean PostgreSQL database.

Do not automatically run:

```powershell
npm run migration:revert
```

during an incident.

First determine whether the migration has already changed persistent production/testnet data and whether the application version being restored is compatible with the existing schema.

A binary/application rollback does not necessarily imply a database rollback.

---

## 16.3 Data-processing rollback

For data-processing changes:

1. Stop the affected worker if it is producing invalid data.
2. Preserve logs and failed records where possible.
3. Restore the last known-good application version.
4. Verify database connectivity.
5. Run a single pipeline execution.
6. Confirm that the resulting output is valid before restarting scheduled processing.

---

## 16.4 Web/mobile rollback

Restore the last known-good client build/deployment.

After rollback verify:

* API endpoint configuration;
* authentication;
* wallet network;
* contract IDs;
* representative user flow.

---

## 16.5 Contract rollback

Do not treat contract rollback like application rollback.

For a contract incident:

* stop invoking the affected contract;
* preserve transaction evidence;
* identify the deployed contract and WASM hash;
* determine whether an approved upgrade mechanism exists;
* use a replacement deployment only when the recovery path has been reviewed;
* update consumers and the deployment manifest together.

---

# 17. Routine Maintenance

## Daily / per release

* Check backend readiness and smoke endpoints.
* Check contract reachability.
* Review recent deployment logs.
* Review data-processing pipeline results.
* Confirm testnet environment configuration.
* Check for stale generated API types.
* Verify the active contract manifest.

## Weekly

* Review failed CI runs.
* Review recurring data-processing failures.
* Review dependency/API failures.
* Check contract WASM-size changes in PRs.
* Review testnet contract metadata.
* Review mobile and webapp environment configuration.
* Check for stale or undocumented operational procedures.

## Before every release

* Run all affected CI workflows.
* Run the relevant local tests.
* Validate the contract manifest.
* Record the release commit SHA.
* Identify the last known-good release.
* Perform the full-stack smoke test.
* Confirm rollback ownership and procedure.

---

# 18. Operational Evidence to Capture

For every failed release or incident, preserve:

```text
Repository:
Commit SHA:
Branch:
Component:
Deployment time:
Environment:
Last known-good release:

Backend:
Health status:
Readiness status:
Contract health:
Smoke status:
Latency status:

Webapp:
URL:
Observed failure:
Browser console errors:

Mobile:
Build/version:
Device:
Observed failure:

Data processing:
Pipeline result:
Relevant logs:
Upstream source failures:

Contracts:
Contract ID:
WASM hash:
Transaction hash:
Ledger:
RPC response/error:

Resolution:
Rollback/recovery action:
Verification result:
Follow-up issue:
```

Never include private keys, wallet secrets, API tokens, JWT secrets, database passwords, or other credentials in incident records.

---

# 19. Release Readiness Checklist

Use this checklist in the release PR.

### Repository

* [ ] Correct commit selected.
* [ ] Working tree clean.
* [ ] CI checks correspond to release commit.

### Backend

* [ ] Lint passes.
* [ ] Tests pass.
* [ ] Build passes.
* [ ] Migration checks pass.
* [ ] `/health/ready` passes.
* [ ] `/health/contracts` passes.
* [ ] `/health/smoke` reports ready.
* [ ] No critical dependency failures.

### Webapp

* [ ] API type check passes.
* [ ] Tests pass.
* [ ] Production build passes.
* [ ] Correct testnet backend configured.
* [ ] Wallet flow verified.
* [ ] Representative API-backed flow verified.

### Mobile

* [ ] Type check passes.
* [ ] Unit tests and coverage pass.
* [ ] Correct testnet API configured.
* [ ] Testnet Stellar configuration verified.
* [ ] Wallet flow verified.
* [ ] Representative API/contract flow verified.

### Data processing

* [ ] Python tests pass.
* [ ] Static checks pass.
* [ ] Single pipeline run succeeds.
* [ ] Required external sources respond.
* [ ] Persistence succeeds.
* [ ] Scheduled service starts successfully when applicable.

### Contracts

* [ ] `cargo fmt --check` passes.
* [ ] Clippy passes.
* [ ] WASM build passes.
* [ ] Contract tests pass.
* [ ] Testnet manifest validates.
* [ ] Deployed contract IDs are verified.
* [ ] WASM hashes are verified.
* [ ] Backend contract health passes.

### Operations

* [ ] Full-stack smoke test passes.
* [ ] Last known-good release identified.
* [ ] Rollback path understood.
* [ ] No unresolved release-blocking incident exists.
* [ ] Operational evidence is available for the release.

---

# 20. Related Repository Documentation

Use these documents for deeper component-specific procedures:

* [`document/LOCAL_SETUP.md`](../document/LOCAL_SETUP.md) — complete local environment setup.
* [`document/MOBILE_GUIDE.md`](../document/MOBILE_GUIDE.md) — mobile-specific development guidance.
* [`document/SMART_CONTRACTS.md`](../document/SMART_CONTRACTS.md) — smart-contract documentation.
* [`document/ETL_RUNBOOK.md`](../document/ETL_RUNBOOK.md) — data/ETL operational procedures.
* [`document/BUG_TRIAGE_GUIDE.md`](../document/BUG_TRIAGE_GUIDE.md) — bug investigation and triage.
* [`document/INCIDENT_POSTMORTEM_WORKFLOW.md`](../document/INCIDENT_POSTMORTEM_WORKFLOW.md) — incident follow-up.
* [`doc/testing-strategy.md`](testing-strategy.md) — repository testing strategy.
* [`doc/threat-model.md`](threat-model.md) — security/threat-model context.
* [`doc/adr/README.md`](adr/README.md) — architecture decisions.

---

## Maintenance Rule

Update this runbook whenever an operational interface changes, including:

* deployment commands;
* health endpoints;
* CI release gates;
* environment variables;
* contract deployment procedures;
* rollback mechanisms;
* smoke-test requirements;
* service ownership boundaries.

A release procedure that exists only in contributor memory is not considered documented.
