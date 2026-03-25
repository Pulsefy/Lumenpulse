use soroban_sdk::{contracttype, Address, Symbol};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,                            // -> Address
    Project(u64),                     // -> ProjectData
    ProjectBalance(u64, Address),     // (project_id, token) -> i128
    MilestoneApproved(u64, u32),      // (project_id, milestone_id) -> bool
    MilestoneVote(u64, u32, Address), // (project_id, milestone_id, voter) -> bool
    MilestoneVotesFor(u64, u32),      // (project_id, milestone_id) -> i128
    MilestoneVotesAgainst(u64, u32),  // (project_id, milestone_id) -> i128
    MilestoneVoteWindow(u64, u32),    // (project_id, milestone_id) -> u64 (timestamp)
    NextProjectId,                    // -> u64
    Contribution(u64, Address),       // (project_id, contributor) -> i128
    ContributorCount(u64),            // project_id -> u32
    Contributor(u64, u32),            // (project_id, index) -> Address
    MatchingPool(Address),            // token_address -> i128
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
