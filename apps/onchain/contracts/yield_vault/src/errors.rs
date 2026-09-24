use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum YieldVaultError {
    AlreadyInitialized = 2400,
    NotInitialized = 2401,
    InvalidAmount = 2402,
    InsufficientBalance = 2403,
    ProviderNotFound = 2404,
    NoProvidersAvailable = 2405,
    AlreadyExecuted = 2406,
    Unauthorized = 2407,
    VaultPaused = 2408,
    Reentrancy = 2409,
}
