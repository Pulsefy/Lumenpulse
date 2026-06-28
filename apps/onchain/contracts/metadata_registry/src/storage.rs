use soroban_sdk::{contracttype, Address, String};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    Metadata(String), // Contract key
    AllContracts,     // Vec<String>
}

#[derive(Clone)]
#[contracttype]
pub struct ContractMetadata {
    pub address: Address,
    pub version: String,
    pub environment: String,
    pub updated_at: u64,
}
