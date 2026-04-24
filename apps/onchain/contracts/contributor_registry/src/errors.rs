use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContributorError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    ContributorNotFound = 4,
    ContributorAlreadyExists = 5,
    InvalidGitHubHandle = 6,
    ReputationOverflow = 7,
    GitHubHandleTaken = 8,
    InvalidMultisigConfig = 9,
    TooManySigners = 10,
    ProposalNotFound = 11,
    InvalidProposalStatus = 12,
    ProposalExpired = 13,
    AlreadySigned = 14,
    BelowThreshold = 15,
    InvalidNonce = 16,
    InvalidSignature = 17,
}
