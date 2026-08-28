use soroban_sdk::{contracttype, Address, Symbol};

/// Named pause scopes.
///
/// Each scope independently controls a category of state-changing operations:
///
/// - `Contribution` — blocks `record_contribution` and `fund_pool`.
/// - `Payout`       — blocks `distribute_matching_funds`.
/// - `Governance`   — blocks `create_round`, `finalize_round`, `approve_project`,
///                    `remove_project`, `set_round_cap`, `set_admin`, and `upgrade`.
///
/// Read-only queries (`get_round`, `get_pool_balance`, `get_round_status`, …)
/// are never blocked by any scope.
///
/// The legacy `Paused` key is kept for backward-compatibility; it is treated as
/// "all scopes paused" by the old `require_not_paused` helper which is no longer
/// called directly — callers use the scoped helpers instead.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum PauseScope {
    Contribution = 1,
    Payout = 2,
    Governance = 3,
}

/// Storage keys for the matching pool contract
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    /// Legacy global-pause flag (kept for storage-layout compatibility).
    Paused,
    /// Granular pause scope flags — one per `PauseScope` variant.
    ScopePaused(PauseScope),
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
    RoundCap(u64),                        // round_id -> i128 (0 = uncapped)
    ContributorRoundTotal(u64, Address), // (round_id, contributor) -> i128 (cumulative across all projects)
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
