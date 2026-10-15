# Architecture Decision Records

This directory records the major architectural and operational decisions that shape the LumenPulse platform. ADRs capture the context, the trade-offs we considered, the decision we made, and the consequences of that decision so future contributors do not have to rediscover the same debate during review.

## Purpose

ADR records are the canonical place for the rationale behind design choices that affect:

- service boundaries and runtime topology
- database or eventing patterns
- monorepo and workspace structure
- contract state layout and upgradeability
- operational resilience and retry semantics
- cross-language or cross-service integration

## Numbering

- ADRs use a monotonically increasing numeric sequence: `ADR-0001`, `ADR-0002`, `ADR-0003`, and so on.
- The number is assigned when the ADR is created and must not be reused.
- The next ADR should always use the next unassigned number.

## Status lifecycle

ADR status follows a simple lifecycle:

- `Proposed`: the decision is being discussed and has not yet been accepted.
- `Accepted`: the decision has been chosen and is now the working baseline.
- `Superseded`: a newer ADR replaced it.
- `Rejected`: the option was considered but deliberately not adopted.
- `Deprecated`: the decision remains in the repository for historical context, but the team no longer relies on it.

A decision may move from `Proposed` to `Accepted` after implementation and review. If a later ADR changes the direction, the older ADR should be marked `Superseded` or `Deprecated` and linked from the new record.

## Template

Each ADR should follow this structure:

```md
# ADR-000N: <Title>

- Status: Accepted
- Date: YYYY-MM-DD

## Context
Describe the problem, the background constraints, and the forces driving the decision.

## Options considered
List the alternatives, including the trade-offs and why they were not chosen.

## Decision
State the chosen approach in clear terms.

## Consequences
Describe the impact, the expected downsides, and the operational follow-through.

## Related implementation summaries
- [path/to/implementation-summary.md](path/to/implementation-summary.md)
```

## Current ADR index

1. [ADR-0001: Monorepo layout](./ADR-0001-monorepo-layout.md)
2. [ADR-0002: Transactional outbox for reliable side effects](./ADR-0002-transactional-outbox.md)
3. [ADR-0003: Separate Python service for analytics and inference](./ADR-0003-python-service-split.md)
4. [ADR-0004: Split Soroban state by domain and contract boundary](./ADR-0004-soroban-state-split.md)
5. [ADR-0005: Contract upgrade and timelock guardrail](./ADR-0005-contract-upgrade-timelock.md)
6. [ADR-0006: Dead-letter queue and replayable event handling](./ADR-0006-dead-letter-queue.md)
7. [ADR-0007: Idempotency guard — tests and adoption on `crowdfund_vault::deposit`](../../apps/onchain/doc/adr/ADR-0007-idempotency-guard.md)

## Related implementation summaries and feature write-ups

These summaries document what was built; the ADRs explain why the design was chosen. The two sets should be read together:

- [apps/backend/IMPLEMENTATION_SUMMARY.md](../../apps/backend/IMPLEMENTATION_SUMMARY.md)
- [apps/backend/IMPLEMENTATION_SUMMARY_CONTRACT_ROTATION.md](../../apps/backend/IMPLEMENTATION_SUMMARY_CONTRACT_ROTATION.md)
- [apps/backend/IMPLEMENTATION_SUMMARY_DEAD_LETTER_QUEUE.md](../../apps/backend/IMPLEMENTATION_SUMMARY_DEAD_LETTER_QUEUE.md)
- [apps/backend/FEATURE_CONTRACT_ROTATION.md](../../apps/backend/FEATURE_CONTRACT_ROTATION.md)
- [apps/onchain/IMPLEMENTATION_SUMMARY.md](../../apps/onchain/IMPLEMENTATION_SUMMARY.md)
- [CI_FIX_SUMMARY.md](../../CI_FIX_SUMMARY.md)

When a PR changes architectural assumptions or introduces a new operational mechanism, update the relevant ADR and add a cross-reference to the implementation summary that accompanies the change.
