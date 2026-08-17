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
    /// Legacy: kept for backwards compatibility; granular codes preferred.
    ContractPaused = 16,
    Reentrancy = 17,
    ContributionCapExceeded = 18,
    /// The Contribution scope (fund_pool / record_contribution) is paused.
    ContributionScopePaused = 19,
    /// The Payout scope (distribute_matching_funds) is paused.
    PayoutScopePaused = 20,
    /// The Governance scope (create_round, finalize_round, admin ops) is paused.
    GovernanceScopePaused = 21,
}
