use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum MatchingPoolError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    RoundNotFound = 4,
    RoundNotActive = 5,
    RoundAlreadyFinalized = 6,
    RoundNotFinalized = 7,
    ProjectNotEligible = 8,
    ProjectAlreadyEligible = 9,
    InvalidAmount = 10,
    InsufficientPoolBalance = 11,
    NoEligibleProjects = 12,
    RoundStillOpen = 13,
    MatchAlreadyDistributed = 14,
    InvalidRoundDates = 15,
    ContractPaused = 16,
    Reentrancy = 17,
    /// Contribution would exceed the round-level total cap
    RoundCapExceeded = 18,
    /// Contribution would exceed the per-contributor (anti-whale) cap
    ContributorCapExceeded = 19,
    /// Cap value must be non-negative
    InvalidCapValue = 20,
}

