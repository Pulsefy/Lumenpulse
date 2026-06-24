use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum DeploymentRegistryError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    ContractNotFound = 4,
    EmptyKey = 5,
    EmptyVersion = 6,
    EmptyEnvironment = 7,
}
