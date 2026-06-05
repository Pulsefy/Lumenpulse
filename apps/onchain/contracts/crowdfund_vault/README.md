# LumenPulse Crowdfund Vault Contract

This Soroban smart contract operates as the decentralized escrow, milestone-tracking, voting consensus, and notification routing engine for project fundraising campaigns within the **LumenPulse** ecosystem.

By leveraging Stellar's sub-second finality and low-cost execution, the `crowdfund_vault` protects both creators and backers. It secures committed capital in contract instances, programmatically unlocks milestones via administrative approval or contributor voting matrix structures, and exposes an event bus for real-time portfolio synchronization.

---

## 🚀 Testnet Deployment Specifications

This contract has been compiled, deployed, and successfully initialized on the **Stellar Testnet**.

| Parameter | Value |
| :--- | :--- |
| **Contract ID** | 'CBBQW7T65XBDPIPXEIIPJVJEEIBSPC566HMEU2LTBAULLKCNUFRFBKRO' |
| **WASM Build Hash** | '0ee5515ec21d8ff0b7f9d1620c343d866f29a146a7789d330327b1df8753ac38' |
| **Network Context** | Stellar Testnet |
| **Admin Public Key** | 'GA5TBSBGERHVMEFBJGEM3KYMRLWO73Y2QRAV6P66GPEBOJ5ZMJUT7LLY' |
| **Deployment Transaction** | 'de0665032d62febccdf276d9586792d516947f19c96d91871909c55637dcf125' |
| **Initialization Transaction** | 'b05b6bfb0c28ae51dd9f382dc9c5831552f65ad47405084392eadc3ec5d1397a' |

### Ledger Explorers
* **Deployment Trace:** [Stellar.Expert | Tx de0665032d62fe...](https://stellar.expert/explorer/testnet/tx/de0665032d62febccdf276d9586792d516947f19c96d91871909c55637dcf125)
* **Initialization Trace:** [Stellar.Expert | Tx b05b6bfb0c28ae...](https://stellar.expert/explorer/testnet/tx/b05b6bfb0c28ae51dd9f382dc9c5831552f65ad47405084392eadc3ec5d1397a)
* **Contract Interface Interactor:** [Stellar Laboratory Live Link](https://lab.stellar.org/r/testnet/contract/CBBQW7T65XBDPIPXEIIPJVJEEIBSPC566HMEU2LTBAULLKCNUFRFBKRO)

---

## 🛠 Architectural Engine Features

### 1. Milestone & Refund Expiry Lifecycle
Campaigns run deterministically based on time windows. If a project fails to hit milestones before the expiration thresholds, the core engine automatically flags the status as 'EXPIRED'.
* **Milestone Expiry Window:** Defaults to 30 days ('30 * 24 * 60 * 60' seconds).
* **Refund Window Availability:** Once a project is canceled or expired, backers have a 14-day window ('14 * 24 * 60 * 60' seconds) to process clawbacks before state reclamation triggers.

### 2. Multi-Subscriber Notification Bus (`NotificationReceiverClient`)
To maintain immediate backend and user interface updates, the contract implements a hook system to broadcast internal transactions:
* On call invocation of `deposit`, an serialized payload is built containing the user address, project ID, and token volume.
* The message is encoded using `to_xdr` and routed out to all active addresses registered in the `DataKey::Subscribers` collection.

### 3. Reentrancy Guard Protection
Methods handling asset transfers, user refunds, or external yield-bearing interactions use a local memory reentrancy locker (`acquire_reentrancy` / `release_reentrancy`). This prevents nested, opportunistic state manipulation loops from drain operations during block submission.

### 4. Continuous Storage Rent Upgrades
To protect operational persistent states against ledger space evictions, all critical structural entry updates (`create_project`, `deposit`, `approve_milestone`) call `extend_ttl` using unified `LEDGER_THRESHOLD` and `LEDGER_BUMP` bounds.

---

## 💻 Smart Contract API Specifications

### Core Lifecycles & Administrative Methods
```rust
pub fn initialize(env: Env, admin: Address) -> Result<(), CrowdfundError>;
pub fn migrate(env: Env, admin: Address) -> Result<u32, CrowdfundError>;
pub fn get_storage_version(env: Env) -> Result<u32, CrowdfundError>;
```

## Campaign & Asset Interactions
```rust
pub fn create_project(env: Env, owner: Address, name: Symbol, target_amount: i128, token_address: Address) -> Result<u64, CrowdfundError>;
pub fn cancel_project(env: Env, caller: Address, project_id: u64) -> Result<(), CrowdfundError>;
pub fn deposit(env: Env, user: Address, project_id: u64, amount: i128) -> Result<(), CrowdfundError>;
pub fn refund_contributors(env: Env, project_id: u64, caller: Address) -> Result<(), CrowdfundError>;
pub fn clawback_contribution(env: Env, project_id: u64, contributor: Address) -> Result<i128, CrowdfundError>;
```

## Governance Curation & Verification
```rust
pub fn approve_milestone(env: Env, admin: Address, project_id: u64, milestone_id: u32) -> Result<(), CrowdfundError>;
pub fn start_milestone_vote(env: Env, project_id: u64, milestone_id: u32, duration_seconds: u64) -> Result<(), CrowdfundError>;
pub fn vote_milestone(env: Env, voter: Address, project_id: u64, milestone_id: u32, support: bool) -> Result<(), CrowdfundError>;
```

## Notification Registration Routing
```rust
pub fn add_subscriber(env: Env, admin: Address, subscriber: Address) -> Result<(), CrowdfundError>;
pub fn remove_subscriber(env: Env, admin: Address, subscriber: Address) -> Result<(), CrowdfundError>;
```

---