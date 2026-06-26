use soroban_sdk::{contracttype, Address};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    AssetPrice(Address),
    AssetOracle(Address),
    AssetDecimals(Address), // Stores decimals if needed for normalization
}
