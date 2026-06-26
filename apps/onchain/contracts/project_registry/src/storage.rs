use soroban_sdk::{contracttype, Address, Symbol};

/// Verification status of a project
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum VerificationStatus {
    Pending,
    Verified,
    Rejected,
}

/// How voter weight is determined
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum WeightMode {
    /// Weight = contributor reputation_score read from contributor_registry
    Reputation,
    /// Weight = token balance of the governance token
    TokenBalance,
    /// Weight = flat 1 per registered contributor (one-address-one-vote)
    Flat,
}

/// Per-project registry entry
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectEntry {
    pub project_id: u64,
    pub owner: Address,
    pub name: Symbol,
    pub status: VerificationStatus,
    pub votes_for: i128,
    pub votes_against: i128,
    pub registered_at: u64,
    pub resolved_at: u64, // 0 = unresolved
}

/// Global config set at initialization
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RegistryConfig {
    /// Minimum total weight-for needed to reach Verified
    pub quorum_threshold: i128,
    /// Weight mode used for all votes
    pub weight_mode: WeightMode,
    /// Optional governance token address (used when weight_mode = TokenBalance)
    pub governance_token: Option<Address>,
    /// Optional contributor_registry contract address (used for Reputation/Flat)
    pub contributor_registry: Option<Address>,
    /// Minimum weight a voter must have to cast a vote
    pub min_voter_weight: i128,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Paused,
    Config,
    Project(u64),              // project_id -> ProjectEntry
    VoteCast(u64, Address),    // (project_id, voter) -> bool
    VoterWeight(u64, Address), // (project_id, voter) -> i128 (recorded at vote time)
}
