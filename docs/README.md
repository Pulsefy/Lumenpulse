# LumenPulse Documentation Index

`docs/` holds everything a contributor or operator needs. This file is the entry
point: it lists **every** document, says in one line what each one answers, and
groups them by who you are rather than by when they were written.

Looking for the deployment playbook? Start under **Operator**. Deciding whether a
change belongs in a route handler or a server component? Start under
**Contributor**.

## How this index is organised

| Group | For | Start here |
| --- | --- | --- |
| [Start here](#start-here) | Everyone | [Local Setup](LOCAL_SETUP.md) |
| [Contributor](#contributor) | Changing the code | [Contributor PR Review Guide](contributor-pr-review-guide.md) |
| [Architecture](#architecture) | Understanding the system | [System Architecture](ARCHITECTURE.md) |
| [Operator](#operator) | Running it | [Deployment](DEPLOYMENT.md) |
| [Reference](#reference) | Looking something up | [Environment Variables](ENVIRONMENT_VARIABLES.md) |
| [Decisions](#decisions) | Why it is built this way | [ADRs](adr/README.md) |

## Start here

- [Local Development Setup](LOCAL_SETUP.md) — what to install and how to bring the whole stack up locally.
- [Local Stack](LOCAL_STACK.md) — which services run in which container, and how they talk to each other.
- [Backend Contribution Guide](backend-contributing.md) — setup, commands and standards for `apps/backend`.
- [Mobile Contribution Guide](mobile-contributing.md) — setup, commands and standards for `apps/mobile`.
- [Contracts Contribution Guide](contracts-contributing.md) — build, test and deploy rules for the Soroban contracts.
- [Webapp Contribution Guide](webapp-contributing.md) — setup, commands and standards for `apps/webapp`.

## Contributor

### Area guides

- [Backend Contribution Guide](backend-contributing.md) — NestJS module boundaries, DTO validation, migration coordination.
- [Webapp Contribution Guide](webapp-contributing.md) — server vs client components, data-fetching rules, generated API types.
- [Mobile Contribution Guide](mobile-contributing.md) — Expo workflow, styling and release conventions.
- [Contracts Contribution Guide](contracts-contributing.md) — Soroban contract layout, upgrade timelock and test gates.
- [Mobile Guide](MOBILE_GUIDE.md) — how the mobile app is structured and wired to Stellar wallets.

### Working practices

- [Contributor PR Review Guide](contributor-pr-review-guide.md) — what a reviewer checks before approving, and how to self-check first.
- [Testing Strategy](testing-strategy.md) — what layer of test belongs to which change.
- [Bug Triage Guide](BUG_TRIAGE_GUIDE.md) — how to label, prioritise and route an incoming bug.
- [Verification Review Workspace](verification-review-workspace.md) — the scratch area and procedure used to verify a change.
- [AI Model Lifecycle](ai-model-lifecycle.md) — how models are introduced, evaluated and retired.

### Continuous integration

- [CI Setup Action](ci-setup-action.md) — the reusable setup action and why it exists.
- [CI Concurrency Groups](ci-concurrency.md) — how duplicate runs on a PR are cancelled.
- [CI Path Filters](ci-path-filters.md) — which change triggers which job.
- [CI Run Time](ci-run-time.md) — measured runtimes per job, used to tune the above.
- [CI Job Timeouts](ci-timeouts.md) — timeout values and when to raise them.
- [Automated Dependency Updates](dependency-updates.md) — grouping and scheduling of automated PRs.

## Architecture

- [System Architecture](ARCHITECTURE.md) — service boundaries, how a request flows, and where state lives.
- [Authorization Matrix](AUTHORIZATION_MATRIX.md) — who may call what, per role and per surface.
- [Threat Model](threat-model.md) — trust boundaries and the threats considered for each.
- [Personal Data Policy](personal-data-policy.md) — what the data-processing service ingests and how it is classified.
- [Stellar/Soroban Migration Notes](STELLAR_MIGRATION_NOTES.md) — what changed when the platform moved to Stellar, and what contributors must assume now.
- [Smart Contract Interface Reference](SMART_CONTRACTS.md) — the contract entrypoints the rest of the system calls.
- [Decisions](adr/README.md) — architecture decision records; the *why* behind the structures above.
- [Feature #1041 — Multi-admin quorum execution](feature-1041-multisig-quorum.md) — the multisig proposal lifecycle for treasury and registry.

### Data and analytics

- [ETL & Data Pipeline Runbook](ETL_RUNBOOK.md) — how data reaches the analytics store, and what to do when a run fails.
- [Data-Processing Configuration Migration](DATA_PROCESSING_CONFIG_MIGRATION.md) — moving the Python service between configuration sources.
- [Experiment CLI](experiment-cli.md) — running and recording an experiment.
- [Model Card Schema](model-card-schema.md) — the required shape of a model card.
- [Sentiment Benchmark Report](SENTIMENT_BENCHMARK_REPORT.md) — VADER vs FinBERT results.
- [Moderation Decision Event Stream](moderation-events.md) — how moderation decisions are emitted.
- [API Documentation Guide](api-documentation-guide.md) — how to document an endpoint properly.

## Operator

### Shipping

- [Deployment](DEPLOYMENT.md) — the deploy path for each environment.
- [Staging and PR Previews](STAGING.md) — preview environments and how to use them.
- [Releasing](RELEASING.md) — release sequencing and tagging.
- [Feature Flags](FEATURE_FLAGS.md) — what flags exist, and the rules for introducing one.
- [Environment Variables](ENVIRONMENT_VARIABLES.md) — every variable, where it is read and what it defaults to.

### Running

- [Monitoring](MONITORING.md) — the dashboards and signals that are considered healthy.
- [Contract Deployment & Rollback Playbook](CONTRACT_DEPLOYMENT_ROLLBACK_PLAYBOOK.md) — deploying a contract and rolling it back.
- [Contract Upgrade Rehearsal](CONTRACT_UPGRADE_REHEARSAL.md) — rehearsing an upgrade before it reaches mainnet.
- [Soroban Event Indexer Replay & Backfill Runbook](SOROBAN_EVENT_REPLAY_RUNBOOK.md) — reprocessing a ledger range after an indexer fault.
- [Reconciliation Alerting Runbook](RECONCILIATION_ALERTING_RUNBOOK.md) — what a reconciliation alert means and how to clear it.
- [Testnet Operations Runbook](TESTNET_OPERATIONS_RUNBOOK.md) — day-to-day testnet operations.

### Incidents

- [Incident Postmortem Workflow](INCIDENT_POSTMORTEM_WORKFLOW.md) — how a postmortem is run and written.
- [Incident Postmortem Template](POSTMORTEM_TEMPLATE.md) — the template that workflow expects.
- [Emergency Pause Drill (Testnet)](EMERGENCY_PAUSE_DRILL.md) — rehearsing the pause path.
- [Mainnet Readiness](MAINNET_READINESS.md) — current readiness state and open blockers.
- [Contract Mainnet Readiness Checklist](MAINNET_READINESS_CHECKLIST.md) — the item-by-item checklist behind that state.

### Mobile releases

- [Mobile Release and OTA Process](MOBILE_RELEASE_AND_OTA.md) — store releases and over-the-air updates.

## Reference

- [Error Codes Reference](error-codes.md) — what each error code means and where it is raised.
- [Swagger Quick Reference Card](swagger-quick-reference.md) — one-page reminder for calling the API.
- [API Integration Guide](api-integration-guide.md) — authenticating and calling the API from a client.
- [Swagger Implementation Guide](swagger-implementation-guide.md) — how the OpenAPI document is built.
- [Swagger Documentation Summary](swagger-documentation-summary.md) — summary of the Swagger work.
- [Deep Linking QA Guide](QA_DEEP_LINKING.md) — testing deep links on mobile.
- [Mobile Accessibility Checks](mobile-a11y-checks.md) — the accessibility pass already performed on mobile.
- [Grant Round Lifecycle](grant-round-lifecycle.md) — the stages a grant round moves through.

## Decisions

Architecture decision records live in [`adr/`](adr/README.md) and have their own
index, numbering scheme and status lifecycle. That file explains what an ADR is
and how to write one; this index does not repeat it.

| ADR | Decision |
| --- | --- |
| [ADR-0001](adr/ADR-0001-monorepo-layout.md) | Monorepo layout |
| [ADR-0002](adr/ADR-0002-transactional-outbox.md) | Transactional outbox for reliable side effects |
| [ADR-0003](adr/ADR-0003-python-service-split.md) | Separate Python service for analytics and inference |
| [ADR-0004](adr/ADR-0004-soroban-state-split.md) | Split Soroban state by domain and contract boundary |
| [ADR-0005](adr/ADR-0005-contract-upgrade-timelock.md) | Contract upgrade and timelock guardrail |
| [ADR-0006](adr/ADR-0006-dead-letter-queue.md) | Dead-letter queue and replayable event handling |
| [ADR-0008](adr/ADR-0008-shared-data-processing-client.md) | Shared resilient data-processing client |
| [ADR-0009](adr/ADR-0009-stellar-source-sequence-lock.md) | Serialize backend submissions per Stellar source |

Non-markdown files in `docs/`:

- [`ci-baseline.json`](ci-baseline.json) — recorded CI run times, input to the
  [CI Run Time](ci-run-time.md) tuning.
- [`upgrade-rehearsal.evidence.example.json`](upgrade-rehearsal.evidence.example.json)
  — example evidence file for the [Contract Upgrade Rehearsal](CONTRACT_UPGRADE_REHEARSAL.md).

## Naming convention

The directory currently mixes three styles. This is the convention going forward:

| Kind | Convention | Example |
| --- | --- | --- |
| Durable reference or runbook | `SCREAMING_CASE.md` | `DEPLOYMENT.md` |
| Area guide, living document | `kebab-case.md` | `backend-contributing.md` |
| Architecture decision record | `adr/ADR-NNNN-kebab-case.md` | `adr/ADR-0002-transactional-outbox.md` |
| Open questions and backlog | `TODO.md` at the repository root, not here | — |

Two rules behind it:

1. **A filename's case tells you how to treat the file.** `SCREAMING_CASE` is the
   stable reference you cite in an incident; `kebab-case` is the guide you read
   once when you start working in that area.
2. **Durable references do not get renamed** to follow a new trend. Renaming
   `DEPLOYMENT.md` breaks every link and every runbook that cites it. New files
   follow the table above; existing ones are left alone unless they move.

### Known inconsistencies

Two documents do not follow the convention above. They are listed here rather than
renamed, because both are cited by existing runbooks:

- [`feature-1041-multisig-quorum.md`](feature-1041-multisig-quorum.md) is
  `kebab-case` but is a feature write-up rather than an area guide, and it has no
  `# ` title heading — it opens with `Feature: #1041 — …`.
- [`SENTIMENT_BENCHMARK_REPORT.md`](SENTIMENT_BENCHMARK_REPORT.md) is
  `SCREAMING_CASE` but is a point-in-time report, not a durable reference.

Renaming either is a separate, linkable change.

## Contributing a new document

1. Add it to the right group above, with a one-line description of what it
   answers — not what it contains.
2. Link to it from the document it relates to rather than repeating its content.
   If two documents start restating each other, one of them is in the wrong place.
3. If it records a decision rather than describing the current system, it is an
   ADR — see [`adr/README.md`](adr/README.md) instead of adding it here directly.
4. Link it from [`CONTRIBUTING.md`](../CONTRIBUTING.md) if a newcomer would need
   it on their first day.
