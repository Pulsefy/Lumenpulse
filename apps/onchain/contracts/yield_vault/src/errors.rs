use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum YieldVaultError {
    AlreadyInitialized = 2301,
    NotInitialized = 2302,
    InvalidAmount = 2303,
    InsufficientBalance = 2304,
    ProviderNotFound = 2305,
    NoProvidersAvailable = 2306,
    AlreadyExecuted = 2307,
    Unauthorized = 2308,
    VaultPaused = 2309,
    Reentrancy = 2310,
}
