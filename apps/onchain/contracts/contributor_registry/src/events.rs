use soroban_sdk::{contractevent, Address, BytesN, String};

use crate::multisig::{ProposalAction, ProposalStatus};
use crate::storage::{Badge, PenaltySeverity};

#[contractevent]
pub struct UpgradedEvent {
    #[topic]
    pub admin: Address,
    pub new_wasm_hash: BytesN<32>,
}

#[contractevent]
pub struct AdminChangedEvent {
    #[topic]
    pub old_admin: Address,
    pub new_admin: Address,
}

#[contractevent]
pub struct ProposalCreatedEvent {
    #[topic]
    pub proposal_id: u64,
    pub proposer: Address,
    pub action: ProposalAction,
    pub weight_collected: u32,
    pub threshold: u32,
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
    pub action: ProposalAction,
}

#[contractevent]
pub struct ProposalCancelledEvent {
    #[topic]
    pub proposal_id: u64,
    pub cancelled_by: Address,
}

#[contractevent]
pub struct MultisigConfiguredEvent {
    #[topic]
    pub configured_by: Address,
    pub threshold: u32,
    pub signer_count: u32,
}

/// Emitted when a contributor is registered via a gasless (relayer-submitted)
/// meta-transaction.  Relayers and indexers can use this to track gasless
/// registrations separately from direct ones.
#[contractevent]
pub struct GaslessRegistrationEvent {
    #[topic]
    pub contributor: Address,
    pub github_handle: String,
    /// The nonce that was consumed by this registration.  The next valid nonce
    /// for this address is `consumed_nonce + 1`.
    pub consumed_nonce: u64,
}

#[contractevent]
pub struct BadgeGrantedEvent {
    #[topic]
    pub contributor: Address,
    pub badge: Badge,
    pub executor: Address,
}

#[contractevent]
pub struct BadgeRevokedEvent {
    #[topic]
    pub contributor: Address,
    pub badge: Badge,
    pub executor: Address,
}

#[contractevent]
pub struct ReputationPenaltyAppliedEvent {
    #[topic]
    pub contributor: Address,
    pub dispute_id: u64,
    pub severity: PenaltySeverity,
    pub points_deducted: u64,
    pub reason: String,
    pub executor: Address,
}
