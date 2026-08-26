use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1500,
    Unauthorized = 1501,
    NotInitialized = 1502,

    OperationAlreadyQueued = 1503,
    OperationNotFound = 1504,
    OperationNotReady = 1505,
    OperationExpired = 1506,

    InvalidDelay = 1507,
}
