use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum CurationError {
    AlreadyInitialized = 1501,
    NotInitialized = 1502,
    ProjectNotFound = 1503,
    VotingClosed = 1504,
    VotingWindowExpired = 1505,
    VotingWindowNotExpired = 1506,
    AlreadyVoted = 1507,
    InsufficientReputation = 1508,
    InvalidMetadata = 1509,
    Unauthorized = 1510,
}
