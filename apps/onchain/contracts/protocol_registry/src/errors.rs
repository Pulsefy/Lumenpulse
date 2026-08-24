use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RegistryError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    ModuleNotFound = 4,
    ModuleAlreadyRegistered = 5,
    ModuleInactive = 6,
    ContractPaused = 7,
    /// Attempted to register/update with a version ≤ the current recorded version.
    VersionNotIncremented = 8,
    // ── Multi-admin quorum errors ───────────────────────────────
    // Appended after the pre-existing codes so already-emitted discriminants
    // keep their meaning for off-chain consumers.
    /// A quorum-gated action was called before any quorum policy was installed.
    QuorumNotConfigured = 9,
    /// `configure_quorum` was called twice; use a `SetQuorumConfig` proposal to
    /// rotate an existing signer set.
    QuorumAlreadyConfigured = 10,
    /// Empty signer set, zero weight, zero threshold, or a threshold larger
    /// than the total signer weight (which would deadlock every action).
    InvalidQuorumConfig = 11,
    /// Signer set exceeds `quorum::MAX_SIGNERS`.
    TooManySigners = 12,
    ProposalNotFound = 13,
    /// The proposal exists but has not yet collected enough weight.
    ProposalNotApproved = 14,
    /// This signer has already approved this proposal.
    ProposalAlreadySigned = 15,
    ProposalExpired = 16,
    /// The proposal is executed, cancelled, or expired and can no longer move.
    ProposalNotActive = 17,
    /// The approved action (or its bound parameters) does not match the action
    /// being executed.
    WrongProposalAction = 18,
}
