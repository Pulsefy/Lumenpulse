use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RegistryError {
    NotInitialized = 2000,
    AlreadyInitialized = 2001,
    Unauthorized = 2002,
    ModuleNotFound = 2003,
    ModuleAlreadyRegistered = 2004,
    ModuleInactive = 2005,
    ContractPaused = 2006,
    /// Attempted to register/update with a version ≤ the current recorded version.
    VersionNotIncremented = 2007,
}
