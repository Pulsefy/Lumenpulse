use soroban_sdk::{contractevent, Address};

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InitializedEvent {
    pub admin: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectCreatedEvent {
    #[topic]
    pub owner: Address,
    #[topic]
    pub token_address: Address,
    pub project_id: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DepositEvent {
    #[topic]
    pub user: Address,
    #[topic]
    pub project_id: u64,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneApprovedEvent {
    #[topic]
    pub admin: Address,
    pub project_id: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WithdrawEvent {
    #[topic]
    pub owner: Address,
    #[topic]
    pub project_id: u64,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContributorRegisteredEvent {
    pub contributor: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReputationUpdatedEvent {
    #[topic]
    pub contributor: Address,
    pub old_reputation: i128,
    pub new_reputation: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractPauseEvent {
    #[topic]
    pub admin: Address,
    pub paused: bool,
    pub timestamp: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractUnpauseEvent {
    #[topic]
    pub admin: Address,
    pub paused: bool,
    pub timestamp: u64,
}

/// Emitted when the contract WASM is upgraded to a new hash.
#[contractevent]
pub struct UpgradedEvent {
    #[topic]
    pub admin: Address,
    pub new_wasm_hash: soroban_sdk::BytesN<32>,
}

/// Emitted when the admin role is transferred to a new address.
#[contractevent]
pub struct AdminChangedEvent {
    #[topic]
    pub old_admin: Address,
    pub new_admin: Address,
}

#[contractevent]
pub struct ProjectCanceledEvent {
    pub project_id: u64,
    pub caller: Address,
}

#[contractevent]
pub struct ContributionRefundedEvent {
    pub project_id: u64,
    pub contributor: Address,
    pub amount: i128,
}
