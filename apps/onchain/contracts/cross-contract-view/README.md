# Cross-Contract View Helper Library

A shared library for safe cross-contract reads to reduce duplicated logic across modules.

## Features

- **Safe view calls**: Wrappers that handle common read patterns with proper error handling
- **Token operations**: Helpers for balance checks and allowance queries
- **Admin validation**: Standardized admin verification patterns
- **State queries**: Safe contract state reads with TTL management

## Installation

Add to your `Cargo.toml`:

```toml
[dependencies]
cross-contract-view = { path = "../cross-contract-view" }
```

## Usage

### Token Helpers

```rust
use cross_contract_view::token_helpers;

// Read token balance
let balance = token_helpers::balance(&env, &token_address, &user_address);

// Read token allowance
let allowance = token_helpers::allowance(&env, &token_address, &owner, &spender);

// Read token metadata
let info = token_helpers::token_info(&env, &token_address)?;
```

### Admin Helpers

```rust
use cross_contract_view::admin_helpers;

// Verify admin with standardized error
admin_helpers::require_admin(&env, &caller, &DataKey::Admin)?;

// Get admin address
let admin = admin_helpers::get_admin(&env, &DataKey::Admin)?;

// Check if initialized
if admin_helpers::is_initialized(&env, &DataKey::Admin) {
    // ...
}
```

### Safe View Operations

```rust
use cross_contract_view::{read_state, has_state, read_state_with_default};

// Read state with error handling
let value: MyType = read_state(&env, &DataKey::MyKey)?;

// Check if key exists
if has_state(&env, &DataKey::MyKey) {
    // ...
}

// Read with default value
let count = read_state_with_default(&env, &DataKey::Counter, 0i128);
```

### Persistent Storage

```rust
use cross_contract_view::safe_view::{read_persistent, read_persistent_with_default};

// Read from persistent storage
let value: MyType = read_persistent(&env, &DataKey::MyKey)?;

// Read with default
let balance = read_persistent_with_default(&env, &DataKey::Balance(user), 0i128);
```

## Error Handling

All operations return `Result<T, ViewError>` where `ViewError` provides:

| Error | Code | Description |
|-------|------|-------------|
| `NotFound` | 1 | Data not found in storage |
| `NotInitialized` | 2 | Contract not initialized |
| `Unauthorized` | 3 | Caller is not authorized |
| `InvalidContract` | 4 | Invalid or unregistered contract address |
| `TypeMismatch` | 5 | Type conversion failed |
| `StorageError` | 6 | Storage operation failed |
| `TokenError` | 7 | Token operation failed |
| `CrossContractCallFailed` | 8 | Cross-contract call failed |

## TTL Management

The library automatically extends TTL for storage entries to prevent expiration:

- **Threshold**: 120,960 ledgers (~7 days)
- **Bump**: 241,920 ledgers (~14 days)

## Contracts Using This Library

- `yield_vault` - Uses token helpers for balance checks
- `vesting-wallet` - Uses admin helpers for authorization
