use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContributorError {
    NotInitialized = 1100,
    AlreadyInitialized = 1101,
    Unauthorized = 1102,
    ContributorNotFound = 1103,
    ContributorAlreadyExists = 1104,
    InvalidGitHubHandle = 1105,
    ReputationOverflow = 1106,
    GitHubHandleTaken = 1107,
    InvalidMultisigConfig = 1108,
    TooManySigners = 1109,
    ProposalNotFound = 1110,
    InvalidProposalStatus = 1111,
    ProposalExpired = 1112,
    AlreadySigned = 1113,
    BelowThreshold = 1114,
    InvalidNonce = 1115,
    InvalidSignature = 1116,
    AttestationNotActive = 1117,
    AttestationNotSuspended = 1118,
    AttestationAlreadyRevoked = 1119,
    /// The Contribution scope (register_contributor, gasless_register) is paused.
    ContributionScopePaused = 1120,
    /// The Governance scope (multisig proposals and admin-gated mutations) is paused.
    GovernanceScopePaused = 1121,
}
