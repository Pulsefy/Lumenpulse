use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum CrowdfundError {
    NotInitialized = 1300,
    AlreadyInitialized = 1301,
    Unauthorized = 1302,
    ProjectNotFound = 1303,
    MilestoneNotApproved = 1304,
    InsufficientBalance = 1305,
    ProjectNotActive = 1306,
    InvalidAmount = 1307,
    AlreadyRegistered = 1308,
    ContributorNotFound = 1309,
    ContractPaused = 1310,
    ProjectAlreadyCanceled = 1311,
    ProjectNotCancellable = 1312,
    RefundFailed = 1313,
    ContractNotPaused = 1314,
    YieldProviderNotFound = 1315,
    VotingWindowNotStarted = 1316,
    VotingWindowClosed = 1317,
    AlreadyVoted = 1318,
    InsufficientContributionToVote = 1319,
    MilestoneAlreadyApproved = 1320,
    MilestoneAlreadyDisputed = 1321,
    MilestoneNotDisputed = 1322,
    MilestoneEscrowed = 1323,
    InvalidRecipient = 1324,
    UnsupportedStorageVersion = 1325,
    MigrationRequired = 1326,
    MilestoneExpired = 1327,
    RefundWindowClosed = 1328,
    RefundWindowNotOpen = 1329,
    Reentrancy = 1330,
    AlreadyExecuted = 1331,
    // ── Emergency migration (issue #1047) ─────────────────────────────────────
    /// The contract is not in a paused state; emergency migration requires pause.
    EmergencyMigrationRequiresPause = 1332,
    /// A migration plan has already been registered for this project.
    MigrationPlanAlreadyExists = 1333,
    /// No migration plan was found for this project.
    MigrationPlanNotFound = 1334,
    /// The migration plan has already been executed; it cannot be run twice.
    MigrationAlreadyExecuted = 1335,
    /// The recipient address supplied for migration is invalid (e.g. the contract itself).
    InvalidMigrationRecipient = 1336,
    /// The migration amount exceeds the project's current on-chain balance.
    MigrationAmountExceedsBalance = 1337,
    /// The migration plan was vetoed by a second admin; it cannot proceed.
    MigrationPlanVetoed = 1338,
    /// A submitted batch is empty, too large, or contains repeated milestone keys.
    InvalidBatch = 1339,
    /// The provided signature for a gasless meta-transaction is empty or invalid.
    InvalidSignature = 1340,
}
