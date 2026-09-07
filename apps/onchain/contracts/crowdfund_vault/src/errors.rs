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
    Reentrancy = 31,
    AlreadyExecuted = 32,
    // ── Emergency migration (issue #1047) ─────────────────────────────────────
    /// The contract is not in a paused state; emergency migration requires pause.
    EmergencyMigrationRequiresPause = 33,
    /// A migration plan has already been registered for this project.
    MigrationPlanAlreadyExists = 34,
    /// No migration plan was found for this project.
    MigrationPlanNotFound = 35,
    /// The migration plan has already been executed; it cannot be run twice.
    MigrationAlreadyExecuted = 36,
    /// The recipient address supplied for migration is invalid (e.g. the contract itself).
    InvalidMigrationRecipient = 37,
    /// The migration amount exceeds the project's current on-chain balance.
    MigrationAmountExceedsBalance = 38,
    /// The migration plan was vetoed by a second admin; it cannot proceed.
    MigrationPlanVetoed = 39,
    /// A submitted batch is empty, too large, or contains repeated milestone keys.
    InvalidBatch = 40,
    /// The provided signature for a gasless meta-transaction is empty or invalid.
    InvalidSignature = 41,
}
