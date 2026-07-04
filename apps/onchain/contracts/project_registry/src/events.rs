use soroban_sdk::{contractevent, Address, Symbol};

/// Emitted when the registry is initialized.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InitializedEvent {
    /// The address granted admin privileges.
    #[topic]
    pub admin: Address,
}

/// Emitted when a new project is registered.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectRegisteredEvent {
    /// The address of the project owner.
    #[topic]
    pub owner: Address,
    /// The unique identifier of the registered project.
    #[topic]
    pub project_id: u64,
    /// The name of the project.
    pub name: Symbol,
}

/// Emitted when a community member casts a vote on a project.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VoteCastEvent {
    /// The address of the voter.
    #[topic]
    pub voter: Address,
    /// The unique identifier of the project being voted on.
    #[topic]
    pub project_id: u64,
    /// The voting weight used.
    pub weight: i128,
    /// Whether the vote was in support (true) or against (false).
    pub support: bool,
}

/// Emitted when a project reaches the verification quorum.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectVerifiedEvent {
    /// The unique identifier of the verified project.
    #[topic]
    pub project_id: u64,
    /// The total weight of supportive votes.
    pub votes_for: i128,
    /// The total weight of votes against.
    pub votes_against: i128,
}

/// Emitted when a project is rejected by the community.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectRejectedEvent {
    /// The unique identifier of the rejected project.
    #[topic]
    pub project_id: u64,
    /// The total weight of supportive votes.
    pub votes_for: i128,
    /// The total weight of votes against.
    pub votes_against: i128,
}

/// Emitted when an admin overrides the verification status of a project.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerificationOverriddenEvent {
    /// The address of the admin performing the override.
    #[topic]
    pub admin: Address,
    /// The unique identifier of the project.
    #[topic]
    pub project_id: u64,
    /// The new verification status (true for verified, false for rejected).
    pub verified: bool,
}
