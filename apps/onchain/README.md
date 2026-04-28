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
- Protocol fee support is available: admins can configure a small fee that is deducted from withdrawals and project funding to support long-term sustainability.
- New projects receive a rolling milestone expiry deadline. If the deadline passes without progress, the project moves into an expired state and contributors can reclaim funds through a timed clawback window.
- Bulk contributor refunds remain available for canceled or expired projects so funds do not stay trapped after stalled project lifecycles.