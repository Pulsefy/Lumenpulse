use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1801,
    Unauthorized = 1802,
    NotInitialized = 1803,

    OperationAlreadyQueued = 1804,
    OperationNotFound = 1805,
    OperationNotReady = 1806,
    OperationExpired = 1807,

    InvalidDelay = 1808,
}
