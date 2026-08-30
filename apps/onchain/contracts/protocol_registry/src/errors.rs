use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RegistryError {
    NotInitialized = 2201,
    AlreadyInitialized = 2202,
    Unauthorized = 2203,
    ModuleNotFound = 2204,
    ModuleAlreadyRegistered = 2205,
    ModuleInactive = 2206,
    ContractPaused = 2207,
    /// Attempted to register/update with a version ≤ the current recorded version.
    VersionNotIncremented = 2208,
}
