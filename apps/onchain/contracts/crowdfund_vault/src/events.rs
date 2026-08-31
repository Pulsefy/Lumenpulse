use soroban_sdk::{contractevent, Address};

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InitializedEvent {
    pub admin: Address,
    pub storage_version: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectCreatedEvent {
    #[topic]
    pub owner: Address,
    #[topic]
    pub token_address: Address,
    pub project_id: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DepositEvent {
    #[topic]
    pub user: Address,
    #[topic]
    pub project_id: u64,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneApprovedEvent {
    #[topic]
    pub admin: Address,
    pub project_id: u64,
    pub milestone_id: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneDecisionEvent {
    #[topic]
    pub admin: Address,
    #[topic]
    pub project_id: u64,
    pub milestone_id: u32,
    pub approved: bool,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WithdrawEvent {
    #[topic]
    pub owner: Address,
    #[topic]
    pub project_id: u64,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContributorRegisteredEvent {
    pub contributor: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReputationUpdatedEvent {
    #[topic]
    pub contributor: Address,
    pub old_reputation: i128,
    pub new_reputation: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractPauseEvent {
    #[topic]
    pub admin: Address,
    pub paused: bool,
    pub timestamp: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractUnpauseEvent {
    #[topic]
    pub admin: Address,
    pub paused: bool,
    pub timestamp: u64,
}

/// Emitted when the contract WASM is upgraded to a new hash.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpgradedEvent {
    #[topic]
    pub admin: Address,
    pub new_wasm_hash: soroban_sdk::BytesN<32>,
}

/// Emitted when the admin role is transferred to a new address.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminChangedEvent {
    #[topic]
    pub old_admin: Address,
    pub new_admin: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectCanceledEvent {
    pub project_id: u64,
    pub caller: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContributionRefundedEvent {
    pub project_id: u64,
    pub contributor: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContributorPayoutEvent {
    #[topic]
    pub recipient: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectExpiredEvent {
    #[topic]
    pub project_id: u64,
    pub refund_window_deadline: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContributionClawedBackEvent {
    #[topic]
    pub project_id: u64,
    #[topic]
    pub contributor: Address,
    pub amount: i128,
    pub refund_window_deadline: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProtocolFeeDeductedEvent {
    #[topic]
    pub project_id: u64,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneVoteStartedEvent {
    #[topic]
    pub project_id: u64,
    pub milestone_id: u32,
    pub end_time: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeeConfigChangedEvent {
    #[topic]
    pub admin: Address,
    pub fee_bps: u32,
    pub treasury: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VoteCastEvent {
    #[topic]
    pub project_id: u64,
    pub milestone_id: u32,
    pub voter: Address,
    pub weight: i128,
    pub support: bool,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneApprovedByVoteEvent {
    #[topic]
    pub project_id: u64,
    pub milestone_id: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneDisputedEvent {
    #[topic]
    pub project_id: u64,
    pub milestone_id: u32,
    pub challenger: Address,
    pub reason: soroban_sdk::Symbol,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneDisputeResolvedEvent {
    #[topic]
    pub admin: Address,
    #[topic]
    pub project_id: u64,
    pub milestone_id: u32,
    pub upheld_completion: bool,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StorageMigratedEvent {
    #[topic]
    pub admin: Address,
    pub storage_version: u32,
}

// ── Emergency migration events (issue #1047) ──────────────────────────────────

/// Emitted when an admin registers an emergency migration plan for a paused round.
/// Off-chain monitors should alert on this event for governance review.
///
/// Data kept to two fields to stay within Soroban's contractevent data-field limit.
/// The full plan (including recipient, reason, and proposed_at) can be read from
/// on-chain storage via `get_emergency_migration_plan`.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EmrgMigrProposedEvent {
    /// Admin who registered the plan.
    #[topic]
    pub proposed_by: Address,
    /// Project with stranded funds.
    #[topic]
    pub project_id: u64,
    /// Amount to be migrated (as proposed).
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EmrgMigrExecutedEvent {
    /// Admin who executed the plan.
    #[topic]
    pub executed_by: Address,
    /// Project from which funds were migrated.
    #[topic]
    pub project_id: u64,
    /// Exact amount transferred to the recipient.
    pub amount: i128,
}

/// Emitted when an admin vetoes a pending emergency migration plan.
/// A vetoed plan can never be executed.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EmergencyMigrationVetoedEvent {
    /// Admin who issued the veto.
    #[topic]
    pub vetoed_by: Address,
    /// The project for which the plan was vetoed.
    #[topic]
    pub project_id: u64,
    /// Ledger timestamp of the veto.
    pub vetoed_at: u64,
}
