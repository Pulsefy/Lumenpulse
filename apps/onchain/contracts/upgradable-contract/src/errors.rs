use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1,
    Unauthorized = 2,
    NotInitialized = 3,

    OperationAlreadyQueued = 4,
    OperationNotFound = 5,
    OperationNotReady = 6,
    OperationExpired = 7,

    InvalidDelay = 8,
}
