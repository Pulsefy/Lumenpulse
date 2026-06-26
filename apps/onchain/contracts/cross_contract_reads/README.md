# cross_contract_reads

Shared helpers for **safe, ergonomic cross-contract view calls** across the
Lumenpulse Soroban onchain workspace.

---

## Why this crate exists

Soroban contracts on Stellar frequently need to read state from other contracts —
checking a token balance before a transfer, querying a yield provider for the
current position, or inspecting the treasury's unlock schedule.

Without a shared abstraction every contract must:

1. Copy-paste a `#[contractclient]` trait for the remote interface.  
2. Construct the client inline at every call site.  
3. Independently decide how to map SDK errors to its own error enum.

This crate eliminates all three steps. Consuming contracts call a single typed
helper and map exactly one error code:

```rust
cross_contract_reads::token::token_balance(&env, &token_addr, &account)
    .map_err(|_| MyError::CrossContractFailed)?
```

---

## Modules at a glance

| Module | Helpers | Remote interface |
|---|---|---|
| `token` | `token_balance`, `token_decimals`, `token_total_supply` | SEP-41 token contract |
| `yield_provider` | `yield_balance` | Any contract implementing `YieldProviderReadTrait` |
| `treasury` | `treasury_get_unlocked`, `treasury_get_admin`, `treasury_get_token` | Lumenpulse streaming treasury |
| `generic` | `invoke_view` | Any contract (escape hatch) |

---

## Error handling convention

All helpers return `Result<T, CrossContractError>`.  
`CrossContractError` has three variants:

| Variant | Code | Meaning |
|---|---|---|
| `CallFailed` | 1 | Remote call trapped / panicked / returned an error Val |
| `NotFound` | 2 | Call succeeded but result was absent or invalid (e.g. negative balance) |
| `Overflow` | 3 | Arithmetic overflow interpreting the numeric result |

### Mapping in a consuming contract

Add the `CrossContractFailed` variant to your contract's error enum:

```rust
// errors.rs
#[contracterror]
#[repr(u32)]
pub enum MyContractError {
    // ... existing variants ...
    CrossContractFailed = 32,   // ← pick the next free code
}
```

Then map at every call site:

```rust
use cross_contract_reads::token::token_balance;

let bal = token_balance(&env, &token_addr, &user)
    .map_err(|_| MyContractError::CrossContractFailed)?;
```

---

## Usage

### 1 · Add the dependency

In your contract's `Cargo.toml`:

```toml
[dependencies]
cross_contract_reads = { path = "../cross_contract_reads" }
```

### 2 · Token balance

```rust
use cross_contract_reads::token::token_balance;

pub fn some_fn(env: Env, token: Address, user: Address) -> Result<i128, MyError> {
    let balance = token_balance(&env, &token, &user)
        .map_err(|_| MyError::CrossContractFailed)?;
    Ok(balance)
}
```

### 3 · Yield-provider balance

```rust
use cross_contract_reads::yield_provider::yield_balance;

let position = yield_balance(&env, &yield_provider_addr, &vault_addr)
    .map_err(|_| MyError::CrossContractFailed)?;
```

### 4 · Treasury reads

```rust
use cross_contract_reads::treasury::{treasury_get_unlocked, treasury_get_admin};

let unlocked = treasury_get_unlocked(&env, &treasury_addr, &beneficiary)
    .map_err(|_| MyError::CrossContractFailed)?;

let admin = treasury_get_admin(&env, &treasury_addr)
    .map_err(|_| MyError::CrossContractFailed)?;
```

### 5 · Generic escape hatch

Use `generic::invoke_view` for any interface not yet covered by a typed module:

```rust
use soroban_sdk::{vec, Val};
use cross_contract_reads::generic::invoke_view;

let args: soroban_sdk::Vec<Val> = vec![&env, beneficiary.into_val(&env)];
let result: Val = invoke_view(&env, &some_contract, "get_metadata", args)
    .map_err(|_| MyError::CrossContractFailed)?;
```

---

## Adding a new typed helper

1. Create `src/my_protocol.rs`.  
2. Define a `#[contractclient]` trait with **only view (read-only) methods**.  
3. Write `pub fn` wrappers returning `Result<T, CrossContractError>`.  
4. Add `pub mod my_protocol;` to `src/lib.rs`.  
5. Document the new module in this README.

> **Write calls are out of scope.**  
> Any function that mutates state on a remote contract (`transfer`, `deposit`,
> `allocate_budget`, …) must remain in the calling contract's own business
> logic. This crate is read-only by design.

---

## Contracts currently using this crate

| Contract | Helpers used |
|---|---|
| `crowdfund_vault` | `yield_provider::yield_balance`, `token::token_balance` |
| `matching_pool` | `token::token_balance` |
