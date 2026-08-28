# On-Chain Contracts (Soroban/Stellar)

This workspace contains Soroban smart contracts for the Stellar blockchain.

## Contract Inventory

Active cargo workspace members (these are what `cargo build` / CI compile):

| Crate | Purpose |
|---|---|
| `contributor_registry` | On-chain contributor registration and reputation |
| `crowdfund_vault` | Milestone-based crowdfunding escrow with clawback/refunds |
| `lumen_token` | Protocol token |
| `matching_pool` | Matching-funds pool for funding rounds |
| `notification_interface` | Trait/interface for notification receivers |
| `project_registry` | Project lifecycle registry |
| `protocol_registry` | Global protocol registry/configuration |
| `reentrancy-guard` | Shared reentrancy protection helpers |
| `upgradable-contract` | Contract upgrade pattern utilities |
| `vesting-wallet` | Token vesting schedules |
| `lumenpulse-curation` | Content/news curation and rewards |
| `pricing_adapter` | Oracle price adapter |
| `treasury` | Protocol treasury management |
| `idempotency-guard` | Idempotency helper for contract operations |
| `yield_vault` | Multi-provider yield strategy vault |
| `feature_flags` | On-chain feature flag toggles |

Not built by the workspace:
- `contracts/tests/` — cross-contract integration test suite (explicitly excluded in the root `Cargo.toml`)
- Legacy prototype crates that were never workspace members and are pending separate decisions:
  `contracts/stable_swap_pool/`, `contracts/liquidity_pool/`, `contracts/notification_broker/`

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
