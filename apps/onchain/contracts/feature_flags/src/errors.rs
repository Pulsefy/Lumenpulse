use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum FlagError {
    NotInitialized = 1400,
    AlreadyInitialized = 1401,
    Unauthorized = 1402,
    ContractPaused = 1403,
}
