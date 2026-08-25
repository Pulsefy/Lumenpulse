# On-Chain Contracts (Soroban/Stellar)

This workspace contains Soroban smart contracts for the Stellar blockchain.

## 🚀 Quick Start

### Prerequisites
```bash
# Install Rust (if not installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Add WebAssembly target
rustup target add wasm32-unknown-unknown

# Install Soroban CLI
cargo install --locked soroban-cli

## Contract Lifecycle Notes

- `crowdfund_vault` now stores an explicit schema version during initialization and exposes `migrate` for legacy instances upgraded from older WASM without a version marker.
- New projects receive a rolling milestone expiry deadline. If the deadline passes without progress, the project moves into an expired state and contributors can reclaim funds through a timed clawback window.
- Bulk contributor refunds remain available for canceled or expired projects so funds do not stay trapped after stalled project lifecycles.

## Admin Rotation

The `upgradable-contract` admin rotation is two-step. The current admin calls `propose_admin`, then the proposed address must call `accept_admin`; the current admin can call `cancel_admin` before acceptance. `AdminChangedEvent` includes both the previous and new admin addresses.

When rotation is submitted through `queue_operation` with `TimelockAction::SetAdmin`, the upgrade timelock must first elapse and the current admin must execute the operation. That execution only creates the pending proposal; the new admin must still accept it. Upgrade operations remain subject to the same delay and grace-period window, and an old admin can cancel a queued operation or a pending rotation before acceptance.