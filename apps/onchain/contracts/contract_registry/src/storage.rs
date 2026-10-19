use soroban_sdk::{contracttype, Address, Symbol};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractInfo {
    pub key: Symbol,
    pub address: Address,
    pub version: u32,
    pub environment: Symbol,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Paused,
    Contract(Symbol), // maps contract key to ContractInfo
    ContractKeys,     // Vec<Symbol> of all registered contract keys
}
