use soroban_sdk::{contractevent, Address, Symbol};

use crate::quorum::{ProposalStatus, RegistryAction};

#[contractevent]
pub struct InitializedEvent {
    pub admin: Address,
}

#[contractevent]
pub struct ModuleRegisteredEvent {
    #[topic]
    pub name: Symbol,
    pub address: Address,
    pub version: u32,
}

#[contractevent]
pub struct ModuleUpdatedEvent {
    #[topic]
    pub name: Symbol,
    pub old_address: Address,
    pub new_address: Address,
    pub old_version: u32,
    pub new_version: u32,
}

#[contractevent]
pub struct ModuleDeactivatedEvent {
    #[topic]
    pub name: Symbol,
    pub admin: Address,
}

#[contractevent]
pub struct ModuleActivatedEvent {
    #[topic]
    pub name: Symbol,
    pub admin: Address,
}

#[contractevent]
pub struct AdminTransferredEvent {
    pub old_admin: Address,
    pub new_admin: Address,
}

// ── Multi-admin quorum lifecycle ──────────────────────────────────
// Every state transition is published so the approval trail for a privileged
// change is auditable off-chain without replaying storage.

#[contractevent]
pub struct QuorumConfiguredEvent {
    pub bootstrapper: Address,
    pub threshold: u32,
    pub signer_count: u32,
}

#[contractevent]
pub struct QuorumReconfiguredEvent {
    pub threshold: u32,
    pub signer_count: u32,
}

#[contractevent]
pub struct ProposalCreatedEvent {
    #[topic]
    pub proposal_id: u64,
    pub proposer: Address,
    pub action: RegistryAction,
    pub weight_collected: u32,
    pub threshold: u32,
    pub status: ProposalStatus,
}

#[contractevent]
pub struct SignatureCollectedEvent {
    #[topic]
    pub proposal_id: u64,
    pub signer: Address,
    pub weight_collected: u32,
    pub threshold: u32,
    pub status: ProposalStatus,
}

#[contractevent]
pub struct ProposalExecutedEvent {
    #[topic]
    pub proposal_id: u64,
    pub executor: Address,
    pub action: RegistryAction,
}

#[contractevent]
pub struct ProposalCancelledEvent {
    #[topic]
    pub proposal_id: u64,
    pub signer: Address,
}
