# Treasury Streaming and Budget Allocation Module

This module implements time-based treasury streaming for approved budgets. It allows funds to unlock gradually over a specified duration instead of being released in one lump sum.

## Features

- **Budget Allocation**: Administrators can set aside a specific amount of tokens for a beneficiary.
- **Time-based Streaming**: Funds unlock linearly based on the elapsed time since the start of the stream.
- **Safe Claiming**: Beneficiaries can claim their currently unlocked tokens at any time.
- **Pure View Functions**: Check unlocked amounts without triggering transactions.

## How it works

1.  **Initialization**: The contract is initialized with an admin and a token address.
2.  **Allocation**: The admin calls `allocate_budget(beneficiary, amount, start_time, duration)`. This transfers tokens from the admin to the Treasury contract.
3.  **Streaming**: As time passes, the `get_unlocked` function returns an increasing amount of tokens available for the beneficiary.
4.  **Claiming**: The beneficiary calls `claim(beneficiary)` to receive the currently unlocked tokens.

## Integration with Crowdfund Vault

To use this module with the `crowdfund_vault`:
1.  Upon milestone approval in the `crowdfund_vault`, instead of the project owner calling `withdraw`, the admin or a designated automation can call `allocate_budget` on this contract.
2.  This ensures the project's budget is released gradually, incentivizing long-term progress.

## Treasury Contract

A secure token-streaming treasury smart contract built for the Soroban framework on the Stellar blockchain. This contract handles linear distribution schedules, allowing an administrator to lock up native or custom Stellar assets and stream them to community beneficiaries gradually over an elapsed timeframe.

---

## 🚀 Testnet Deployment Configuration

This contract is deployed and active on the Stellar Testnet. System applications and client SDKs should reference these deployment details:

| Parameter Key | Value Reference |
| :--- | :--- |
| **Contract ID** | `CC5XSIUYIZ2OQLBNYRJPCGV4465DJ4UXD23BBCBCJGZ7CVPY3NI2T6ZL` |
| **Network Target** | Stellar Testnet (`testnet`) |
| **WASM Hash** | `d0810d0e018cc2ae005b660b0d1e5073deff9f342b67c12e010a40c152fc4198` |
| **Admin Address** | `GA5TBSBGERHVMEFBJGEM3KYMRLWO73Y2QRAV6P66GPEBOJ5ZMJUT7LLY` |

---

## 🏗️ Compilation & Architecture Lints

To re-verify matching type signatures, execution parameters, and build optimized WebAssembly binaries from the workspace root:

```bash
# Verify static analysis structures
cargo clippy --all-targets

# Build production WASM targets
stellar contract build
```

## The compiled asset will be available at:

`target/wasm32v1-none/release/treasury.wasm`

## 🧠 Core Interface Specification

### Lifecycle & Administration

#### `initialize(env: Env, admin: Address, token: Address)`
Initializes the immutable operational state of the contract. Sets the authorized asset manager address and binds the canonical streaming token address. Throws an explicit `AlreadyInitialized` error if called again.

#### `allocate_budget(env: Env, admin: Address, beneficiary: Address, amount: i128, start_time: u64, duration: u64)`
Locks a designated amount of tokens inside the contract vault and maps out a streaming timeline matrix for a specific beneficiary wallet. Requires explicit authorization signature matching the recorded administrative profile.

### Beneficiary Actions

#### `claim(env: Env, beneficiary: Address) -> i128`
Calculates linear unlocking progress using ledger timestamps, increments `claimed_amount`, and transfers unlocked balances straight to the beneficiary's wallet. Evicts persistent state rows automatically once a budget line reaches a remainder of 0.

## 📊 Read-Only State Resolvers

Integration developers can hit these methods via free RPC lookups to feed client telemetry without generating gas-consuming transaction payloads:

```rust
// View total token volume unlocked and ready for withdrawal
pub fn get_unlocked(env: Env, beneficiary: Address) -> Result<i128, TreasuryError>;

// Retrieve the contract's primary administrative key
pub fn get_admin(env: Env) -> Result<Address, TreasuryError>;

// Identify the underlying asset contract tied to this treasury instance
pub fn get_token(env: Env) -> Result<Address, TreasuryError>;
```

## 🔒 Safety Measures

**State Expiry Controls:** Storage instances for data records use dedicated Time-To-Live extension calls (`extend_ttl`) matching network safe-zone intervals (`LEDGER_THRESHOLD`, `LEDGER_BUMP`) to shield active linear streams from accidental expiration.

**Reentrancy Protection:** Direct external token movements are locked behind structural reentrancy guards (`with_reentrancy_guard`) to isolate runtime operations against multi-call exploit scenarios.

---