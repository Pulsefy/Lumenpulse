use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum CrowdfundError {
    NotInitialized = 1401,
    AlreadyInitialized = 1402,
    Unauthorized = 1403,
    ProjectNotFound = 1404,
    MilestoneNotApproved = 1405,
    InsufficientBalance = 1406,
    ProjectNotActive = 1407,
    InvalidAmount = 1408,
    AlreadyRegistered = 1409,
    ContributorNotFound = 1410,
    ContractPaused = 1411,
    ProjectAlreadyCanceled = 1412,
    ProjectNotCancellable = 1413,
    RefundFailed = 1414,
    ContractNotPaused = 1415,
    YieldProviderNotFound = 1416,
    VotingWindowNotStarted = 1417,
    VotingWindowClosed = 1418,
    AlreadyVoted = 1419,
    InsufficientContributionToVote = 1420,
    MilestoneAlreadyApproved = 1421,
    MilestoneAlreadyDisputed = 1422,
    MilestoneNotDisputed = 1423,
    MilestoneEscrowed = 1424,
    InvalidRecipient = 1425,
    UnsupportedStorageVersion = 1426,
    MigrationRequired = 1427,
    MilestoneExpired = 1428,
    RefundWindowClosed = 1429,
    RefundWindowNotOpen = 1430,
    Reentrancy = 1431,
    AlreadyExecuted = 1432,
    // ── Emergency migration (issue #1047) ─────────────────────────────────────
    /// The contract is not in a paused state; emergency migration requires pause.
    EmergencyMigrationRequiresPause = 1433,
    /// A migration plan has already been registered for this project.
    MigrationPlanAlreadyExists = 1434,
    /// No migration plan was found for this project.
    MigrationPlanNotFound = 1435,
    /// The migration plan has already been executed; it cannot be run twice.
    MigrationAlreadyExecuted = 1436,
    /// The recipient address supplied for migration is invalid (e.g. the contract itself).
    InvalidMigrationRecipient = 1437,
    /// The migration amount exceeds the project's current on-chain balance.
    MigrationAmountExceedsBalance = 1438,
    /// The migration plan was vetoed by a second admin; it cannot proceed.
    MigrationPlanVetoed = 1439,
    /// A submitted batch is empty, too large, or contains repeated milestone keys.
    InvalidBatch = 1440,
}
