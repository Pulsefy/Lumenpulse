use soroban_sdk::{contracttype, Address};

pub const LEDGER_THRESHOLD: u32 = 120_960;
pub const LEDGER_BUMP: u32 = 518_400;

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    AssetPrice(Address),
    AssetOracle(Address),
    AssetDecimals(Address), // Stores decimals if needed for normalization
}
