use soroban_sdk::{contractevent, Address, Symbol};

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
