use soroban_sdk::{contracttype, Address, String, Symbol};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DeploymentMetadata {
    pub key: Symbol,
    pub contract_address: Address,
    pub version: String,
    pub environment: String,
    pub updated_at: u64,
    pub active: bool,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Deployment(Symbol),
    DeploymentKeys,
}
