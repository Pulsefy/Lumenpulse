# feature_flags — Testnet Feature Flag Contract

> **⚠️ Testnet only.** This contract is intended exclusively for testnet use.
> Do not deploy it to mainnet or write production contracts that depend on it.

## Purpose

`feature_flags` provides a lightweight, on-chain store of named boolean flags.
Other contracts can query these flags to safely gate experimental protocol
behaviour during testnet trials before a feature is considered stable for
mainnet deployment.

## Acceptance criteria mapping

| Criterion | How it is met |
|---|---|
| Flags can gate selected methods or logic branches | Any contract calls `FeatureFlagsContract::is_enabled(flag)` and branches on the result. |
| Default values are deterministic | `is_enabled` returns `false` for any flag that has never been explicitly set — no seed step required. |
| Flag state changes are observable | Every `set_flag` call emits a `FlagSetEvent` (indexed by flag name) that off-chain indexers and testnet explorers can subscribe to. |
| Testnet-only usage documented | This README and the inline contract doc-comments both state the constraint explicitly. |

## Contract interface

```
initialize(admin: Address)                        → Result<(), FlagError>
set_flag(admin: Address, flag: Symbol, enabled: bool) → Result<(), FlagError>
is_enabled(flag: Symbol)                          → bool
get_flag(flag: Symbol)                            → Result<bool, FlagError>
get_admin()                                       → Result<Address, FlagError>
set_admin(current_admin: Address, new_admin: Address) → Result<(), FlagError>
```

### Storage layout

| Key | Storage type | Description |
|---|---|---|
| `DataKey::Admin` | Instance | Admin address |
| `DataKey::Flag(Symbol)` | Instance | Enabled state per flag |

Instance storage is used for all keys so flag reads are cheap (single ledger
entry) and TTL extension is simple.

## Deploying on testnet

```sh
# Build
cd apps/onchain
stellar contract build --package feature-flags

# Deploy
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/feature_flags.wasm \
  --network testnet \
  --source <your-testnet-key>

# Initialize
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  --source <your-testnet-key> \
  -- initialize --admin <ADMIN_ADDRESS>
```

## Enabling a feature flag

```sh
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  --source <admin-key> \
  -- set_flag --admin <ADMIN_ADDRESS> --flag newFeat --enabled true
```

## Querying from another contract

```rust
// In your Soroban contract:
let flags_client = FeatureFlagsContractClient::new(&env, &flags_contract_id);
if flags_client.is_enabled(&symbol_short!("newFeat")) {
    // run gated logic
}
```

## Events

| Event | Topic | Fields |
|---|---|---|
| `InitializedEvent` | — | `admin` |
| `FlagSetEvent` | `flag` (Symbol) | `enabled`, `updated_by` |
| `AdminTransferredEvent` | — | `old_admin`, `new_admin` |

## Running tests

```sh
cd apps/onchain
cargo test -p feature-flags
```
