use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VestingError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    VestingNotFound = 4,
    InvalidAmount = 5,
    InvalidDuration = 6,
    InvalidStartTime = 7,
    NothingToClaim = 8,
    InsufficientBalance = 9,
}
