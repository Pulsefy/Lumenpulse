use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum CurationError {
    AlreadyInitialized = 600,
    NotInitialized = 601,
    ProjectNotFound = 602,
    VotingClosed = 603,
    VotingWindowExpired = 604,
    VotingWindowNotExpired = 605,
    AlreadyVoted = 606,
    InsufficientReputation = 607,
    InvalidMetadata = 608,
    Unauthorized = 609,
}
