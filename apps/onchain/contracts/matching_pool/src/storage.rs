use soroban_sdk::{contracttype, Address, Symbol};

/// Granular pause domains for the matching pool contract.
/// Each scope can be paused independently, allowing maintainers to halt only
/// the affected subsystem without freezing the whole contract.
/// Read-only queries (get_*) are never gated by any scope.
///
/// - `Contributions`: blocks `fund_pool` and `record_contribution`.
/// - `Payouts`: blocks `finalize_round` and `distribute_matching_funds`.
/// - `Governance`: blocks `create_round`, `approve_project`, `remove_project`,
///   `set_admin`, and `upgrade`.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum PoolScope {
    /// Contribution inflows: `fund_pool` and `record_contribution`.
    Contributions = 1,
    /// Payout actions: `finalize_round` and `distribute_matching_funds`.
    Payouts = 2,
    /// Administrative governance: `create_round`, `approve_project`,
    /// `remove_project`, `set_admin`, and `upgrade`.
    Governance = 3,
}

/// Storage keys for the matching pool contract
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    /// Legacy global pause flag — retained for backward compatibility but no
    /// longer written by the contract. New code should use `ScopePaused`.
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
    FinalizedAt(u64),                     // round_id -> u64 (ledger timestamp when finalized)
    /// Stores a `bool` indicating whether the given scope is paused.
    ScopePaused(PoolScope),
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
