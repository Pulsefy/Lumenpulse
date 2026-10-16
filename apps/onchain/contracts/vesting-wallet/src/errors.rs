use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VestingError {
    NotInitialized = 2300,
    AlreadyInitialized = 2301,
    Unauthorized = 2302,
    VestingNotFound = 2303,
    InvalidAmount = 2304,
    InvalidDuration = 2305,
    InvalidStartTime = 2306,
    NothingToClaim = 2307,
    InsufficientBalance = 2308,
    Reentrancy = 2309,
    DelegateNotAuthorized = 2310,
}
