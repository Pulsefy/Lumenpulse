use soroban_sdk::{contracttype, Address, Vec};

pub const LEDGER_THRESHOLD: u32 = 120_960; // ~1 week
pub const LEDGER_BUMP: u32 = 241_920; // ~2 weeks

/// Proposals expire after 72 hours if threshold is never reached.
pub const PROPOSAL_TTL_SECS: u64 = 72 * 60 * 60;

/// Hard cap on the signer set size to keep iteration costs bounded.
pub const MAX_SIGNERS: u32 = 10;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Token,
    Stream(Address), // beneficiary -> StreamData (legacy V1)
    /// Multisig config (signers + threshold).
    MultisigConfig,
    /// A single in-flight proposal, keyed by id.
    Proposal(u64),
    /// Monotonic counter for proposal ids.
    NextProposalId,
    /// V2 stream with optional cliff - beneficiary -> StreamDataV2.
    ///
    /// Appended at the end of the enum so the XDR discriminants for the
    /// pre-existing variants stay stable across upgrades (Soroban assigns
    /// discriminants in declaration order).
    StreamV2(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamData {
    pub beneficiary: Address,
    pub total_amount: i128,
    pub claimed_amount: i128,
    pub start_time: u64,
    pub duration: u64,
}

/// V2 streaming record with an optional cliff.
///
/// `cliff_time` semantics:
/// - `0`          → no cliff (legacy equivalent; linear from `start_time`).
/// - `> 0`        → lockout until `cliff_time`. Linear vesting still begins
///                  at `start_time`; nothing is claimable until `cliff_time`,
///                  at which point the full linearly-vested amount becomes
///                  available for one claim and continues normally thereafter.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamDataV2 {
    pub beneficiary: Address,
    pub total_amount: i128,
    pub claimed_amount: i128,
    pub start_time: u64,
    pub duration: u64,
    pub cliff_time: u64,
}

/// A registered signer with a voting weight.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Signer {
    pub address: Address,
    /// Relative weight; threshold is expressed in the same unit.
    pub weight: u32,
}

/// N-of-M multisig configuration.
#[contracttype]
#[derive(Clone, Debug)]
pub struct MultisigConfig {
    pub signers: Vec<Signer>,
    pub threshold: u32,
}

/// The set of privileged actions that require a multisig proposal.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProposalAction {
    /// Change the admin address.
    SetAdmin,
    /// Rotate a vesting stream's beneficiary.
    RotateBeneficiary,
}

/// A single installment (timestamp, cumulative_projected_unlocked) entry
/// returned by `preview_schedule`. Useful for building off-chain UI charts
/// and admin dashboards without making speculative claims.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ScheduleEntry {
    pub at: u64,
    pub cumulative_unlocked: i128,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ProposalStatus {
    Pending = 0,
    Approved = 1,
    Executed = 2,
    Expired = 3,
    Cancelled = 4,
}

/// On-chain record of a single proposal.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Proposal {
    pub id: u64,
    pub action: ProposalAction,
    pub proposer: Address,
    pub created_at: u64,
    pub expires_at: u64,
    pub status: ProposalStatus,
    pub signers: Vec<Address>,
    pub weight_collected: u32,
}
