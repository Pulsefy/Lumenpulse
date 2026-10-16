use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RegistryError {
    NotInitialized = 1900,
    AlreadyInitialized = 1901,
    Unauthorized = 1902,
    ProjectNotFound = 1903,
    ProjectAlreadyRegistered = 1904,
    AlreadyVoted = 1905,
    VotingClosed = 1906,
    InsufficientWeight = 1907,
    InvalidThreshold = 1908,
    ContractPaused = 1909,
    ProjectAlreadyVerified = 1910,
    ProjectAlreadyRejected = 1911,
}
