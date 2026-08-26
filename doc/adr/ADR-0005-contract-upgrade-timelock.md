# ADR-0005: Contract upgrade and timelock guardrail

- Status: Accepted
- Date: 2026-08-25

## Context

Soroban contracts can be upgraded in place, which is powerful but also introduces governance and operational risk. Without a delay or approval mechanism, an admin can replace logic immediately, making mistakes difficult to contain and leaving no safety window for review or rollback.

The platform therefore needs a way to rotate contract IDs, upgrade implementation logic, or change admin responsibilities while keeping a minimum delay and an explicit queue of pending operations.

## Options considered

1. Direct upgrade without a timelock.
   - Pros: simple operational flow and minimal ceremony.
   - Cons: high risk of mistakes, poor auditability, and no time for human review or emergency response.

2. Governance-only upgrade behind a full on-chain vote system.
   - Pros: highly transparent and decentralized.
   - Cons: too heavy for the platform's immediate operational model and slower to react to real operational change.

3. Timelocked queue with explicit execution and grace-period controls.
   - Pros: provides review time, enforcement of admin boundaries, and better security posture without requiring full governance infrastructure.
   - Cons: adds operational complexity and a small amount of lag before changes take effect.

## Decision

We adopt a timelock-based upgrade pattern: contract operations are queued, validated, and only executed after a configured delay. The admin may propose or queue actions, but execution remains gated by delay and status checks so a mistaken change has a window for detection and intervention.

The implementation aligns with a clear separation between proposing an action and executing it, which is essential for upgrade safety and operational review.

## Consequences

- Contract upgrades and admin changes become reviewable and less likely to be accidental.
- There is an intentional delay before some privileged actions take effect, which can slow emergency changes.
- The system requires careful audit records for queued operations and execution history.
- Contributors and operators must understand that admin privileges remain powerful even with timelock controls.

## Related implementation summaries

- [apps/backend/IMPLEMENTATION_SUMMARY_CONTRACT_ROTATION.md](../../apps/backend/IMPLEMENTATION_SUMMARY_CONTRACT_ROTATION.md)
- [apps/backend/FEATURE_CONTRACT_ROTATION.md](../../apps/backend/FEATURE_CONTRACT_ROTATION.md)
- [document/SMART_CONTRACTS.md](../../document/SMART_CONTRACTS.md)
