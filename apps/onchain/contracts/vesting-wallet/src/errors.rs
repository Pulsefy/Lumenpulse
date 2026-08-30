use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VestingError {
    NotInitialized = 1101,
    AlreadyInitialized = 1102,
    Unauthorized = 1103,
    VestingNotFound = 1104,
    InvalidAmount = 1105,
    InvalidDuration = 1106,
    InvalidStartTime = 1107,
    NothingToClaim = 1108,
    InsufficientBalance = 1109,
    Reentrancy = 1110,
    DelegateNotAuthorized = 1111,
}
