use soroban_sdk::{contracttype, Address, Symbol};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,                          // -> Address
    Project(u64),                   // -> ProjectData
    ProjectBalance(u64, Address),   // (project_id, token) -> i128
    MilestoneApproved(u64),         // project_id -> bool
    NextProjectId,                  // -> u64
    Contribution(u64, Address),     // (project_id, contributor) -> i128
    ContributorCount(u64),          // project_id -> u32
    Contributor(u64, u32),          // (project_id, index) -> Address
    MatchingPool(Address),          // token_address -> i128
    RegisteredContributor(Address), // Address -> bool
    Reputation(Address),            // Address -> i128
    Paused,
    ProjectStatus(u64),
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
