use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 2200,
    Unauthorized = 2201,
    NotInitialized = 2202,

    OperationAlreadyQueued = 2203,
    OperationNotFound = 2204,
    OperationNotReady = 2205,
    OperationExpired = 2206,

    InvalidDelay = 2207,
}
