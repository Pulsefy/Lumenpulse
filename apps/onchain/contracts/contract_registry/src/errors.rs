use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum RegistryError {
    Unauthorized = 1000,
    AlreadyInitialized = 1001,
    NotInitialized = 1002,
    ContractNotFound = 1003,
}
