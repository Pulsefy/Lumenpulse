use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum YieldVaultError {
    AlreadyInitialized = 1700,
    NotInitialized = 1701,
    InvalidAmount = 1702,
    InsufficientBalance = 1703,
    ProviderNotFound = 1704,
    NoProvidersAvailable = 1705,
    AlreadyExecuted = 1706,
    Unauthorized = 1707,
    VaultPaused = 1708,
}
