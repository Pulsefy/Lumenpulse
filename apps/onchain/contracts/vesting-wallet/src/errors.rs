use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VestingError {
    NotInitialized = 1600,
    AlreadyInitialized = 1601,
    Unauthorized = 1602,
    VestingNotFound = 1603,
    InvalidAmount = 1604,
    InvalidDuration = 1605,
    InvalidStartTime = 1606,
    NothingToClaim = 1607,
    InsufficientBalance = 1608,
    Reentrancy = 1609,
    DelegateNotAuthorized = 1610,
}
