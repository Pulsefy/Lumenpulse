use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContributorError {
    NotInitialized = 1001,
    AlreadyInitialized = 1002,
    Unauthorized = 1003,
    ContributorNotFound = 1004,
    ContributorAlreadyExists = 1005,
    InvalidGitHubHandle = 1006,
    ReputationOverflow = 1007,
    GitHubHandleTaken = 1008,
    InvalidMultisigConfig = 1009,
    TooManySigners = 1010,
    ProposalNotFound = 1011,
    InvalidProposalStatus = 1012,
    ProposalExpired = 1013,
    AlreadySigned = 1014,
    BelowThreshold = 1015,
    InvalidNonce = 1016,
    InvalidSignature = 1017,
    AttestationNotActive = 1018,
    AttestationNotSuspended = 1019,
    AttestationAlreadyRevoked = 1020,
    /// The Contribution scope (register_contributor, gasless_register) is paused.
    ContributionScopePaused = 1021,
    /// The Governance scope (multisig proposals and admin-gated mutations) is paused.
    GovernanceScopePaused = 1022,
}
