use soroban_sdk::{contracttype, Address, String, Vec};

// TTL constants for Soroban storage rent management.
// LEDGER_THRESHOLD: if the remaining TTL falls below this value, extend it.
// LEDGER_BUMP: the new TTL to set when extending (≈30 days at 5 s/ledger).
pub const LEDGER_THRESHOLD: u32 = 100_000;
pub const LEDGER_BUMP: u32 = 518_400;

/// Named pause scopes for the contributor registry.
///
/// - `Contribution` — blocks `register_contributor` and `gasless_register`.
/// - `Governance`   — blocks all multisig operations: `propose`, `sign`,
///                    `cancel_proposal`, `expire_proposal`,
///                    `set_multisig_config`, and any multisig-gated admin
///                    actions (`suspend_attestation`, `revoke_attestation`,
///                    `restore_attestation`, `grant_badge`, `revoke_badge`,
///                    `apply_reputation_penalty`, `update_contributor` via
///                    admin path).
///
/// Read-only queries (`get_contributor`, `get_admin`, etc.) are never blocked.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ContribPauseScope {
    Contribution = 1,
    Governance = 2,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Contributor(Address),
    GitHubIndex(String),
    RegistrationNonce(Address),

    // ── Badge keys ────────────────────────────────────────────
    Badges(Address),

    // ── Penalty keys ──────────────────────────────────────────
    /// Latest penalty record for a contributor (keyed by contributor address).
    ReputationPenalty(Address),

    // ── Granular pause scope flags ────────────────────────────
    /// Per-scope pause flag.  Key: `ScopePaused(ContribPauseScope)`.
    ScopePaused(ContribPauseScope),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContributorData {
    pub address: Address,
    pub github_handle: String,
    pub reputation_score: u64,
    pub registered_timestamp: u64,
    pub status: AttestationStatus,
}

/// Lifecycle state of a contributor's attestation.
///
/// `Revoked` is terminal — there is no path back to `Active` once revoked,
/// by design (revocation is meant for confirmed abuse/policy violations).
/// `Suspended` is reversible via `restore_attestation`.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum AttestationStatus {
    Active = 0,
    Suspended = 1,
    Revoked = 2,
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

/// The set of privileged actions that require a multisig proposal.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProposalAction {
    SetAdmin(Address),
    UpdateReputation(Address, u64),
    IssueBadge(Address, Badge),
    RevokeBadge(Address, Badge),
    ApplyPenalty(Address, u64, PenaltySeverity, u64, String),
    SetMultisigConfig(Vec<multisig_guard::Signer>, u32),
    UpdateProfile(Address, String),
    SuspendAttestation(Address),
    RevokeAttestation(Address),
    RestoreAttestation(Address),
    Upgrade,
}
