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
pub struct VestingData {
    pub beneficiary: Address,
    pub total_amount: i128,
    pub start_time: u64,
    pub duration: u64,
    pub claimed_amount: i128,
}
