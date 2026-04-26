use soroban_sdk::{contracttype, Address, Symbol};

// TTL constants for Soroban storage rent management.
// LEDGER_THRESHOLD: if the remaining TTL falls below this value, extend it.
// LEDGER_BUMP: the new TTL to set when extending (≈30 days at 5 s/ledger).
pub const LEDGER_THRESHOLD: u32 = 100_000;
pub const LEDGER_BUMP: u32 = 518_400;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    StorageVersion,
    ProtocolStats,                    // -> ProtocolStats (instance storage)
    Project(u64),                     // -> ProjectData
    ProjectBalance(u64, Address),     // (project_id, token) -> i128
    ProjectMilestoneExpiry(u64),      // project_id -> u64 (timestamp)
    ProjectRefundWindowDeadline(u64), // project_id -> u64 (timestamp)
    MilestoneApproved(u64, u32),      // (project_id, milestone_id) -> bool
    MilestoneDisputed(u64, u32),      // (project_id, milestone_id) -> bool
    MilestoneDispute(u64, u32),       // (project_id, milestone_id) -> MilestoneDispute
    MilestoneVote(u64, u32, Address), // (project_id, milestone_id, voter) -> bool
    MilestoneVotesFor(u64, u32),      // (project_id, milestone_id) -> i128
    MilestoneVotesAgainst(u64, u32),  // (project_id, milestone_id) -> i128
    MilestoneVoteWindow(u64, u32),    // (project_id, milestone_id) -> u64 (timestamp)
    NextProjectId,                    // -> u64
    Contribution(u64, Address),       // (project_id, contributor) -> i128
    ContributorCount(u64),            // project_id -> u32
    Contributor(u64, u32),            // (project_id, index) -> Address
    MatchingPool(Address),            // token_address -> i128
    RewardPool(Address),              // token_address -> i128
    RegisteredContributor(Address),   // Address -> bool
    Reputation(Address),              // Address -> i128
    Paused,
    ProjectStatus(u64),
    YieldProvider(Address),      // token_address -> yield_provider_address
    ProjectInvestedBalance(u64), // project_id -> i128
    FeeBps,                      // -> u32
    Treasury,                    // -> Address
    Subscribers,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProtocolStats {
    pub tvl: i128,
    pub cumulative_volume: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectData {
    pub id: u64,
    pub owner: Address,
    pub name: Symbol,
    pub target_amount: i128,
    pub token_address: Address,
    pub total_deposited: i128,
    pub total_withdrawn: i128,
    pub is_active: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneDispute {
    pub project_id: u64,
    pub milestone_id: u32,
    pub challenger: Address,
    pub opened_at: u64,
    pub reason: Symbol,
}
