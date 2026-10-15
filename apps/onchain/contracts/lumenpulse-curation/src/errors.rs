use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum CurationError {
    AlreadyInitialized = 1500,
    NotInitialized = 1501,
    ProjectNotFound = 1502,
    VotingClosed = 1503,
    VotingWindowExpired = 1504,
    VotingWindowNotExpired = 1505,
    AlreadyVoted = 1506,
    InsufficientReputation = 1507,
    InvalidMetadata = 1508,
    Unauthorized = 1509,
}
