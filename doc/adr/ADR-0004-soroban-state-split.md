# ADR-0004: Split Soroban state by domain and contract boundary

- Status: Accepted
- Date: 2026-08-25

## Context

The on-chain platform contains multiple kinds of state: protocol configuration, user-facing asset flows, project and round management, and upgradeable governance or timelock logic. A single monolithic contract would quickly accumulate unrelated responsibilities and make upgrades, audits, and failure isolation harder.

The repository also contains examples of state that should not be flattened into a single storage model because different mission-critical concerns need different permissions, lifecycle assumptions, and upgrade cadence.

## Options considered

1. Keep a single large contract for all on-chain state.
   - Pros: simpler initial setup and fewer cross-contract calls.
   - Cons: coupling between unrelated domains, harder upgrade risk, weaker access boundaries, and more difficult auditing.

2. Split by lifecycle or business domain with explicit contracts for registry, vault, token, and protocol state.
   - Pros: each contract owns a narrower state model, upgrade boundaries are clearer, and the system becomes easier to reason about.
   - Cons: requires careful coordination between contracts and more initial design complexity.

3. Use a hybrid model with some shared registry state and a few domain-specific contracts.
   - Pros: balances flexibility with maintainability.
   - Cons: can drift into unclear ownership if the boundaries are not explicit.

## Decision

We model the on-chain system as a set of contract modules that own separate state domains, with registry and configuration data kept distinct from operational logic. The contract layer is designed around explicit domain responsibilities rather than a monolithic storage layout.

This preserves upgrade boundaries and makes it easier to reason about which contract owns which state and which admin or governance flows may modify it.

## Consequences

- State ownership is more explicit, which improves contract safety and auditability.
- Cross-contract integration is required for business flows, increasing coordination work.
- Upgrades become more predictable because each contract does not share unrelated state.
- Some operations require multiple contracts to be updated together, which means feature changes must consider the full contract boundary map.

## Related implementation summaries

- [apps/onchain/IMPLEMENTATION_SUMMARY.md](../../apps/onchain/IMPLEMENTATION_SUMMARY.md)
- [document/SMART_CONTRACTS.md](../../document/SMART_CONTRACTS.md)
- [apps/backend/IMPLEMENTATION_SUMMARY_CONTRACT_ROTATION.md](../../apps/backend/IMPLEMENTATION_SUMMARY_CONTRACT_ROTATION.md)
