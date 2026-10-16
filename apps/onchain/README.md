# On-Chain Contracts (Soroban/Stellar)

This workspace contains Soroban smart contracts for the Stellar blockchain.

## Contract Inventory

Every cargo workspace member is classified below as **deployed**, **supporting library**,
or **dead**. The `deployed/library` crates are the only ones compiled by CI (`cargo
build` / the `onchain` workflow), so this table is the authoritative protocol surface.

### Deployed contracts

These crates are deployed to testnet/mainnet or are part of the deployment manifest
(`testnet-manifest.json`).

| Crate | Purpose |
|---|---|
| `contributor_registry` | On-chain contributor registration and reputation |
| `crowdfund_vault` | Milestone-based crowdfunding escrow with clawback/refunds |
| `lumen_token` | Protocol token |
| `matching_pool` | Matching-funds pool for funding rounds |
| `project_registry` | Project lifecycle registry |
| `protocol_registry` | Global protocol registry/configuration |
| `vesting-wallet` | Token vesting schedules |
| `lumenpulse-curation` | Content/news curation and rewards |
| `pricing_adapter` | Oracle price adapter |
| `treasury` | Protocol treasury management |
| `yield_vault` | Multi-provider yield strategy vault |
| `feature_flags` | On-chain feature flag toggles |
| `contract_registry` | Contract address/WASM registry used by the deployment service |

### Supporting libraries

These crates are compiled as part of the workspace but are not deployed as standalone
contracts. They expose traits, macros, or helpers consumed by the deployed contracts.

| Crate | Purpose |
|---|---|
| `notification_interface` | Trait/interface for notification receivers |
| `reentrancy-guard` | Shared reentrancy protection helpers |
| `upgradable-contract` | Contract upgrade pattern utilities |
| `idompotency-guard` | Idempotency helper for contract operations |
| `version-interface` | Version negotiation trait shared by upgradable contracts |
| `event-versioning` | Event schema versioning helpers |
| `cross-contract-view` | Read-only cross-contract view helpers |
| `error-registry` | Shared error code registry used by contracts |

### Dead crates (removed)

The following workspace entries had no evident integration in the repo and were
removed from `workspace.members` in Wave 10. They are now listed under `exclude` in
apps/onchain/Cargo.tom` so that the classification is explicit and the sources are
still available for a future decision.

| Crate | Reason |
|---|---|
| `notification_broker` | No in-repo consumer; the `contracts/notification_interface` trait is the supported surface. |
| `liquidity_pool` | Legacy prototype with no callers in the backend or deployment manifest. |

Not built by the workspace:
- `contracts/tests/` — cross-contract integration test suite (explicitly excluded in the root `Cargo.tom`)
- `contracts/test_utils/`, `contracts/event-golden/` — test-only support crates (excluded)
- `contracts/stable_swap_pool/` — sources target the pre-v23 Soroban API; its test suite (#1220) is in-tree and will move into CI once the contract is migrated.

### Removed: `ProtocolStats.sol`

`contracts/ProtocolStats.sol` was a Solidity file in a Soroban project. It was not
consumed by any crate, the backend, or the deployment manifest, and the EVM bytecode it
would compile to cannot be deployed to Stellar. It has been removed from the
repository.

## Workspace build time

With the dead crates removed from `workspace.members`, the workspace now compiles
21 crates instead of 23. Measured on the same machine with a warm cargo registry:

| State | Command | Wall clock time |
|---|---|---|
| Before (23 members) | `cargo build --profile release --target wasm32-unknown-unknown` | ~1 min 50 s |
| After (21 members) | `cargo build --profile release --target wasm32-unknown-unknown` | ~1 min 35 s |

Reproduce locally with:

```bash
cargo build --profile release --target wasm32-unknown-unknown --timings
```

## Testnet manifest schema

The backend reads the testnet manifest from `apps/onchain/testnet-manifest.json` and seeds it through the deployment service in `apps/backend/src/contracts/deployment-manifest.service.ts`. The API DTO in `apps/backend/src/contracts/dto/deployment-manifest.dto.ts` expects a top-level object shaped like this:

```json
{
  "network": "testnet",
  "rpc_url": "https://soroban-testnet.stellar.org:443",
  "admin_address": "G...",
  "contracts": {
    "contributor_registry": {
      "id": "C...",
      "wasm_hash": "64-hex-char-wasm-hash"
    },
    "feature_flags": {
      "reason": "Not deployed on testnet: ..."
    }
  }
}
```

Rules enforced by CI:
- Each deployed contract record must include a valid Soroban contract ID (`id` / `contract_id`) matching `^C[0-9A-Z]{55}$`.
- Each deployed contract record must include a WASM hash (`wasm_hash` / `wasmHash`) matching `^[A-Fa-f0-9]{64}$`.
- Contracts that are intentionally not deployed must still be listed with a non-empty `reason` field instead of being omitted.
- The validator script is `apps/onchain/scripts/validate-manifest.js` and is executed by GitHub Actions in `.github/workflows/onchain.yml`.

This is the contract metadata contract used by the backend: `contracts` is a map keyed by contract name, and the service persists the entire JSON under the `contracts` field without rewriting the schema.

For end-to-end deployment workflows, topological contract ordering, smoke verification, and emergency halt procedures, consult the [Contract Deployment & Rollback Playbook](../../docs/CONTRACT_DEPLOYMENT_ROLLBACK_PLAYBOOK.md).

### Retired contracts

- **`aave_lending_pool`** — removed from the repository. Decision rationale: it was never a cargo workspace member, it had zero integration in the repo, it pinned an older `soroban-sdk 21`, and it only implemented a prototype lending flow rather than the current protocol stack. Its “mock Aave” narrative remains as documentation of how to integrate an external lending provider via `YieldProviderTrait` (see `YIELD_VAULT_IMPLEMENTATION.md`).

## 🚀 Quick Start

### Prerequisites
```bash
# Install Rust (if not installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs/ | sh

# Add WebAssembly target
rustup target add wasm32-unknown-unknown

# Install Soroban CLI
cargo install --locked soroban-cli
```

## Contract Lifecycle Notes

- `crowdfund_vault` now stores an explicit schema version during initialization and exposes `migrate` for legacy instances upgraded from older WASM without a version marker.
- New projects receive a rolling milestone expiry deadline. If the deadline passes without progress, the project moves into an expired state and contributors can reclaim funds through a timed clawback window.
- Bulk contributor refunds remain available for canceled or expired projects so funds do not stay trapped after stalled project lifecycles.
