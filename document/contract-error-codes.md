# Contract Error Code Allocation Scheme

## Overview

Each Soroban contract previously defined its own error enum with independently
numbered variants starting at 1. The backend and any off-chain tooling that
inspected raw numeric codes could not tell which contract produced a given code —
the same number meant different things depending on the source contract.

This document defines the standardized allocation scheme where every contract
occupies a dedicated, non-overlapping numeric range. The backend resolves any
code to a contract name, variant name, and human-readable message using the
shared registry.

## Allocation Table

| # | Contract               | Enum Name                  | Range       | Source Path                                    |
|---|------------------------|----------------------------|-------------|------------------------------------------------|
| 1 | `contributor_registry` | `ContributorError`         | 1001–1099   | `contracts/contributor_registry/src/errors.rs` |
| 2 | `vesting-wallet`       | `VestingError`             | 1101–1199   | `contracts/vesting-wallet/src/errors.rs`       |
| 3 | `project_registry`     | `RegistryError`            | 1201–1299   | `contracts/project_registry/src/errors.rs`     |
| 4 | `treasury`             | `TreasuryError`            | 1301–1399   | `contracts/treasury/src/errors.rs`             |
| 5 | `crowdfund_vault`      | `CrowdfundError`           | 1401–1499   | `contracts/crowdfund_vault/src/errors.rs`      |
| 6 | `lumenpulse-curation`  | `CurationError`            | 1501–1599   | `contracts/lumenpulse-curation/src/errors.rs`  |
| 7 | `feature_flags`        | `FlagError`                | 1601–1699   | `contracts/feature_flags/src/errors.rs`        |
| 8 | `notification_broker`  | `NotificationBrokerError`  | 1701–1799   | `contracts/notification_broker/src/errors.rs`  |
| 9 | `upgradable-contract`  | `ContractError`            | 1801–1899   | `contracts/upgradable-contract/src/errors.rs`  |
|10 | `cross-contract-view`  | `ViewError`                | 1901–1999   | `contracts/cross-contract-view/src/errors.rs`  |
|11 | `pricing_adapter`      | `PricingAdapterError`      | 2001–2099   | `contracts/pricing_adapter/src/errors.rs`      |
|12 | `matching_pool`        | `MatchingPoolError`        | 2101–2199   | `contracts/matching_pool/src/errors.rs`        |
|13 | `protocol_registry`    | `RegistryError`            | 2201–2299   | `contracts/protocol_registry/src/errors.rs`    |
|14 | `yield_vault`          | `YieldVaultError`          | 2301–2399   | `contracts/yield_vault/src/errors.rs`          |

Each range accommodates up to 99 variants. The first code in each block is
`base + 1` (e.g., 1001 for contributor_registry, not 1000).

## ⚠️ Breaking Change

All numeric variant values were renumbered. Any integration that hardcoded the
old raw values (1–N) must be updated to use the new globally unique codes.
Affected integrations include:

- Backend error mapping / surfacing logic
- Client-side error string tables
- Test fixtures asserting on specific `u32` error codes

The canonical source of truth for all codes is:

- **Registry JSON**: `apps/onchain/contracts/error_registry.json`
- **TypeScript registry**: `apps/backend/src/common/contract-error-registry.ts`
- **Backend resolver service**: `apps/backend/src/common/contract-error.service.ts`

## Overlap Detection

A Jest test in `apps/backend/src/common/contract-error.service.spec.ts` fails
the CI pipeline if any two codes overlap or if a code falls outside its
contract's declared range. Run it with:

```bash
cd apps/backend
pnpm test -- --testPathPattern=contract-error
```

## Adding a New Contract

1. Choose the next available 100-block after the last allocated range
   (currently 2300–2399 is the last; next block starts at 2401).
2. Add the contract to the allocation table above.
3. Add the range to `CONTRACT_RANGES` in
   `apps/backend/src/common/contract-error-registry.ts`.
4. Add each variant to `CONTRACT_ERROR_REGISTRY` in the same file.
5. Update `apps/onchain/contracts/error_registry.json`.
6. Number the Rust enum variants starting at `base + 1`.
7. Run the overlap test to confirm no collision.

## Error Code Reference

For the complete list of every code and its meaning, see
[`apps/onchain/contracts/error_registry.json`](../apps/onchain/contracts/error_registry.json)
or query the backend via `ContractErrorService.byContract(name)`.
