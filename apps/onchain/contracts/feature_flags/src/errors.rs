use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum FlagError {
    NotInitialized = 500,
    AlreadyInitialized = 501,
    Unauthorized = 502,
    ContractPaused = 503,
}
