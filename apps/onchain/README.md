# On-Chain Contracts (Soroban/Stellar)

This workspace contains Soroban smart contracts for the Stellar blockchain.

## Contract Inventory

Every crate in `contracts/` is accounted for in `testnet-manifest.json`: it is either deployed (recorded with a contract ID and WASM hash) or explicitly listed as not deployed with a reason. `contracts/tests/` is the only directory outside the manifest because it is a cross-contract integration test suite, explicitly excluded in the root `Cargo.toml`.

| Crate | Purpose | Testnet manifest |
|---|---|---|
| `contributor_registry` | On-chain contributor registration and reputation | deployed |
| `crowdfund_vault` | Milestone-based crowdfunding escrow with clawback/refunds | deployed |
| `lumen_token` | Protocol token | deployed |
| `matching_pool` | Matching-funds pool for funding rounds | deployed |
| `pricing_adapter` | Oracle price adapter | deployed |
| `project_registry` | Project lifecycle registry | deployed |
| `treasury` | Protocol treasury management | deployed |
| `contract_registry` | On-chain catalog of registered contract metadata | not deployed |
| `feature_flags` | On-chain feature flag toggles | not deployed |
| `idempotency-guard` | Idempotency helper for contract operations | not deployed |
| `liquidity_pool` | Automated market maker pool | not deployed |
| `lumenpulse-curation` | Content/news curation and rewards | not deployed |
| `notification_broker` | Brokered notification delivery | not deployed |
| `notification_interface` | Trait/interface for notification receivers | not deployed |
| `protocol_registry` | Global protocol registry/configuration | not deployed |
| `reentrancy-guard` | Shared reentrancy protection helpers | not deployed |
| `stable_swap_pool` | Stable-swap AMM (not a cargo workspace member) | not deployed |
| `upgradable-contract` | Contract upgrade pattern utilities | not deployed |
| `vesting-wallet` | Token vesting schedules | not deployed |
| `yield_vault` | Multi-provider yield strategy vault | not deployed |
| `cross-contract-view` | Cross-contract read helper library | not deployed (lib-only) |
| `event-versioning` | Event schema versioning convention (issue #1057) | not deployed (lib-only) |
| `version-interface` | Shared contract version introspection surface (issue #1046) | not deployed (lib-only) |

## Testnet manifest schema

The backend reads the testnet manifest from `apps/onchain/testnet-manifest.json` and seeds it through the deployment service in `apps/backend/src/contracts/deployment-manifest.service.ts`. The API DTO in `apps/backend/src/contracts/dto/deployment-manifest.dto.ts` expects a top-level object shaped like this:

```json
{
  "network": "testnet",
  "rpc_url": "https://soroban-testnet.stellar.org:443",
  "admin_address": "G...",
  "crate_coverage": {
    "total_crates": 23,
    "deployed": 7,
    "not_deployed": 16
  },
  "contracts": {
    "contributor_registry": {
      "id": "C...",
      "wasm_hash": "64-hex-char-wasm-hash"
    }
  },
  "not_deployed": {
    "feature_flags": {
      "crate_path": "contracts/feature_flags",
      "reason": "Not deployed on testnet: ..."
    }
  }
}
```

Manifest keys are crate directory names with dashes normalized to underscores (`contracts/idempotency-guard` → `idempotency_guard`), so the key always maps back to a directory in `contracts/`.

Rules enforced by CI:
- **Complete crate coverage**: every crate directory in `contracts/` (minus the workspace-excluded `contracts/tests/`) must appear in exactly one of `contracts` or `not_deployed`. A new crate fails the build until it is deployed or excluded with a reason.
- **No stale keys**: entries that do not match a crate directory, and crates listed in both sections, are rejected.
- **Deployed records**: each entry in `contracts` must carry a valid Soroban contract ID (`id` / `contract_id`) matching `^C[0-9A-Z]{55}$` and a WASM hash (`wasm_hash` / `wasmHash`) matching `^[A-Fa-f0-9]{64}$`. No contract ID may be recorded twice, and any `*_address` / `init_params` address must be a valid Stellar address (`^[CG][0-9A-Z]{55}$`).
- **Excluded records**: each entry in `not_deployed` must state a `reason` of at least 20 characters and must not carry `id` or `wasm_hash`. A `crate_path`, when present, must resolve to a real crate directory whose name matches the key.
- **Header counts**: `crate_coverage` must state the deployed and excluded crate counts and must match what the manifest actually records.
- The validator is `apps/onchain/scripts/validate-manifest.js`, its unit tests are `apps/onchain/scripts/validate-manifest.test.js` (`node --test`), and both run in `.github/workflows/onchain.yml` on every pull request.

This is the contract metadata contract used by the backend: `contracts` is a map keyed by contract name and holds only deployed contracts, while `network`, `rpc_url`, `admin_address`, `crate_coverage` and `not_deployed` are persisted alongside it as manifest metadata. The service stores the sections without rewriting their schema.

For end-to-end deployment workflows, topological contract ordering, smoke verification, and emergency halt procedures, consult the [Contract Deployment & Rollback Playbook](../../document/CONTRACT_DEPLOYMENT_ROLLBACK_PLAYBOOK.md).

### Retired contracts

- **`aave_lending_pool`** — removed from the repository. Decision rationale: it was never a cargo workspace member, it had zero integration in the repo, it pinned an older `soroban-sdk 21`, and it only implemented a prototype lending flow rather than the current protocol stack. Its “mock Aave” narrative remains as documentation of how to integrate an external lending provider via `YieldProviderTrait` (see `YIELD_VAULT_IMPLEMENTATION.md`).

## 🚀 Quick Start

### Prerequisites
```bash
# Install Rust (if not installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Add WebAssembly target
rustup target add wasm32-unknown-unknown

# Install Soroban CLI
cargo install --locked soroban-cli
```

## Contract Lifecycle Notes

- `crowdfund_vault` now stores an explicit schema version during initialization and exposes `migrate` for legacy instances upgraded from older WASM without a version marker.
- New projects receive a rolling milestone expiry deadline. If the deadline passes without progress, the project moves into an expired state and contributors can reclaim funds through a timed clawback window.
- Bulk contributor refunds remain available for canceled or expired projects so funds do not stay trapped after stalled project lifecycles.
