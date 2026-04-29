use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum CrowdfundError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    ProjectNotFound = 4,
    MilestoneNotApproved = 5,
    InsufficientBalance = 6,
    ProjectNotActive = 7,
    InvalidAmount = 8,
    AlreadyRegistered = 9,
    ContributorNotFound = 10,
    ContractPaused = 11,
    ProjectAlreadyCanceled = 12,
    ProjectNotCancellable = 13,
    RefundFailed = 14,
    ContractNotPaused = 15,
    YieldProviderNotFound = 16,
    VotingWindowNotStarted = 17,
    VotingWindowClosed = 18,
    AlreadyVoted = 19,
    InsufficientContributionToVote = 20,
    MilestoneAlreadyApproved = 21,
    MilestoneAlreadyDisputed = 22,
    MilestoneNotDisputed = 23,
    MilestoneEscrowed = 24,
    InvalidRecipient = 25,
    UnsupportedStorageVersion = 26,
    MigrationRequired = 27,
    MilestoneExpired = 28,
    RefundWindowClosed = 29,
    RefundWindowNotOpen = 30,
    VotingWindowNotClosed = 31,
    Reentrancy = 31,
}
