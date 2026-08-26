use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum CrowdfundError {
    NotInitialized = 300,
    AlreadyInitialized = 301,
    Unauthorized = 302,
    ProjectNotFound = 303,
    MilestoneNotApproved = 304,
    InsufficientBalance = 305,
    ProjectNotActive = 306,
    InvalidAmount = 307,
    AlreadyRegistered = 308,
    ContributorNotFound = 309,
    ContractPaused = 310,
    ProjectAlreadyCanceled = 311,
    ProjectNotCancellable = 312,
    RefundFailed = 313,
    ContractNotPaused = 314,
    YieldProviderNotFound = 315,
    VotingWindowNotStarted = 316,
    VotingWindowClosed = 317,
    AlreadyVoted = 318,
    InsufficientContributionToVote = 319,
    MilestoneAlreadyApproved = 320,
    MilestoneAlreadyDisputed = 321,
    MilestoneNotDisputed = 322,
    MilestoneEscrowed = 323,
    InvalidRecipient = 324,
    UnsupportedStorageVersion = 325,
    MigrationRequired = 326,
    MilestoneExpired = 327,
    RefundWindowClosed = 328,
    RefundWindowNotOpen = 329,
    Reentrancy = 330,
    AlreadyExecuted = 331,
    // ── Emergency migration (issue #1047) ─────────────────────────────────────
    /// The contract is not in a paused state; emergency migration requires pause.
    EmergencyMigrationRequiresPause = 332,
    /// A migration plan has already been registered for this project.
    MigrationPlanAlreadyExists = 333,
    /// No migration plan was found for this project.
    MigrationPlanNotFound = 334,
    /// The migration plan has already been executed; it cannot be run twice.
    MigrationAlreadyExecuted = 335,
    /// The recipient address supplied for migration is invalid (e.g. the contract itself).
    InvalidMigrationRecipient = 336,
    /// The migration amount exceeds the project's current on-chain balance.
    MigrationAmountExceedsBalance = 337,
    /// The migration plan was vetoed by a second admin; it cannot proceed.
    MigrationPlanVetoed = 338,
}
