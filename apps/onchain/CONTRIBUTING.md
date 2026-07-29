# Contributing to On-Chain Contracts

Welcome to the on-chain contracts workspace! This document outlines the development standards, testing conventions, and contribution workflow for Soroban smart contracts on Stellar.

## 📋 Development Standards

### Code Style
- **Rustfmt**: All code must be formatted with `cargo fmt`
- **Clippy**: No warnings allowed (`cargo clippy -- -D warnings`)
- **Naming Conventions**:
  - Structs: `PascalCase` (e.g., `HelloContract`)
  - Functions: `snake_case` (e.g., `ping`, `enable_privacy`)
  - Constants: `SCREAMING_SNAKE_CASE` (e.g., `MAX_PRIVACY_LEVEL`)
  - Variables: `snake_case` (e.g., `account_address`)

### Event Versioning

Every contract event **must** include a `version: u32` field as its first data field
so that backend and data-processing consumers can detect schema changes.

1. Define a module-level constant in the events module:
   ```rust
   /// Canonical event version. Bump this when the schema of any event in this
   /// module changes so consumers can detect the difference.
   pub const EVENT_VERSION: u32 = 1;
   ```

2. Add `version` as the first field in every event struct:
   ```rust
   #[contractevent]
   pub struct SomeEvent {
       /// Schema version for consumer-side migration detection.
       pub version: u32,
       #[topic]
       pub user: Address,
       pub amount: i128,
   }
   ```

3. Pass `EVENT_VERSION` when publishing:
   ```rust
   events::SomeEvent {
       version: events::EVENT_VERSION,
       user,
       amount,
   }.publish(&env);
   ```

4. When changing an event schema (adding, removing, or reordering fields),
   **increment** `EVENT_VERSION` so consumers can distinguish the format.

### Import Order
```rust
// 1. External crates
use soroban_sdk::{contract, contractimpl, Env};

// 2. Internal modules (if any)
// use crate::types::*;

// 3. Module declarations
mod test;