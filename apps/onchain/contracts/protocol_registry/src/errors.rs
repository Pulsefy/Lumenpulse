use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RegistryError {
    NotInitialized = 1200,
    AlreadyInitialized = 1201,
    Unauthorized = 1202,
    ModuleNotFound = 1203,
    ModuleAlreadyRegistered = 1204,
    ModuleInactive = 1205,
    ContractPaused = 1206,
    /// Attempted to register/update with a version ≤ the current recorded version.
    VersionNotIncremented = 1207,
}
