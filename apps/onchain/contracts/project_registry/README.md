# LumenPulse Project Registry Contract

This Soroban smart contract handles the community-driven validation and vetting matrix for new projects submitted to the **LumenPulse** news aggregation and portfolio platform. 

By tracking user consensus weights across customizable evaluation modes, it prevents malicious listings or spam data streams from degrading the ecosystem analytics layers.

---

## 🚀 Testnet Deployment Specifications

This contract is deployed, initialized, and operational on the **Stellar Testnet**.

| Parameter | Value |
| :--- | :--- |
| **Contract ID** | 'CBYFZU7C5TV2J56PEOXI5Q53HNFYFOW4USEBG4M6BCV7RUIMJI7JISLC' |
| **WASM Build Hash** | '847355767f5f67e68eb46cd2533c16718ac4cd5f37ae298227bb2e98419579cf' |
| **Network Context** | Stellar Testnet |
| **Admin Public Key** | 'GA5TBSBGERHVMEFBJGEM3KYMRLWO73Y2QRAV6P66GPEBOJ5ZMJUT7LLY' |
| **Deployment Transaction** | 'ac66ca21afb59b99853a5f82c3136e5f163ca0925896f1b3ea200813ab86b4c8' |
| **Initialization Transaction** | 'ab2bef2dab7d3501ee9b39c4df49c5864ba3fd148bd4c0889f6be672860050a5' |

### System Configurations (Runtime Constants)
* **Quorum Threshold:** '100' (Total collective weight required to finalize a verification or rejection)
* **Weight Mode:** 'Flat' (Simple baseline voting structure where eligible participants carry equal weight)
* **Governance Token Mapping:** `None` ('null' configuration variant)
* **Contributor Registry Mapping:** `None` ('null' configuration variant)
* **Minimum Participating Voter Weight:** '1'

### Ledger Explorers
* **Deployment Trace:** [Stellar.Expert | Tx ac66ca21afb59b...](https://stellar.expert/explorer/testnet/tx/ac66ca21afb59b99853a5f82c3136e5f163ca0925896f1b3ea200813ab86b4c8)
* **Initialization Trace:** [Stellar.Expert | Tx ab2bef2dab7d35...](https://stellar.expert/explorer/testnet/tx/ab2bef2dab7d3501ee9b39c4df49c5864ba3fd148bd4c0889f6be672860050a5)
* **Contract Interface Interactor:** [Stellar Laboratory Live Link](https://lab.stellar.org/r/testnet/contract/CBYFZU7C5TV2J56PEOXI5Q53HNFYFOW4USEBG4M6BCV7RUIMJI7JISLC)

---

## 💻 Core Functional Interface

```rust
pub fn initialize(env: Env, admin: Address, quorum_threshold: i128, weight_mode: WeightMode, governance_token: Option<Address>, contributor_registry: Option<Address>, min_voter_weight: i128) -> Result<(), RegistryError>;
pub fn register_project(env: Env, owner: Address, project_id: u64, name: Symbol) -> Result<(), RegistryError>;
pub fn cast_vote(env: Env, voter: Address, project_id: u64, support: bool) -> Result<VerificationStatus, RegistryError>;
pub fn override_verification(env: Env, admin: Address, project_id: u64, verified: bool) -> Result<(), RegistryError>;
```

---