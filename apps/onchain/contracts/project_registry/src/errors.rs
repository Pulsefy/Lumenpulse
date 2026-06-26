use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RegistryError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    ProjectNotFound = 4,
    ProjectAlreadyRegistered = 5,
    AlreadyVoted = 6,
    VotingClosed = 7,
    InsufficientWeight = 8,
    InvalidThreshold = 9,
    ContractPaused = 10,
    ProjectAlreadyVerified = 11,
    ProjectAlreadyRejected = 12,
}
