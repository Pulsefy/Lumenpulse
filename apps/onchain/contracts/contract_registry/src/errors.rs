use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum RegistryError {
    Unauthorized = 1,
    AlreadyInitialized = 2,
    NotInitialized = 3,
    ContractNotFound = 4,
}
