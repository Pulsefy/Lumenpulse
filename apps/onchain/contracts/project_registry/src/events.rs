use soroban_sdk::{contractevent, Address, BytesN, Symbol};

#[contractevent]
pub struct InitializedEvent {
    pub admin: Address,
}

#[contractevent]
pub struct ProjectRegisteredEvent {
    #[topic]
    pub project_id: u64,
    pub owner: Address,
    pub name: Symbol,
}

#[contractevent]
pub struct VoteCastEvent {
    #[topic]
    pub project_id: u64,
    pub voter: Address,
    pub weight: i128,
    pub support: bool,
}

#[contractevent]
pub struct ProjectVerifiedEvent {
    #[topic]
    pub project_id: u64,
    pub votes_for: i128,
    pub votes_against: i128,
}

#[contractevent]
pub struct ProjectRejectedEvent {
    #[topic]
    pub project_id: u64,
    pub votes_for: i128,
    pub votes_against: i128,
}

#[contractevent]
pub struct VerificationOverriddenEvent {
    #[topic]
    pub project_id: u64,
    pub admin: Address,
    pub verified: bool,
}

/// Event emitted when an admin action is queued for timelock execution
#[contractevent]
pub struct AdminActionQueuedEvent {
    pub admin: Address,
    pub action: Symbol,
    pub proposal_id: BytesN<32>,
}

/// Event emitted when config is updated
#[contractevent]
pub struct ConfigUpdatedEvent {
    pub admin: Address,
    pub quorum_threshold: i128,
    pub min_voter_weight: i128,
}

/// Event emitted when contract is paused
#[contractevent]
pub struct ContractPausedEvent {
    pub admin: Address,
}

/// Event emitted when contract is unpaused
#[contractevent]
pub struct ContractUnpausedEvent {
    pub admin: Address,
}

/// Event emitted when admin is changed
#[contractevent]
pub struct AdminChangedEvent {
    pub old_admin: Address,
    pub new_admin: Address,
}

/// Event emitted when contract is upgraded
#[contractevent]
pub struct ContractUpgradedEvent {
    pub admin: Address,
    pub new_wasm_hash: BytesN<32>,
}
