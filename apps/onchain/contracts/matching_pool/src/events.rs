use soroban_sdk::{contractevent, Address, Symbol};

use crate::storage::PoolScope;

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

/// Emitted when a specific action scope is paused by an admin.
/// Observers can use `scope` to identify which subsystem was halted.
#[contractevent]
pub struct ScopePausedEvent {
    /// The admin address that triggered the pause.
    #[topic]
    pub admin: Address,
    /// The domain that was paused (Contributions, Payouts, or Governance).
    #[topic]
    pub scope: PoolScope,
}

/// Emitted when a specific action scope is unpaused by an admin.
/// Observers can use `scope` to identify which subsystem was resumed.
#[contractevent]
pub struct ScopeUnpausedEvent {
    /// The admin address that triggered the unpause.
    #[topic]
    pub admin: Address,
    /// The domain that was unpaused (Contributions, Payouts, or Governance).
    #[topic]
    pub scope: PoolScope,
}
