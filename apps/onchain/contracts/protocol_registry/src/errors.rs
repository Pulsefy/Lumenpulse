use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RegistryError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    ModuleNotFound = 4,
    ModuleAlreadyRegistered = 5,
    ModuleInactive = 6,
    ContractPaused = 7,
    /// Attempted to register/update with a version ≤ the current recorded version.
    VersionNotIncremented = 8,
}
