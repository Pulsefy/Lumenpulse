# LumenPulse Documentation Index

All project documentation lives in this directory. Use this index to navigate by topic.

---

## Core & Project Guides

| File | Description |
|---|---|
| [LOCAL_SETUP.md](LOCAL_SETUP.md) | Step-by-step guide to running the complete LumenPulse stack locally: wallet setup, Soroban tooling, environment variables, seeded data, and service startup order. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture overview: service boundaries, data flow diagrams, and dependency relationships across the monorepo. |
| [testing-strategy.md](testing-strategy.md) | Expected test types, minimum coverage bars, and run commands for every application and library in the monorepo. |
| [api-integration-guide.md](api-integration-guide.md) | Narrative reference for backend API integration: authentication, environments, pagination, standard errors, rate limits, and endpoint stability tiers. |
| [error-codes.md](error-codes.md) | Comprehensive API error code reference: numeric codes, HTTP mappings, suggested client handling, and troubleshooting hints. |
| [MOBILE_GUIDE.md](MOBILE_GUIDE.md) | Mobile application development guide: project structure, environment setup, build commands, and common workflows. |

## Contributing & Workflow

| File | Description |
|---|---|
| [contributor-pr-review-guide.md](contributor-pr-review-guide.md) | Standards for fast, consistent, and high-quality pull request reviews: triage process, linked-issue checks, scope validation, and review philosophy. |
| [review-playbook.md](review-playbook.md) | Detailed PR review playbook with per-area checklists: backend, smart contracts, data processing, mobile, and documentation. |
| [backend-contributing.md](backend-contributing.md) | Backend (NestJS) contributing standards: coding conventions, testing requirements, and PR submission checklist. |
| [contracts-contributing.md](contracts-contributing.md) | Smart contracts (Rust/Soroban) contributing standards: storage patterns, events/errors, testing, and upgrade compatibility checks. |
| [mobile-contributing.md](mobile-contributing.md) | Mobile (React Native/Expo) contributing standards: component patterns, state management, testing, and release preparation. |
| [BUG_TRIAGE_GUIDE.md](BUG_TRIAGE_GUIDE.md) | Bug triage process: severity definitions, reproduction requirements, assignment flow, and resolution SLA expectations. |
| [INCIDENT_POSTMORTEM_WORKFLOW.md](INCIDENT_POSTMORTEM_WORKFLOW.md) | Incident postmortem workflow: required timing, assignee responsibilities, and follow-up task tracking. |
| [POSTMORTEM_TEMPLATE.md](POSTMORTEM_TEMPLATE.md) | Reusable template for incident postmortems: standardized sections for summary, timeline, root cause, and action items. Place new postmortems under `docs/postmortems/`. |

## Security

| File | Description |
|---|---|
| [threat-model.md](threat-model.md) | LumenPulse threat model v1.0: assets, actors, system architecture and trust boundaries, threat analysis, key handling, accepted risks, and vulnerability reporting. |

## AI / ML Pipeline

| File | Description |
|---|---|
| [ai-model-lifecycle.md](ai-model-lifecycle.md) | Complete lifecycle of AI models in the system: data selection, training, registration, evaluation, promotion, serving, and rollback. Covers `sentiment` and `price_predictor` model types. |
| [model-card-schema.md](model-card-schema.md) | Machine-readable metadata schema for model cards saved alongside model artifacts: training data info, hyperparameters, evaluation metrics, feature schema, and provenance. |
| [SENTIMENT_BENCHMARK_REPORT.md](SENTIMENT_BENCHMARK_REPORT.md) | Sentiment analysis model benchmark report: accuracy metrics, dataset details, and comparison against baselines. |
| [FEATURE_FLAGS.md](FEATURE_FLAGS.md) | Onchain feature flag system (Soroban): flag definitions, gating behavior, testnet vs mainnet usage, and administration procedures. |

## API & Integration Documentation

| File | Description |
|---|---|
| [api-documentation-guide.md](api-documentation-guide.md) | User-facing API documentation guide: authentication flows, complete endpoint reference, and example request/response patterns. |
| [swagger-quick-reference.md](swagger-quick-reference.md) | Quick reference for the Swagger/OpenAPI setup: UI endpoints, decorator usage, and common annotation patterns. |
| [swagger-implementation-guide.md](swagger-implementation-guide.md) | Implementation guide for Swagger annotations: controller, DTO, and error response decorating conventions. |
| [swagger-documentation-summary.md](swagger-documentation-summary.md) | Summary of Swagger documentation coverage, completion status, and optional enhancement roadmap. |

## Operations & Runbooks

| File | Description |
|---|---|
| [ETL_RUNBOOK.md](ETL_RUNBOOK.md) | ETL pipeline operations runbook: extraction, transformation, and loading steps with failure recovery procedures. |
| [RECONCILIATION_ALERTING_RUNBOOK.md](RECONCILIATION_ALERTING_RUNBOOK.md) | Reconciliation drift alerting runbook: warning and critical alert responses, investigation steps, and remediation commands. Referenced by Prometheus alert rules. |
| [DATA_PROCESSING_CONFIG_MIGRATION.md](DATA_PROCESSING_CONFIG_MIGRATION.md) | Data processing config migration guide: versioned config changes, rollback procedures, and validation checks. |

## Smart Contracts & Blockchain

| File | Description |
|---|---|
| [SMART_CONTRACTS.md](SMART_CONTRACTS.md) | LumenPulse smart contract reference: interface definitions, storage layout, events, and cross-contract interaction patterns. |
| [STELLAR_MIGRATION_NOTES.md](STELLAR_MIGRATION_NOTES.md) | Stellar/Soroban architecture migration notes: changes from prior chain assumptions, completed migrations, legacy cleanup, and contributor guidance. |

## Mobile Specific

| File | Description |
|---|---|
| [mobile-a11y-checks.md](mobile-a11y-checks.md) | Mobile accessibility checklist: screen reader support, color contrast, touch targets, and platform-specific a11y APIs. |
| [QA_DEEP_LINKING.md](QA_DEEP_LINKING.md) | Mobile deep linking QA guide: supported route patterns, custom scheme configuration, test cases, and production deployment prerequisites. |
| [moderation-events.md](moderation-events.md) | Moderation events documentation: event schemas, consumer integration guide, and public/private payload separation. |

## Architecture Decision Records

Rationale behind major architectural and operational choices. Each ADR records context, options considered, the decision, and consequences.

| File | Description |
|---|---|
| [adr/README.md](adr/README.md) | ADR index, numbering convention, status lifecycle, and authoring template. |
| [adr/ADR-0001-monorepo-layout.md](adr/ADR-0001-monorepo-layout.md) | Monorepo workspace layout and structure. |
| [adr/ADR-0002-transactional-outbox.md](adr/ADR-0002-transactional-outbox.md) | Transactional outbox pattern for reliable side effects and at-least-once delivery. |
| [adr/ADR-0003-python-service-split.md](adr/ADR-0003-python-service-split.md) | Separate Python data-processing service for analytics, ML inference, and aggregation. |
| [adr/ADR-0004-soroban-state-split.md](adr/ADR-0004-soroban-state-split.md) | Splitting Soroban contract state by domain and contract boundary. |
| [adr/ADR-0005-contract-upgrade-timelock.md](adr/ADR-0005-contract-upgrade-timelock.md) | Contract upgrade timelock and guardrail mechanism. |
| [adr/ADR-0006-dead-letter-queue.md](adr/ADR-0006-dead-letter-queue.md) | Dead-letter queue and replayable event handling for operational resilience. |
