# LumenPulse — Smart Contract Interface Reference

> **Soroban SDK**: v23 · **Rust toolchain**: stable + `wasm32-unknown-unknown` target  
> Source: [`apps/onchain/contracts/`](../apps/onchain/contracts/)

This document provides a complete technical reference for every public function (WASM entrypoint), emitted event, error code, and storage layout across all Soroban smart contracts in the LumenPulse workspace.

---

## Table of Contents

1. [LumenToken](#1-lumentoken)
2. [CrowdfundVault](#2-crowdfundvault)
3. [ContributorRegistry](#3-contributorregistry)
4. [VestingWallet](#4-vestingwallet)
5. [UpgradableContract](#5-upgradablecontract)

---

## 1. LumenToken

**Crate**: `lumen_token` · **Contract struct**: `LumenToken`  
**Source**: [`contracts/lumen_token/src/`](../apps/onchain/contracts/lumen_token/src/)

A standard Soroban token following the SEP-41 token interface with admin-controlled minting, account freezing, and WASM upgrade capabilities.

### 1.1 Public Functions

#### `initialize`
```rust
pub fn initialize(e: Env, admin: Address, decimal: u32, name: String, symbol: String)
```
One-time initialization. Sets the admin, decimal precision, token name, and symbol. **Panics** if already initialized.

| Parameter | Type | Description |
|-----------|------|-------------|
| `admin` | `Address` | The initial administrator address |
| `decimal` | `u32` | Number of decimal places (e.g., `7`) |
| `name` | `String` | Human-readable token name |
| `symbol` | `String` | Token ticker symbol |

**Returns**: `()`  
**Auth**: None (one-time setup guard).

---

#### `mint`
```rust
pub fn mint(e: Env, to: Address, amount: i128)
```
Mint new tokens to an address. Admin-only.

| Parameter | Type | Description |
|-----------|------|-------------|
| `to` | `Address` | Recipient of minted tokens |
| `amount` | `i128` | Number of tokens to mint |

**Returns**: `()`  
**Auth**: Requires admin authorization.

---

#### `set_admin`
```rust
pub fn set_admin(e: Env, new_admin: Address)
```
Transfer the admin role. Emits [`AdminChangedEvent`](#14-events).

| Parameter | Type | Description |
|-----------|------|-------------|
| `new_admin` | `Address` | The new administrator address |

**Returns**: `()`  
**Auth**: Requires current admin authorization.

---

#### `freeze`
```rust
pub fn freeze(e: Env, id: Address)
```
Freeze an account, preventing it from sending, approving, or burning tokens.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `Address` | Account to freeze |

**Returns**: `()`  
**Auth**: Requires admin authorization.

---

#### `unfreeze`
```rust
pub fn unfreeze(e: Env, id: Address)
```
Unfreeze a previously frozen account.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `Address` | Account to unfreeze |

**Returns**: `()`  
**Auth**: Requires admin authorization.

---

#### `allowance`
```rust
pub fn allowance(e: Env, from: Address, spender: Address) -> i128
```
Query the remaining allowance a `spender` has from `from`.

**Returns**: `i128` — the current allowance amount.

---

#### `approve`
```rust
pub fn approve(e: Env, from: Address, spender: Address, amount: i128, expiration_ledger: u32)
```
Set an allowance for `spender` to spend `amount` of `from`'s tokens until `expiration_ledger`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `from` | `Address` | Token owner |
| `spender` | `Address` | Authorized spender |
| `amount` | `i128` | Maximum spend amount |
| `expiration_ledger` | `u32` | Ledger sequence after which the allowance expires |

**Returns**: `()`  
**Auth**: Requires `from` authorization. **Panics** if `from` is frozen.

---

#### `balance`
```rust
pub fn balance(e: Env, id: Address) -> i128
```
Query the token balance of `id`.

**Returns**: `i128` — the token balance.

---

#### `transfer`
```rust
pub fn transfer(e: Env, from: Address, to: Address, amount: i128)
```
Transfer tokens between accounts.

| Parameter | Type | Description |
|-----------|------|-------------|
| `from` | `Address` | Sender |
| `to` | `Address` | Recipient |
| `amount` | `i128` | Amount to transfer |

**Returns**: `()`  
**Auth**: Requires `from` authorization.

---

#### `transfer_from`
```rust
pub fn transfer_from(e: Env, spender: Address, from: Address, to: Address, amount: i128)
```
Transfer tokens on behalf of another account using a previously approved allowance.

| Parameter | Type | Description |
|-----------|------|-------------|
| `spender` | `Address` | The authorized spender |
| `from` | `Address` | Token owner |
| `to` | `Address` | Recipient |
| `amount` | `i128` | Amount to transfer |

**Returns**: `()`  
**Auth**: Requires `spender` authorization. **Panics** if `spender` is frozen or allowance is insufficient/expired.

---

#### `burn`
```rust
pub fn burn(e: Env, from: Address, amount: i128)
```
Burn tokens from the caller's own balance. Emits [`BurnEvent`](#14-events).

| Parameter | Type | Description |
|-----------|------|-------------|
| `from` | `Address` | Token holder |
| `amount` | `i128` | Amount to burn |

**Returns**: `()`  
**Auth**: Requires `from` authorization. **Panics** if `from` is frozen.

---

#### `burn_from`
```rust
pub fn burn_from(e: Env, spender: Address, from: Address, amount: i128)
```
Burn tokens from another account using an approved allowance. Emits [`BurnEvent`](#14-events).

| Parameter | Type | Description |
|-----------|------|-------------|
| `spender` | `Address` | The authorized spender |
| `from` | `Address` | Token holder |
| `amount` | `i128` | Amount to burn |

**Returns**: `()`  
**Auth**: Requires `spender` authorization. **Panics** if `spender` is frozen or allowance is insufficient/expired.

---

#### `decimals`
```rust
pub fn decimals(e: Env) -> u32
```
**Returns**: `u32` — the token's decimal precision.

---

#### `name`
```rust
pub fn name(e: Env) -> String
```
**Returns**: `String` — the token name.

---

#### `symbol`
```rust
pub fn symbol(e: Env) -> String
```
**Returns**: `String` — the token symbol.

---

#### `upgrade`
```rust
pub fn upgrade(e: Env, caller: Address, new_wasm_hash: BytesN<32>)
```
Upgrade the contract WASM. Emits [`UpgradedEvent`](#14-events).

| Parameter | Type | Description |
|-----------|------|-------------|
| `caller` | `Address` | Must match stored admin |
| `new_wasm_hash` | `BytesN<32>` | Hash of the new WASM binary |

**Returns**: `()`  
**Auth**: Requires admin authorization. **Panics** if `caller != admin`.

---

### 1.2 Events

| Event | Topics | Data | Emitted By |
|-------|--------|------|-----------|
| **`UpgradedEvent`** | `admin: Address` | `new_wasm_hash: BytesN<32>` | `upgrade` |
| **`AdminChangedEvent`** | `old_admin: Address` | `new_admin: Address` | `set_admin` |
| **`BurnEvent`** | `from: Address` | `amount: i128` | `burn`, `burn_from` |

### 1.3 Storage Layout

| Key | Tier | Type | Description |
|-----|------|------|-------------|
| `DataKey::Admin` | Instance | `Address` | Contract administrator |
| `DataKey::Decimals` | Instance | `u32` | Token decimal precision |
| `DataKey::Name` | Instance | `String` | Token name |
| `DataKey::Symbol` | Instance | `String` | Token symbol |
| `DataKey::Balance(Address)` | Persistent | `i128` | Token balance per account |
| `DataKey::State(Address)` | Persistent | `bool` | `true` = account is frozen |
| `DataKey::Allowance(AllowanceDataKey)` | Temporary | `AllowanceValue` | Spending allowance |
| `TSUPPLY` (Symbol) | Instance | `i128` | Total token supply counter |

**Custom Types**:

```rust
struct AllowanceDataKey { from: Address, spender: Address }
struct AllowanceValue  { amount: i128, expiration_ledger: u32 }
```

---

## 2. CrowdfundVault

**Crate**: `crowdfund_vault` · **Contract struct**: `CrowdfundVaultContract`  
**Source**: [`contracts/crowdfund_vault/src/`](../apps/onchain/contracts/crowdfund_vault/src/)

A full-featured crowdfunding platform with milestone-gated withdrawals, quadratic funding matching pool, contributor reputation, and emergency pause functionality.

### 2.1 Public Functions

#### Lifecycle

##### `initialize`
```rust
pub fn initialize(env: Env, admin: Address) -> Result<(), CrowdfundError>
```
One-time initialization. Sets admin, pause state to `false`, and project ID counter to `0`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `admin` | `Address` | The contract administrator |

**Returns**: `Ok(())` or `Err(AlreadyInitialized)`  
**Auth**: Requires `admin` authorization.  
**Emits**: `InitializedEvent`

---

##### `pause`
```rust
pub fn pause(env: Env, admin: Address) -> Result<bool, CrowdfundError>
```
Emergency pause. Prevents `create_project`, `deposit`, `start_milestone_vote`, and `withdraw`.

**Returns**: `Ok(true)` on success.  
**Auth**: Admin only.  
**Emits**: `ContractPauseEvent`

---

##### `unpause`
```rust
pub fn unpause(env: Env, admin: Address) -> Result<bool, CrowdfundError>
```
Unpause the contract after an emergency pause.

**Returns**: `Ok(true)` on success.  
**Auth**: Admin only.  
**Emits**: `ContractUnpauseEvent`

---

##### `upgrade`
```rust
pub fn upgrade(env: Env, caller: Address, new_wasm_hash: BytesN<32>) -> Result<(), CrowdfundError>
```
Upgrade the contract WASM hash.

**Auth**: Admin only.  
**Emits**: `UpgradedEvent`

---

##### `set_admin`
```rust
pub fn set_admin(env: Env, current_admin: Address, new_admin: Address) -> Result<(), CrowdfundError>
```
Transfer the admin role.

**Auth**: Requires current admin.  
**Emits**: `AdminChangedEvent`

---

#### Project Management

##### `create_project`
```rust
pub fn create_project(
    env: Env, owner: Address, name: Symbol,
    target_amount: i128, token_address: Address,
) -> Result<u64, CrowdfundError>
```
Create a new crowdfunding project. Auto-assigns an incrementing project ID.

| Parameter | Type | Description |
|-----------|------|-------------|
| `owner` | `Address` | Project owner who can withdraw funds |
| `name` | `Symbol` | Short project name |
| `target_amount` | `i128` | Fundraising goal |
| `token_address` | `Address` | The token for contributions |

**Returns**: `Ok(project_id)` — the assigned `u64` project ID.  
**Auth**: Requires `owner` authorization. **Fails** if paused or `target_amount <= 0`.  
**Emits**: `ProjectCreatedEvent`

---

##### `cancel_project`
```rust
pub fn cancel_project(env: Env, caller: Address, project_id: u64) -> Result<(), CrowdfundError>
```
Cancel an active project. Only the project owner or admin may call this.

**Auth**: Owner or admin.  
**Emits**: `ProjectCanceledEvent`

---

##### `refund_contributors`
```rust
pub fn refund_contributors(env: Env, project_id: u64, caller: Address) -> Result<(), CrowdfundError>
```
Refund all contributors of a canceled project. Iterates through all contributors and transfers their deposited tokens back.

**Auth**: Requires `caller` authorization. Project must be in `CANCELED` status.  
**Emits**: `ContributionRefundedEvent` (one per contributor refunded)

---

#### Funding

##### `deposit`
```rust
pub fn deposit(env: Env, user: Address, project_id: u64, amount: i128) -> Result<(), CrowdfundError>
```
Deposit tokens into a project. Tracks individual contributions for quadratic funding. Auto-registers new contributors.

| Parameter | Type | Description |
|-----------|------|-------------|
| `user` | `Address` | The contributor |
| `project_id` | `u64` | Target project |
| `amount` | `i128` | Contribution amount (must be > 0) |

**Auth**: Requires `user` authorization. **Fails** if paused, project inactive, or `amount <= 0`.  
**Emits**: `DepositEvent`

---

#### Milestone Approval (Voting)

##### `start_milestone_vote`
```rust
pub fn start_milestone_vote(env: Env, project_id: u64, milestone_id: u32, duration: u64) -> Result<(), CrowdfundError>
```
Initiate a community vote to approve a project milestone.

| Parameter | Type | Description |
|-----------|------|-------------|
| `project_id` | `u64` | Target project |
| `milestone_id` | `u32` | Milestone index |
| `duration` | `u64` | Voting window in seconds |

**Auth**: None (can be triggered by any interested party). **Fails** if paused or project inactive.  
**Emits**: `MilestoneVoteStartedEvent`

---

##### `vote_milestone`
```rust
pub fn vote_milestone(env: Env, voter: Address, project_id: u64, milestone_id: u32, support: bool) -> Result<(), CrowdfundError>
```
Cast a vote for or against a milestone. Voting power is proportional to the user's contribution weight.

**Auth**: Requires `voter` authorization. **Fails** if voter is not a contributor or if voting window is closed.  
**Emits**: `MilestoneVotedEvent`

---

##### `finalize_milestone_vote`
```rust
pub fn finalize_milestone_vote(env: Env, project_id: u64, milestone_id: u32) -> Result<(), CrowdfundError>
```
Close a voting window after it has expired. If more votes were cast FOR than AGAINST, the milestone is approved.

**Auth**: None (anyone can trigger finalization). **Fails** if voting window is still open.  
**Emits**: `MilestoneVoteFinalizedEvent`

---

##### `withdraw`
```rust
pub fn withdraw(env: Env, project_id: u64, amount: i128) -> Result<(), CrowdfundError>
```
Withdraw funds from a project. Requires prior milestone approval.

| Parameter | Type | Description |
|-----------|------|-------------|
| `project_id` | `u64` | Target project |
| `amount` | `i128` | Amount to withdraw (must be > 0) |

**Auth**: Requires project owner authorization. **Fails** if milestone not approved (via community vote), paused, or insufficient balance.  
**Emits**: `WithdrawEvent`

---

#### Quadratic Funding

##### `fund_matching_pool`
```rust
pub fn fund_matching_pool(env: Env, admin: Address, token_address: Address, amount: i128) -> Result<(), CrowdfundError>
```
Add tokens to the quadratic funding matching pool.

**Auth**: Admin only.

---

##### `calculate_match`
```rust
pub fn calculate_match(env: Env, project_id: u64) -> Result<i128, CrowdfundError>
```
Calculate matching funds for a project using the **quadratic funding formula**: `(Σ √contribution_i)²`. Uses fixed-point arithmetic with a `1e9` scaling factor for precision.

**Returns**: `Ok(match_amount)` — the calculated matching amount.

---

##### `distribute_match`
```rust
pub fn distribute_match(env: Env, project_id: u64) -> Result<i128, CrowdfundError>
```
Distribute calculated matching funds from the matching pool to the project balance. Distributes the minimum of the calculated match and the available pool balance.

**Returns**: `Ok(actual_match)` — the amount actually distributed.

---

#### Contributor Reputation

##### `register_contributor`
```rust
pub fn register_contributor(env: Env, contributor: Address) -> Result<(), CrowdfundError>
```
Register as a contributor. Initializes reputation to `0`.

**Auth**: Requires `contributor` authorization.  
**Emits**: `ContributorRegisteredEvent`

---

##### `update_reputation`
```rust
pub fn update_reputation(env: Env, admin: Address, contributor: Address, change: i128) -> Result<(), CrowdfundError>
```
Adjust a contributor's reputation score.

**Auth**: Admin only.  
**Emits**: `ReputationUpdatedEvent`

---

#### Read-Only Queries

| Function | Signature | Returns |
|----------|-----------|---------|
| `get_admin` | `(env) -> Result<Address, CrowdfundError>` | Admin address |
| `get_project` | `(env, project_id: u64) -> Result<ProjectData, CrowdfundError>` | Full project data |
| `get_balance` | `(env, project_id: u64) -> Result<i128, CrowdfundError>` | Project vault balance |
| `get_contribution` | `(env, project_id: u64, contributor: Address) -> Result<i128, CrowdfundError>` | Individual contribution |
| `get_contributor_count` | `(env, project_id: u64) -> Result<u32, CrowdfundError>` | Number of unique contributors |
| `get_total_contributions` | `(env, project_id: u64) -> Result<i128, CrowdfundError>` | Total deposited amount |
| `get_contributor_contribution` | `(env, project_id: u64, contributor: Address) -> Result<i128, CrowdfundError>` | Alias for `get_contribution` |
| `get_reputation` | `(env, contributor: Address) -> Result<i128, CrowdfundError>` | Contributor reputation score |
| `get_matching_pool_balance` | `(env, token_address: Address) -> Result<i128, CrowdfundError>` | Matching pool balance |
| `is_milestone_approved` | `(env, project_id: u64) -> Result<bool, CrowdfundError>` | Milestone approval status |
| `get_project_status` | `(env, project_id: u64) -> Result<Symbol, CrowdfundError>` | `"ACTIVE"` or `"CANCELED"` |
| `require_not_paused` | `(env) -> bool` | Current pause state |

---

### 2.2 Events

| Event | Topics | Data | Emitted By |
|-------|--------|------|-----------|
| **`InitializedEvent`** | — | `admin: Address` | `initialize` |
| **`ProjectCreatedEvent`** | `owner: Address`, `token_address: Address` | `project_id: u64` | `create_project` |
| **`DepositEvent`** | `user: Address`, `project_id: u64` | `amount: i128` | `deposit` |
| **`MilestoneVoteStartedEvent`** | `project_id: u64` | `milestone_id: u32`, `expiry: u64` | `start_milestone_vote` |
| **`MilestoneVotedEvent`** | `voter: Address`, `project_id: u64` | `milestone_id: u32`, `support: bool`, `weight: i128` | `vote_milestone` |
| **`MilestoneVoteFinalizedEvent`** | `project_id: u64` | `milestone_id: u32`, `approved: bool` | `finalize_milestone_vote` |
| **`WithdrawEvent`** | `owner: Address`, `project_id: u64` | `amount: i128` | `withdraw` |
| **`ContributorRegisteredEvent`** | — | `contributor: Address` | `register_contributor` |
| **`ReputationUpdatedEvent`** | `contributor: Address` | `old_reputation: i128`, `new_reputation: i128` | `update_reputation` |
| **`ContractPauseEvent`** | `admin: Address` | `paused: bool`, `timestamp: u64` | `pause` |
| **`ContractUnpauseEvent`** | `admin: Address` | `paused: bool`, `timestamp: u64` | `unpause` |
| **`UpgradedEvent`** | `admin: Address` | `new_wasm_hash: BytesN<32>` | `upgrade` |
| **`AdminChangedEvent`** | `old_admin: Address` | `new_admin: Address` | `set_admin` |
| **`ProjectCanceledEvent`** | — | `project_id: u64`, `caller: Address` | `cancel_project` |
| **`ContributionRefundedEvent`** | — | `project_id: u64`, `contributor: Address`, `amount: i128` | `refund_contributors` |

### 2.3 Error Codes

```rust
pub enum CrowdfundError {
    NotInitialized      = 1,
    AlreadyInitialized  = 2,
    Unauthorized        = 3,
    ProjectNotFound     = 4,
    MilestoneNotApproved = 5,
    InsufficientBalance = 6,
    ProjectNotActive    = 7,
    InvalidAmount       = 8,
    AlreadyRegistered   = 9,
    ContributorNotFound = 10,
    ContractPaused      = 11,
    ProjectAlreadyCanceled = 12,
    ProjectNotCancellable  = 13,
    RefundFailed        = 14,
    ContractNotPaused   = 15,
    VotingWindowNotClosed = 16,
    VotingWindowClosed    = 17,
    InsufficientContributionToVote = 18,
    MilestoneAlreadyApproved = 19,
    MilestoneAlreadyDisputed = 20,
    MilestoneEscrowed        = 21,
    MigrationRequired        = 22,
    InvalidRecipient         = 23,
}
```

### 2.4 Storage Layout

| Key | Tier | Type | Description |
|-----|------|------|-------------|
| `Admin` | Instance | `Address` | Contract administrator |
| `Paused` | Instance | `bool` | Emergency pause flag |
| `NextProjectId` | Instance | `u64` | Auto-incrementing project ID counter |
| `Project(u64)` | Persistent | `ProjectData` | Full project record |
| `ProjectBalance(u64, Address)` | Persistent | `i128` | Vault balance per project × token |
| `ProjectStatus(u64)` | Persistent | `Symbol` | `"ACTIVE"` or `"CANCELED"` |
| `MilestoneApproved(u64)` | Persistent | `bool` | Whether milestone is approved |
| `Contribution(u64, Address)` | Persistent | `i128` | Individual contribution amount |
| `ContributorCount(u64)` | Persistent | `u32` | Count of unique contributors |
| `Contributor(u64, u32)` | Persistent | `Address` | Contributor address by index |
| `MatchingPool(Address)` | Persistent | `i128` | Matching pool balance per token |
| `RegisteredContributor(Address)` | Persistent | `bool` | Whether address is registered |
| `Reputation(Address)` | Persistent | `i128` | Contributor reputation score |

**Custom Types**:

```rust
pub struct ProjectData {
    pub id: u64,
    pub owner: Address,
    pub name: Symbol,
    pub target_amount: i128,
    pub token_address: Address,
    pub total_deposited: i128,
    pub total_withdrawn: i128,
    pub is_active: bool,
}
```

---

## 3. ContributorRegistry

**Crate**: `contributor_registry` · **Contract struct**: `ContributorRegistryContract`  
**Source**: [`contracts/contributor_registry/src/`](../apps/onchain/contracts/contributor_registry/src/)

An on-chain registry that maps Stellar addresses to GitHub handles, tracks reputation scores, and ensures unique GitHub handle ownership.

### 3.1 Public Functions

#### `initialize`
```rust
pub fn initialize(env: Env, admin: Address) -> Result<(), ContributorError>
```
One-time initialization. Sets the admin.

**Auth**: Requires `admin` authorization.

---

#### `register_contributor`
```rust
pub fn register_contributor(env: Env, address: Address, github_handle: String) -> Result<(), ContributorError>
```
Register a new contributor with their GitHub handle. Initializes `reputation_score` to `0` and records the registration timestamp.

| Parameter | Type | Description |
|-----------|------|-------------|
| `address` | `Address` | The contributor's Stellar address |
| `github_handle` | `String` | GitHub username (must be non-empty and unique) |

**Auth**: Requires `address` authorization.  
**Errors**: `ContributorAlreadyExists`, `InvalidGitHubHandle`, `GitHubHandleTaken`

---

#### `update_contributor`
```rust
pub fn update_contributor(env: Env, address: Address, github_handle: String) -> Result<(), ContributorError>
```
Update an existing contributor's GitHub handle. Automatically re-indexes the GitHub → Address mapping.

**Auth**: Requires `address` authorization.  
**Errors**: `ContributorNotFound`, `InvalidGitHubHandle`, `GitHubHandleTaken`

---

#### `update_reputation`
```rust
pub fn update_reputation(env: Env, admin: Address, contributor_address: Address, delta: i64) -> Result<(), ContributorError>
```
Adjust a contributor's reputation score. Positive `delta` adds points; negative `delta` subtracts (floors at `0`).

| Parameter | Type | Description |
|-----------|------|-------------|
| `admin` | `Address` | Must match stored admin |
| `contributor_address` | `Address` | The contributor to update |
| `delta` | `i64` | Reputation change (positive or negative) |

**Auth**: Admin only.  
**Errors**: `ContributorNotFound`, `ReputationOverflow`

---

#### `upgrade`
```rust
pub fn upgrade(env: Env, caller: Address, new_wasm_hash: BytesN<32>) -> Result<(), ContributorError>
```
Upgrade the contract WASM. Admin only.

**Emits**: `UpgradedEvent`

---

#### `set_admin`
```rust
pub fn set_admin(env: Env, current_admin: Address, new_admin: Address) -> Result<(), ContributorError>
```
Transfer the admin role.

**Emits**: `AdminChangedEvent`

---

#### Read-Only Queries

| Function | Signature | Returns |
|----------|-----------|---------|
| `get_admin` | `(env) -> Result<Address, ContributorError>` | Admin address |
| `get_contributor` | `(env, address: Address) -> Result<ContributorData, ContributorError>` | Full contributor profile |
| `get_contributor_by_github` | `(env, github_handle: String) -> Result<ContributorData, ContributorError>` | Lookup by GitHub handle |
| `get_reputation` | `(env, contributor: Address) -> Result<u64, ContributorError>` | Reputation score |

---

### 3.2 Events

| Event | Topics | Data | Emitted By |
|-------|--------|------|-----------|
| **`UpgradedEvent`** | `admin: Address` | `new_wasm_hash: BytesN<32>` | `upgrade` |
| **`AdminChangedEvent`** | `old_admin: Address` | `new_admin: Address` | `set_admin` |

### 3.3 Error Codes

```rust
pub enum ContributorError {
    NotInitialized          = 1,
    AlreadyInitialized      = 2,
    Unauthorized            = 3,
    ContributorNotFound     = 4,
    ContributorAlreadyExists = 5,
    InvalidGitHubHandle     = 6,
    ReputationOverflow      = 7,
    GitHubHandleTaken       = 8,
}
```

### 3.4 Storage Layout

| Key | Tier | Type | Description |
|-----|------|------|-------------|
| `Admin` | Instance | `Address` | Contract administrator |
| `Contributor(Address)` | Persistent | `ContributorData` | Contributor profile |
| `GitHubIndex(String)` | Persistent | `Address` | Reverse index: GitHub handle → Address |

**Custom Types**:

```rust
pub struct ContributorData {
    pub address: Address,
    pub github_handle: String,
    pub reputation_score: u64,
    pub registered_timestamp: u64,
}
```

---

## 4. VestingWallet

**Crate**: `vesting-wallet` · **Contract struct**: `VestingWalletContract`  
**Source**: [`contracts/vesting-wallet/src/`](../apps/onchain/contracts/vesting-wallet/src/)

A linear token vesting contract. Admins create vesting schedules that unlock tokens proportionally over time. Beneficiaries can claim vested tokens at any point.

### 4.1 Public Functions

#### `initialize`
```rust
pub fn initialize(env: Env, admin: Address, token: Address) -> Result<(), VestingError>
```
One-time initialization. Sets admin and the token address used for all vesting schedules.

| Parameter | Type | Description |
|-----------|------|-------------|
| `admin` | `Address` | The contract administrator |
| `token` | `Address` | The token contract address for vested tokens |

**Auth**: Requires `admin` authorization.

---

#### `create_vesting`
```rust
pub fn create_vesting(
    env: Env, admin: Address, beneficiary: Address,
    amount: i128, start_time: u64, duration: u64,
) -> Result<(), VestingError>
```
Create a linear vesting schedule. Transfers `amount` tokens from admin to the contract. If a vesting already exists for the beneficiary, remaining unvested tokens are returned to admin before creating the new schedule.

| Parameter | Type | Description |
|-----------|------|-------------|
| `admin` | `Address` | Must match stored admin |
| `beneficiary` | `Address` | Recipient of vested tokens |
| `amount` | `i128` | Total tokens to vest (must be > 0) |
| `start_time` | `u64` | Unix timestamp when vesting begins (must be ≥ current time) |
| `duration` | `u64` | Vesting period in seconds (must be > 0) |

**Auth**: Admin only.  
**Emits**: `VestingCreatedEvent`

---

#### `claim`
```rust
pub fn claim(env: Env, beneficiary: Address) -> Result<i128, VestingError>
```
Claim available vested tokens. Calculates the linearly vested amount based on elapsed time and transfers unclaimed tokens.

**Vesting formula**:
- Before `start_time`: claimable = `0`
- After `start_time + duration`: claimable = `total_amount - claimed_amount`
- During vesting: claimable = `(total_amount × time_elapsed / duration) - claimed_amount`

**Returns**: `Ok(claimed_amount)` — the amount of tokens transferred.  
**Auth**: Requires `beneficiary` authorization.  
**Emits**: `TokensClaimedEvent`

---

#### Read-Only Queries

| Function | Signature | Returns |
|----------|-----------|---------|
| `get_admin` | `(env) -> Result<Address, VestingError>` | Admin address |
| `get_token` | `(env) -> Result<Address, VestingError>` | Token contract address |
| `get_vesting` | `(env, beneficiary: Address) -> Result<VestingData, VestingError>` | Full vesting schedule data |
| `get_claimable` | `(env, beneficiary: Address) -> Result<i128, VestingError>` | Currently claimable amount (view) |
| `get_available_amount` | `(env, beneficiary: Address) -> Result<i128, VestingError>` | Alias for `get_claimable` |

---

#### `upgrade`
```rust
pub fn upgrade(env: Env, caller: Address, new_wasm_hash: BytesN<32>) -> Result<(), VestingError>
```
Upgrade the contract WASM. Admin only.  
**Emits**: `UpgradedEvent`

---

#### `set_admin`
```rust
pub fn set_admin(env: Env, current_admin: Address, new_admin: Address) -> Result<(), VestingError>
```
Transfer the admin role.  
**Emits**: `AdminChangedEvent`

---

### 4.2 Events

| Event | Topics | Data | Emitted By |
|-------|--------|------|-----------|
| **`VestingCreatedEvent`** | `beneficiary: Address` | `amount: i128`, `start_time: u64`, `duration: u64` | `create_vesting` |
| **`TokensClaimedEvent`** | `beneficiary: Address` | `amount_claimed: i128`, `remaining: i128` | `claim` |
| **`UpgradedEvent`** | `admin: Address` | `new_wasm_hash: BytesN<32>` | `upgrade` |
| **`AdminChangedEvent`** | `old_admin: Address` | `new_admin: Address` | `set_admin` |

### 4.3 Error Codes

```rust
pub enum VestingError {
    NotInitialized      = 1,
    AlreadyInitialized  = 2,
    Unauthorized        = 3,
    VestingNotFound     = 4,
    InvalidAmount       = 5,
    InvalidDuration     = 6,
    InvalidStartTime    = 7,
    NothingToClaim      = 8,
    InsufficientBalance = 9,
}
```

### 4.4 Storage Layout

| Key | Tier | Type | Description |
|-----|------|------|-------------|
| `Admin` | Instance | `Address` | Contract administrator |
| `Token` | Instance | `Address` | Token contract used for vesting |
| `Vesting(Address)` | Persistent | `VestingData` | Vesting schedule per beneficiary |

**Custom Types**:

```rust
pub struct VestingData {
    pub beneficiary: Address,
    pub total_amount: i128,
    pub start_time: u64,
    pub duration: u64,
    pub claimed_amount: i128,
}
```

---

## 5. UpgradableContract

**Crate**: `upgradable-contract` · **Contract struct**: `UpgradableContract`  
**Source**: [`contracts/upgradable-contract/src/`](../apps/onchain/contracts/upgradable-contract/src/)

A minimal reference contract demonstrating the WASM upgrade pattern on Soroban with admin governance, state preservation across upgrades (counter), and admin rotation.

### 5.1 Public Functions

#### `init`
```rust
pub fn init(env: Env, admin: Address)
```
One-time initialization. Sets the admin. **Panics** if already initialized.

**Auth**: Requires `admin` authorization.

---

#### `upgrade`
```rust
pub fn upgrade(env: Env, caller: Address, new_wasm_hash: BytesN<32>)
```
Upgrade the contract WASM. **Panics** if `caller != admin`.

**Auth**: Admin only.  
**Emits**: `UpgradedEvent`

---

#### `set_admin`
```rust
pub fn set_admin(env: Env, current_admin: Address, new_admin: Address)
```
Transfer the admin role. **Panics** if `current_admin` doesn't match stored admin.

**Auth**: Requires `current_admin` authorization.  
**Emits**: `AdminChangedEvent`

---

#### `get_admin`
```rust
pub fn get_admin(env: Env) -> Address
```
**Returns**: `Address` — the current admin. **Panics** if not initialized.

---

#### `increment`
```rust
pub fn increment(env: Env) -> u32
```
Increment the on-chain counter and return the new value. Demonstrates state preservation across upgrades.

**Returns**: `u32` — the updated counter value.

---

#### `get_count`
```rust
pub fn get_count(env: Env) -> u32
```
**Returns**: `u32` — the current counter value (defaults to `0`).

---

#### `version`
```rust
pub fn version() -> u32
```
**Returns**: `u32` — the contract version identifier (currently `1`).

---

### 5.2 Events

| Event | Topics | Data | Emitted By |
|-------|--------|------|-----------|
| **`UpgradedEvent`** | `admin: Address` | `new_wasm_hash: BytesN<32>` | `upgrade` |
| **`AdminChangedEvent`** | `old_admin: Address` | `new_admin: Address` | `set_admin` |

### 5.3 Storage Layout

| Key | Tier | Type | Description |
|-----|------|------|-------------|
| `Admin` | Instance | `Address` | Contract administrator / upgrader |
| `Counter` | Instance | `u32` | Incrementing counter (persists across upgrades) |

---

## Appendix: Shared Patterns

All contracts share these common design patterns:

| Pattern | Description |
|---------|-------------|
| **One-time init guard** | `initialize` checks for existing `Admin` key before writing state |
| **Admin auth** | Functions that modify critical state call `require_auth()` on the admin address |
| **WASM upgradability** | `upgrade` + `UpgradedEvent` pattern using `env.deployer().update_current_contract_wasm()` |
| **Admin rotation** | `set_admin` + `AdminChangedEvent` for governance handoffs |
| **Result-based errors** | Vault, Registry, and Vesting use `Result<T, ContractError>` enums; Token and Upgradable use panics |

### Soroban Storage Tiers

| Tier | Lifetime | Usage |
|------|----------|-------|
| **Instance** | Contract lifetime (shared TTL) | Admin, config, counters — contract-global singletons |
| **Persistent** | Survives archival (extendable TTL) | Balances, project data, vesting schedules — user-specific data |
| **Temporary** | Auto-expires after TTL | Token allowances — ephemeral approvals |
