# LumenPulse Contributor Registry Contract

This Soroban smart contract powers the community incentives, profile management, and data-verification engine for **LumenPulse**—a decentralized crypto news aggregator and portfolio management platform on the Stellar blockchain.

The `contributor_registry` handles identity management, reputation tracking tiers, multi-signature curation governance, and secure, gasless onboarding for contributors who submit market insights, news articles, and community ratings.

---

## 🚀 Testnet Deployment Specifications

This contract is deployed, initialized, and linked into the LumenPulse services stack on the **Stellar Testnet**.

| Parameter | Value |
| :--- | :--- |
| **Contract ID** | `CCOVDGHF3XQ5RAFY6DJ36G6CHQJF54QCOBZXCC3LBMKNEWQJLDGXQJSB` |
| **WASM Hash** | `4a25619b8fea02f3447e7b700e2f2b0ed575f62679006ddc981009b26d9d5e71` |
| **Network Context** | Stellar Testnet |
| **Platform Bootstrapper** | `GA5TBSBGERHVMEFBJGEM3KYMRLWO73Y2QRAV6P66GPEBOJ5ZMJUT7LLY` |
| **Admin M-of-N Threshold** | `1` |
| **Initial Signers Matrix**| `[{"address": "GA5TBSBGERHVMEFBJGEM3KYMRLWO73Y2QRAV6P66GPEBOJ5ZMJUT7LLY", "weight": 1}]` |

### Ledger Explorers
* **Transaction History:** [Stellar.Expert | Tx ab881e403b1f914a...](https://stellar.expert/explorer/testnet/tx/ab881e403b1f914ab602065b14481612f7b005145e30f1f374f418a38fd6d313)
* **Contract Interface Interactor:** [Stellar Laboratory Live Link](https://lab.stellar.org/r/testnet/contract/CCOVDGHF3XQ5RAFY6DJ36G6CHQJF54QCOBZXCC3LBMKNEWQJLDGXQJSB)

---

## 🛠 Architectural Engine Features

### 1. Gasless Onboarding Meta-Transactions (`register_contributor_with_sig`)
To remove friction for Web2 developers and content creators joining LumenPulse, the engine supports gasless registrations:
* A user signs an off-chain package containing their GitHub identity, public key, and sequence counter.
* The LumenPulse backend-api layer acts as a relayer, packaging the payload and paying the underlying XLM gas fees.
* The contract verifies the authenticity via `require_auth_for_args`, maintaining a dedicated `RegistrationNonce` mapping to avoid front-running or reply-attacks.

### 2. Reputation Tiering Matrix
LumenPulse gamifies content submission and vetting. Contributors accumulate standing points based on valid, high-sentiment submissions and platform activity:
* **`Novice`**: $0 - 9$ Points (Basic news submission & commenting privileges)
* **`Builder`**: $10 - 49$ Points (Access to advanced portfolio tools and priority feed filtering)
* **`Architect`**: $50 - 99$ Points (Higher content weightings on sentiment analytics)
* **`Core`**: $100+$ Points (Platform moderation capability and premium reward distribution weight)

### 3. Cross-Contract Event Bus (`NotificationReceiverTrait`)
The registry natively intercepts `deposit` message payloads broadcasted from separate active ecosystem contracts (such as the main portfolio reward pool or crowdfunding vaults). When a user locks or deposits assets inside a linked LumenPulse vault, this contract handles the signal, automatically scaling up the user's reputation index by $+1$ point per tracked on-chain interaction.

### 4. Admin Multi-Sig Proposal Pipeline
Modifying platform weights, adjusting incentive distributions, penalizing malicious/spam reporters, or hot-swapping operational parameters requires passing an on-chain verification consensus:
* **`propose`**: Initiates a formal governance payload structural edit (`ProposalAction`).
* **`sign`**: Mod team members apply cryptographic voting weights to active proposal IDs.
* **`consume_approval`**: Actions execute conditionally only when specified thresholds are fully satisfied.

---

## 💻 Smart Contract API Specifications

### System Initializers
```rust
pub fn initialize(env: Env, signers: Vec<Signer>, threshold: u32) -> Result<(), ContributorError>;
pub fn set_multisig_config(env: Env, executor: Address, proposal_id: u64, new_signers: Vec<Signer>, new_threshold: u32) -> Result<(), ContributorError>;
```

## Contributor Profile Lifecycle
```rust
pub fn register_contributor(env: Env, address: Address, github_handle: String) -> Result<(), ContributorError>;
pub fn register_contributor_with_sig(env: Env, github_handle: String, address: Address, signature: Bytes) -> Result<(), ContributorError>;
pub fn update_contributor(env: Env, address: Address, github_handle: String) -> Result<(), ContributorError>;
pub fn deregister_contributor(env: Env, address: Address) -> Result<(), ContributorError>;
```

## Internal Governance Workflow
```rust
pub fn propose(env: Env, proposer: Address, action: ProposalAction) -> Result<u64, ContributorError>;
pub fn sign(env: Env, signer: Address, proposal_id: u64) -> Result<ProposalStatus, ContributorError>;
pub fn cancel_proposal(env: Env, signer: Address, proposal_id: u64) -> Result<(), ContributorError>;
```

---