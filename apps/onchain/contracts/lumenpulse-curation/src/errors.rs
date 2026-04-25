use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum CurationError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    ProjectNotFound = 3,
    VotingClosed = 4,
    VotingWindowExpired = 5,
    VotingWindowNotExpired = 6,
    AlreadyVoted = 7,
    InsufficientReputation = 8,
    InvalidMetadata = 9,
    Unauthorized = 10,
}
