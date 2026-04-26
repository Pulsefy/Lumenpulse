use soroban_sdk::{contracttype, Address};

// TTL constants for Soroban storage rent management.
// LEDGER_THRESHOLD: if the remaining TTL falls below this value, extend it.
// LEDGER_BUMP: the new TTL to set when extending (≈30 days at 5 s/ledger).
pub const LEDGER_THRESHOLD: u32 = 100_000;
pub const LEDGER_BUMP: u32 = 518_400;

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
