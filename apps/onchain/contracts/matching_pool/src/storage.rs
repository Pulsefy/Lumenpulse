use soroban_sdk::{contracttype, Address, Symbol};

/// Storage keys for the matching pool contract
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Paused,
    NextRoundId,
    Round(u64),                           // round_id -> RoundData
    RoundPool(u64),                       // round_id -> i128 (pool balance)
    EligibleProject(u64, u64),            // (round_id, project_id) -> bool
    EligibleProjectCount(u64),            // round_id -> u32
    EligibleProjectAt(u64, u32),          // (round_id, index) -> u64 (project_id)
    ProjectContributions(u64, u64),       // (round_id, project_id) -> i128
    ProjectContributorCount(u64, u64),    // (round_id, project_id) -> u32
    ProjectContributor(u64, u64, u32),    // (round_id, project_id, index) -> Address
    ContributorAmount(u64, u64, Address), // (round_id, project_id, contributor) -> i128
    MatchDistributed(u64),                // round_id -> bool
    RoundStatus(u64),                     // round_id -> Symbol ("ACTIVE"|"FINALIZED"|"DISTRIBUTED")
    /// Contribution cap configuration for a round
    RoundCapConfig(u64),                  // round_id -> CapConfig
    /// Tracks total contributions across all projects in a round per contributor
    ContributorRoundTotal(u64, Address),  // (round_id, contributor) -> i128
}

/// Core data for a funding round
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RoundData {
    pub id: u64,
    pub name: Symbol,
    pub token_address: Address,
    pub start_time: u64,
    pub end_time: u64,
    pub total_pool: i128,
    pub is_finalized: bool,
    pub is_distributed: bool,
}

/// Configurable contribution cap settings for a round.
///
/// - `round_total_cap`: Maximum total contributions the round can accept (0 = unlimited).
/// - `per_contributor_cap`: Maximum total a single contributor can give across all
///   projects in the round (0 = unlimited). This is the anti-whale guardrail.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CapConfig {
    pub round_total_cap: i128,
    pub per_contributor_cap: i128,
}

