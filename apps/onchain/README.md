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
- `contracts/tests/` — cross-contract integration test suite (explicitly excluded in the root
  `Cargo.toml`)
- Legacy prototype crates that were never workspace members and are pending separate decisions:
  `contracts/stable_swap_pool/`, `contracts/liquidity_pool/`,
  `contracts/notification_broker/`

### Retired contracts

- **`aave_lending_pool`** — removed from the repository. Decision rationale: it was never a cargo
  workspace member (absent from both the `members` list and `Cargo.lock`, so it never affected
  workspace build time), it had zero code-level integration anywhere in the repo (no path
  dependencies, not referenced by any Rust code, deploy scripts, or the testnet manifest), it
  pinned an older `soroban-sdk 21` while the workspace standard is SDK 23, and it only implemented
  deposit/withdraw/interest accrual with no borrow/repay/liquidation paths. Its "mock Aave"
  narrative lives on purely as documentation of how to integrate an external lending provider via
  `YieldProviderTrait` (see `YIELD_VAULT_IMPLEMENTATION.md`).

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