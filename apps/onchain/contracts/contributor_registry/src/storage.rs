use soroban_sdk::{contracttype, Address, String};

// TTL constants for Soroban storage rent management.
// LEDGER_THRESHOLD: if the remaining TTL falls below this value, extend it.
// LEDGER_BUMP: the new TTL to set when extending (≈30 days at 5 s/ledger).
pub const LEDGER_THRESHOLD: u32 = 100_000;
pub const LEDGER_BUMP: u32 = 518_400;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    // ── Existing keys (unchanged) ─────────────────────────────
    Admin,
    Contributor(Address),
    GitHubIndex(String),
    RegistrationNonce(Address),

    // ── Multisig keys ─────────────────────────────────────────
    MultisigConfig,
    Proposal(u64),
    NextProposalId,

    // ── Badge keys ────────────────────────────────────────────
    Badges(Address),

    // ── Penalty keys ──────────────────────────────────────────
    /// Latest penalty record for a contributor (keyed by contributor address).
    ReputationPenalty(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContributorData {
    pub address: Address,
    pub github_handle: String,
    pub reputation_score: u64,
    pub registered_timestamp: u64,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ContributorTier {
    Novice = 1,
    Builder = 2,
    Architect = 3,
    Core = 4,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Badge {
    EarlyAdopter = 1,
    BugHunter = 2,
    TopContributor = 3,
    SecurityAuditor = 4,
}

/// How severe the dispute outcome was.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum PenaltySeverity {
    Minor = 1,
    Moderate = 2,
    Severe = 3,
}

/// Metadata stored on-chain for each applied penalty.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PenaltyRecord {
    /// The dispute that triggered this penalty.
    pub dispute_id: u64,
    pub severity: PenaltySeverity,
    pub points_deducted: u64,
    pub reason: String,
    pub applied_at: u64,
}
