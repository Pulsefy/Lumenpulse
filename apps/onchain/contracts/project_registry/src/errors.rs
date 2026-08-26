use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RegistryError {
    NotInitialized = 1100,
    AlreadyInitialized = 1101,
    Unauthorized = 1102,
    ProjectNotFound = 1103,
    ProjectAlreadyRegistered = 1104,
    AlreadyVoted = 1105,
    VotingClosed = 1106,
    InsufficientWeight = 1107,
    InvalidThreshold = 1108,
    ContractPaused = 1109,
    ProjectAlreadyVerified = 1110,
    ProjectAlreadyRejected = 1111,
}
