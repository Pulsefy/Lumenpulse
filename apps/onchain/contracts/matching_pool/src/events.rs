use soroban_sdk::{contractevent, Address, Symbol};

#[contractevent]
pub struct InitializedEvent {
    pub admin: Address,
}

#[contractevent]
pub struct RoundCreatedEvent {
    #[topic]
    pub admin: Address,
    pub round_id: u64,
    pub name: Symbol,
    pub start_time: u64,
    pub end_time: u64,
}

#[contractevent]
pub struct PoolFundedEvent {
    #[topic]
    pub funder: Address,
    #[topic]
    pub round_id: u64,
    pub amount: i128,
}

#[contractevent]
pub struct ProjectApprovedEvent {
    #[topic]
    pub round_id: u64,
    pub project_id: u64,
}

#[contractevent]
pub struct ProjectRemovedEvent {
    #[topic]
    pub round_id: u64,
    pub project_id: u64,
}

#[contractevent]
pub struct ContributionRecordedEvent {
    #[topic]
    pub round_id: u64,
    #[topic]
    pub project_id: u64,
    pub contributor: Address,
    pub amount: i128,
}

#[contractevent]
pub struct RoundFinalizedEvent {
    #[topic]
    pub round_id: u64,
    pub admin: Address,
    pub finalized_at: u64,
}

#[contractevent]
pub struct MatchDistributedEvent {
    #[topic]
    pub round_id: u64,
    pub project_id: u64,
    pub match_amount: i128,
}

#[contractevent]
pub struct AllMatchesDistributedEvent {
    #[topic]
    pub round_id: u64,
    pub total_distributed: i128,
}

#[contractevent]
pub struct RoundCapUpdatedEvent {
    #[topic]
    pub admin: Address,
    #[topic]
    pub round_id: u64,
    pub cap: i128,
}

/// Emitted whenever the pause state of a specific scope changes.
///
/// `scope` identifies which subsystem was affected:
///  - `1` → Contribution (fund_pool, record_contribution)
///  - `2` → Payout (distribute_matching_funds)
///  - `3` → Governance (create_round, finalize_round, approve/remove project, …)
///
/// `paused` is the **new** state after the call.
#[contractevent]
pub struct ScopePauseChangedEvent {
    #[topic]
    pub admin: Address,
    /// Numeric discriminant of `PauseScope`.
    pub scope: u32,
    /// `true` = scope is now paused; `false` = scope is now unpaused.
    pub paused: bool,
    pub timestamp: u64,
}

/// Emitted when the admin role is transferred.
#[contractevent]
pub struct AdminChangedEvent {
    #[topic]
    pub old_admin: Address,
    #[topic]
    pub new_admin: Address,
}

/// Emitted when the contract WASM is upgraded.
#[contractevent]
pub struct UpgradedEvent {
    #[topic]
    pub admin: Address,
    pub new_wasm_hash: soroban_sdk::BytesN<32>,
}

/// Emitted when the global contract pause state changes.
#[contractevent]
pub struct ContractPauseEvent {
    #[topic]
    pub admin: Address,
    pub paused: bool,
}
