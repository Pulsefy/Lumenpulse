use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum FlagError {
    NotInitialized = 1601,
    AlreadyInitialized = 1602,
    Unauthorized = 1603,
    ContractPaused = 1604,
}
