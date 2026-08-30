use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RegistryError {
    NotInitialized = 1201,
    AlreadyInitialized = 1202,
    Unauthorized = 1203,
    ProjectNotFound = 1204,
    ProjectAlreadyRegistered = 1205,
    AlreadyVoted = 1206,
    VotingClosed = 1207,
    InsufficientWeight = 1208,
    InvalidThreshold = 1209,
    ContractPaused = 1210,
    ProjectAlreadyVerified = 1211,
    ProjectAlreadyRejected = 1212,
}
