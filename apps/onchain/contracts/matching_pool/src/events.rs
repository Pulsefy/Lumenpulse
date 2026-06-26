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
