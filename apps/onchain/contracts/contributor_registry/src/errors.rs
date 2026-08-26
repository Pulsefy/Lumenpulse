use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContributorError {
    NotInitialized = 100,
    AlreadyInitialized = 101,
    Unauthorized = 102,
    ContributorNotFound = 103,
    ContributorAlreadyExists = 104,
    InvalidGitHubHandle = 105,
    ReputationOverflow = 106,
    GitHubHandleTaken = 107,
    InvalidMultisigConfig = 108,
    TooManySigners = 109,
    ProposalNotFound = 110,
    InvalidProposalStatus = 111,
    ProposalExpired = 112,
    AlreadySigned = 113,
    BelowThreshold = 114,
    InvalidNonce = 115,
    InvalidSignature = 116,
    AttestationNotActive = 117,
    AttestationNotSuspended = 118,
    AttestationAlreadyRevoked = 119,
    /// The Contribution scope (register_contributor, gasless_register) is paused.
    ContributionScopePaused = 120,
    /// The Governance scope (multisig proposals and admin-gated mutations) is paused.
    GovernanceScopePaused = 121,
}
