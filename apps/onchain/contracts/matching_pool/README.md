# Matching Pool Contract

A production-grade Soroban smart contract implementing a **Quadratic Funding (QF)** matching pool mechanism. This contract manages funding rounds, tracks granular community contributions across individual projects, and automates mathematical matching distributions utilizing optimized on-chain scaling functions.

---

## 🚀 Testnet Deployment Configuration

This contract is actively deployed and initialized on the Stellar Testnet. Frontend, backend, and mobile clients should target the following network artifacts:

| Parameter Key | Value Reference |
| :--- | :--- |
| **Contract ID** | `CBQJ2E2MPYRCQDHZZYJXHRKUTCTIJFO55AVGHB2WDZSLS2OOENUDC6HH` |
| **Network Target** | Stellar Testnet (`testnet`) |
| **WASM Hash** | `c917f2f45736cbd7854a33ec68bf59e591dd0c830cf1203ffb780ed88498247f` |
| **Admin Address** | `GA5TBSBGERHVMEFBJGEM3KYMRLWO73Y2QRAV6P66GPEBOJ5ZMJUT7LLY` |

---

## 🛠 Compilation & Build Verification

The contract is designed to inherit its core engine specifications directly from the root workspace configuration. To clean, verify lints, and build the WebAssembly target from the root repository directory, execute:

```bash
# Verify linting patterns and type bounds
cargo clippy --all-targets

# Compile to structural target WASM
stellar contract build
```

## The resulting optimized binary will be written to the shared directory target folder:
`target/wasm32v1-none/release/matching_pool.wasm`

## 🧠 Core Interface Specification

### Administrative Hooks

#### `initialize(env: Env, admin: Address)`
Sets the primary system controller, initializes the execution tracking variables (`NextRoundId` to 0), and unpauses operational flows. Throws `AlreadyInitialized` if executed more than once.

#### `pause(env: Env, admin: Address)` / `unpause(env: Env, admin: Address)`
Emergency circuit breakers to suspend or resume mutable state processing.

#### `upgrade(env: Env, caller: Address, new_wasm_hash: BytesN<32>)`
Facilitates zero-migration logic overrides by swapping out the host-managed WASM engine reference.

### Round Management

#### `create_round(env: Env, admin: Address, name: Symbol, token_address: Address, start_time: u64, end_time: u64) -> u64`
Spawns a new independent funding ecosystem linked to a dedicated asset token ledger. Returns the auto-incremented `round_id`.

#### `approve_project(env: Env, admin: Address, round_id: u64, project_id: u64)`
Whitelists an active project profile identifier to receive match-allocations inside a targeted matching cycle.

#### `finalize_round(env: Env, admin: Address, round_id: u64)`
Locks down a historical matching round once its epoch timestamp is passed. Prevents incoming secondary capital funding or contribution logging.

### Distribution & Computations

#### `fund_pool(env: Env, funder: Address, round_id: u64, amount: i128)`
Transfers large matching grants directly from a matching partner account into the contract's vault to build out the matching pool capital.

#### `record_contribution(env: Env, round_id: u64, project_id: u64, contributor: Address, amount: i128)`
Logs incoming retail votes/donations directly onto the persistent storage layer to track community signaling data.

#### `distribute_matching_funds(env: Env, admin: Address, round_id: u64, project_owners: Vec<Address>) -> i128`
Calculates the final quadratic weights via `compute_qf_score`, executes the transfer payouts to the provided project vectors, and flushes the pool matching balances.

## 📊 Read-Only State Resolvers

Integration developers can utilize these view methods to query on-chain data points without paying transaction execution fees:
```rust
pub fn get_round(env: Env, round_id: u64) -> Result<RoundData, MatchingPoolError>;
pub fn get_pool_balance(env: Env, round_id: u64) -> Result<i128, MatchingPoolError>;
pub fn get_round_status(env: Env, round_id: u64) -> Result<Symbol, MatchingPoolError>;
pub fn get_project_qf_score(env: Env, round_id: u64, project_id: u64) -> Result<i128, MatchingPoolError>;
pub fn preview_distribution(env: Env, round_id: u64) -> Result<Vec<i128>, MatchingPoolError>;
pub fn get_project_contributions(env: Env, round_id: u64, project_id: u64) -> Result<i128, MatchingPoolError>;
pub fn get_contributor_count(env: Env, round_id: u64, project_id: u64) -> Result<u32, MatchingPoolError>;
pub fn get_admin(env: Env) -> Result<Address, MatchingPoolError>;
```