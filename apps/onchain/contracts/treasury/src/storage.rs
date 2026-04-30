use soroban_sdk::{contracttype, Address};

pub const LEDGER_THRESHOLD: u32 = 120_960; // ~1 week
pub const LEDGER_BUMP: u32 = 241_920; // ~2 weeks

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Token,
    Stream(Address), // beneficiary -> StreamData
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamData {
    pub beneficiary: Address,
    pub total_amount: i128,
    pub claimed_amount: i128,
    pub start_time: u64,
    pub duration: u64,
}
