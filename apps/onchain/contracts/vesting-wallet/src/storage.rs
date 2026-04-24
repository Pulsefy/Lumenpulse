use soroban_sdk::{contracttype, Address};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,            // -> Address
    Token,            // -> Address
    Vesting(Address), // beneficiary -> VestingData
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneLink {
    pub vault: Address,
    pub project_id: u64,
    pub milestone_id: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VestingData {
    pub beneficiary: Address,
    pub total_amount: i128,
    pub start_time: u64,
    pub duration: u64,
    pub claimed_amount: i128,
    pub milestone_vault: Option<Address>,
    pub milestone_project_id: Option<u64>,
    pub milestone_id: Option<u32>,
}
