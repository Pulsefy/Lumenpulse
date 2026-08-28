use soroban_sdk::{contracttype, Address, Symbol};

// TTL constants for Soroban storage rent management.
// LEDGER_THRESHOLD: if the remaining TTL falls below this value, extend it.
// LEDGER_BUMP: the new TTL to set when extending (≈30 days at 5 s/ledger).
pub const LEDGER_THRESHOLD: u32 = 100_000;
pub const LEDGER_BUMP: u32 = 518_400;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    StorageVersion,
    ProtocolStats,                    // -> ProtocolStats (instance storage)
    Project(u64),                     // -> ProjectData
    ProjectBalance(u64, Address),     // (project_id, token) -> i128
    ProjectMilestoneExpiry(u64),      // project_id -> u64 (timestamp)
    ProjectRefundWindowDeadline(u64), // project_id -> u64 (timestamp)
    MilestoneApproved(u64, u32),      // (project_id, milestone_id) -> bool
    MilestoneDisputed(u64, u32),      // (project_id, milestone_id) -> bool
    MilestoneDispute(u64, u32),       // (project_id, milestone_id) -> MilestoneDispute
    MilestoneVote(u64, u32, Address), // (project_id, milestone_id, voter) -> bool
    MilestoneVotesFor(u64, u32),      // (project_id, milestone_id) -> i128
    MilestoneVotesAgainst(u64, u32),  // (project_id, milestone_id) -> i128
    MilestoneVoteWindow(u64, u32),    // (project_id, milestone_id) -> u64 (timestamp)
    NextProjectId,                    // -> u64
    Contribution(u64, Address),       // (project_id, contributor) -> i128
    ContributorCount(u64),            // project_id -> u32
    Contributor(u64, u32),            // (project_id, index) -> Address
    MatchingPool(Address),            // token_address -> i128
    RewardPool(Address),              // token_address -> i128
    RegisteredContributor(Address),   // Address -> bool
    Reputation(Address),              // Address -> i128
    Paused,
    ProjectStatus(u64),
    YieldProvider(Address),      // token_address -> yield_provider_address
    ProjectInvestedBalance(u64), // project_id -> i128
    FeeBps,                      // -> u32
    Treasury,                    // -> Address
    Subscribers,
    RefundReceipt(u64, u64),     // (project_id, receipt_id) -> RefundReceipt
    RefundReceiptCount(u64),     // project_id -> u64
    RefundClaimed(u64, Address), // (project_id, contributor) -> bool
    RegistrationNonce(Address),  // Address -> u64
    DepositNonce(Address),       // Address -> u64
    DepositIdempotencyKey(u64, Address),
    // ── Emergency migration (issue #1047) ─────────────────────────────────────
    EmergencyMigrationPlan(u64), // project_id -> EmergencyMigrationPlan
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProtocolStats {
    pub tvl: i128,
    pub cumulative_volume: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectStorageSummary {
    pub project_id: u64,
    pub project_exists: bool,
    pub contributor_count: u32,
    pub refund_receipt_count: u64,
    pub total_projects: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectData {
    pub id: u64,
    pub owner: Address,
    pub name: Symbol,
    pub target_amount: i128,
    pub token_address: Address,
    pub total_deposited: i128,
    pub total_withdrawn: i128,
    pub is_active: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneDispute {
    pub project_id: u64,
    pub milestone_id: u32,
    pub challenger: Address,
    pub opened_at: u64,
    pub reason: Symbol,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RefundReceipt {
    pub project_id: u64,
    pub contributor: Address,
    pub amount: i128,
    pub reason: Symbol,
    pub timestamp: u64,
}

// ── Emergency migration types (issue #1047) ────────────────────────────────────

/// Lifecycle state of a single emergency migration plan.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum MigrationPlanStatus {
    /// Plan is registered and awaiting execution.
    Pending = 0,
    /// Plan has been successfully executed; funds have been moved.
    Executed = 1,
    /// Plan was vetoed by a second admin before execution.
    Vetoed = 2,
}

/// An auditable emergency migration plan for a paused round.
///
/// A plan is created by the primary admin while the contract is paused.
/// It describes exactly which project, how much, and where the stranded
/// funds should go.  A second independent admin must NOT have vetoed it
/// before `execute_emergency_migration` is called.
///
/// Storage tier: **Persistent** — must survive the pause + execution window.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EmergencyMigrationPlan {
    /// The project whose stranded funds are being moved.
    pub project_id: u64,
    /// The amount to migrate (≤ project balance at registration time).
    pub amount: i128,
    /// Where the funds will be sent — typically a recovery multisig.
    pub recipient: Address,
    /// A short human-readable reason stored on-chain for auditors.
    pub reason: Symbol,
    /// Admin who created this plan.
    pub proposed_by: Address,
    /// Ledger timestamp when the plan was registered.
    pub proposed_at: u64,
    /// Current lifecycle state of this plan.
    pub status: MigrationPlanStatus,
    /// Ledger timestamp when the plan was executed or vetoed (0 if pending).
    pub resolved_at: u64,
    /// Admin who vetoed this plan (zero-address if not vetoed).
    pub vetoed_by: Option<Address>,
}
