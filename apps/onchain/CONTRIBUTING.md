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

### Import Order
```rust
// 1. External crates
use soroban_sdk::{contract, contractimpl, Env};

// 2. Internal modules (if any)
// use crate::types::*;

// 3. Module declarations
mod test;
```

---

## 💾 Soroban Storage Durability & TTL Policy

Soroban storage entries expire unless explicitly extended (`extend_ttl` / `bump`). To prevent contract bricking while optimizing transaction fees, all contracts follow a unified storage durability policy.

### 1. Storage Durability Classes

- **Instance Storage (`env.storage().instance()`)**:
  - **Usage**: Used for contract singletons, global parameters, admin addresses, pause flags, counters, and global configuration.
  - **Lifecycle**: Tied directly to the contract instance code. If instance storage expires, the entire contract instance becomes inactive.
  - **Threshold**: `INSTANCE_TTL_THRESHOLD` = 120,960 ledgers (~7 days)
  - **Bump Amount**: `INSTANCE_BUMP_AMOUNT` = 518,400 ledgers (~30 days)
  - **Strategy**: Instance TTL must be bumped on initialization and extended on all mutating/administrative entry points.

- **Persistent Storage (`env.storage().persistent()`)**:
  - **Usage**: Used for long-lived application state (user balances, user profiles, active projects, rounds, proposals, stream data, allowances, subscriptions).
  - **Lifecycle**: Persists as long as TTL is extended. Can be restored from archive if expired, but active entries must be bumped to maintain seamless contract operation.
  - **Threshold**: `PERSISTENT_TTL_THRESHOLD` = 120,960 ledgers (~7 days)
  - **Bump Amount**: `PERSISTENT_BUMP_AMOUNT` = 518,400 ledgers (~30 days)
  - **Strategy**: Extended via `.extend_ttl(&key, threshold, bump)` on state writes and active reads.

- **Temporary Storage (`env.storage().temporary()`)**:
  - **Usage**: Used for short-lived, transient state (registration nonces, ephemeral voting flags within active windows, idempotency tokens, short-term locks).
  - **Lifecycle**: Automatically reclaimed by the network after expiration. Cannot be restored from archive.
  - **Threshold**: `TEMPORARY_TTL_THRESHOLD` = 17,280 ledgers (~1 day)
  - **Bump Amount**: `TEMPORARY_BUMP_AMOUNT` = 120,960 ledgers (~7 days)
  - **Strategy**: Created with default TTL and extended when verified within active operational windows.

---

## 📦 Storage Entry Inventory across Contracts

Below is the inventory of all storage entries across the 21 crates in `contracts/`, classified by durability class:

| Contract Crate | Data Key / Entry | Durability Class | Description |
| :--- | :--- | :--- | :--- |
| **`aave_lending_pool`** | `Admin` | Instance | Privileged pool administrator address |
| | `Reserve(Address)` | Persistent | Reserve asset deposit balance |
| | `ATokenSupply(Address)` | Persistent | Total aTokens minted for reserve asset |
| | `UserATokenBalance(user, asset)` | Persistent | User interest-bearing token balance |
| | `UserDepositTimestamp(user, asset)`| Persistent | Timestamp of user deposit for interest calculation |
| | `TotalDebt(asset)` | Persistent | Asset debt tracking for utilization calculation |
| | `LastAccrualTime(asset)` | Persistent | Last interest accrual timestamp |
| **`contributor_registry`** | `Admin` | Instance | Superadmin / multisig address |
| | `MultisigConfig`, `NextProposalId` | Instance | Multisig threshold & proposal ID counter |
| | `Contributor(Address)` | Persistent | Contributor user profile & reputation data |
| | `GitHubIndex(String)` | Persistent | GitHub handle to address lookup index |
| | `Proposal(u64)` | Persistent | Multisig governance proposal record |
| | `Badges(Address)` | Persistent | Assigned contributor achievement badges |
| | `ReputationPenalty(Address)` | Persistent | Contributor penalty audit record |
| | `RegistrationNonce(Address)` | Temporary | Gasless registration replay prevention nonce |
| **`crowdfund_vault`** | `Admin`, `StorageVersion`, `ProtocolStats`, `NextProjectId`, `Paused`, `FeeBps`, `Treasury`, `Subscribers` | Instance | Global vault configuration, stats & singletons |
| | `Project(u64)`, `ProjectBalance(u64, Address)`, `ProjectMilestoneExpiry(u64)`, `ProjectRefundWindowDeadline(u64)` | Persistent | Project metadata, balances, milestone deadlines |
| | `MilestoneApproved`, `MilestoneDisputed`, `MilestoneDispute`, `MilestoneVote`, `MilestoneVotesFor`, `MilestoneVotesAgainst`, `MilestoneVoteWindow` | Persistent | Milestone status & governance voting records |
| | `Contribution(u64, Address)`, `ContributorCount(u64)`, `Contributor(u64, u32)` | Persistent | Project contribution tracking & contributor lists |
| | `MatchingPool`, `RewardPool`, `RegisteredContributor`, `Reputation`, `ProjectStatus`, `YieldProvider`, `ProjectInvestedBalance`, `RefundReceipt`, `RefundReceiptCount`, `RefundClaimed` | Persistent | Pool allocations, reputation scores, refund receipts |
| **`feature_flags`** | `Admin`, `Paused`, `FlagList` | Instance | Admin, pause flag, and registered flag symbol list |
| | `Flag(Symbol)` | Persistent | Feature flag entry details (enabled state, toggled_by, timestamp) |
| **`idempotency-guard`** | `ExecutionReceipt(BytesN<32>)` | Persistent | Unique request ID execution receipt |
| **`liquidity_pool`** | `Admin`, `Token0`, `Token1` | Instance | Pool admin and asset token addresses |
| | `Reserve0`, `Reserve1`, `LPSupply`, `UserLPBalance(Address)`, `AccruedFees0`, `AccruedFees1`, `LastFeeAccrual` | Persistent | AMM token reserves, LP token supply, user balances, fee tracking |
| **`lumen_token`** | `Admin` | Instance | Token administrator address |
| | `Allowance(AllowanceDataKey)`, `Balance(Address)`, `TokenMetadata` | Persistent | Token balances, allowances, and metadata |
| **`lumenpulse-curation`** | `Admin`, `DepositToken`, `ContributorRegistry`, `NextProjectId` | Instance | Curation contract admin & target contract addresses |
| | `Proposal(u64)`, `VoteRecord(u64, Address)` | Persistent | Curation proposals and voter records |
| | `VotedFlag(u64, Address)` | Temporary | Ephemeral voting flag per proposal |
| **`matching_pool`** | `Admin`, `Paused`, `NextRoundId` | Instance | Matching pool admin, pause state, round counter |
| | `Round(u64)`, `RoundPool(u64)`, `EligibleProject`, `EligibleProjectCount`, `EligibleProjectAt`, `ProjectContributions`, `ProjectContributorCount`, `ProjectContributor`, `ContributorAmount`, `MatchDistributed`, `RoundStatus`, `FinalizedAt` | Persistent | Quadratic funding rounds, project eligibility, contributions, match distribution |
| **`notification_broker`**| `Admin` | Instance | Broker admin address |
| | `Subscription(listener, source, event_type)`, `ListenersForSource(source)` | Persistent | Cross-contract notification subscriptions & listener dispatch index |
| **`notification_interface`**| N/A | Trait Only | Interface definition crate (no storage entries) |
| **`pricing_adapter`** | `Admin` | Instance | Oracle adapter admin address |
| | `AssetPrice(Address)`, `AssetOracle(Address)`, `AssetDecimals(Address)` | Persistent | Oracle prices, external oracle targets, asset decimals |
| **`project_registry`** | `Admin`, `Paused`, `Config` | Instance | Registry admin, pause state, quorum & weight config |
| | `Project(u64)`, `VoteCast(u64, Address)`, `VoterWeight(u64, Address)` | Persistent | Verification status, vote tallies, voter weights |
| **`protocol_registry`** | `Admin`, `Paused` | Instance | Protocol registry admin and pause status |
| | `Module(Symbol)` | Persistent | Deployed protocol module entries (address, version, status) |
| **`reentrancy-guard`** | `REENTRANCY_KEY` | Instance | Temporary reentrancy lock symbol in instance storage |
| **`stable_swap_pool`** | `Admin`, `TokenA`, `TokenB` | Instance | Stable swap pool admin and asset tokens |
| | `ReserveA`, `ReserveB`, `LPSupply`, `UserLPBalance(Address)` | Persistent | Stable swap reserves and LP balances |
| **`tests`** | N/A | Test Workspace | Integration test suite crate |
| **`treasury`** | `Admin`, `Token`, `MultisigConfig`, `NextProposalId` | Instance | Treasury admin, token target, multisig configuration |
| | `Stream(Address)`, `Proposal(u64)` | Persistent | Linear streaming schedules & treasury proposals |
| **`upgradable-contract`**| `Admin`, `Counter`, `NextOperationId` | Instance | Timelock admin, counter, next operation ID |
| | `QueuedOperation(u32)` | Persistent | Timelocked contract upgrade & admin operations |
| **`vesting-wallet`** | `Admin`, `Token` | Instance | Vesting wallet admin & token contract address |
| | `Vesting(Address)`, `Delegates(Address)` | Persistent | Beneficiary vesting schedules & delegated claimers |
| **`yield_vault`** | `Admin`, `Asset`, `ProviderCount`, `TotalAUM`, `TotalYieldHarvested` | Instance | Yield vault admin, asset address, provider count & metrics |
| | `Provider(u32)`, `UserBalance(Address)`, `UserProviderAllocation(Address, u32)` | Persistent | Yield provider integrations, user deposits, allocations |