use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum MatchingPoolError {
    NotInitialized = 700,
    AlreadyInitialized = 701,
    Unauthorized = 702,
    RoundNotFound = 703,
    RoundNotActive = 704,
    RoundAlreadyFinalized = 705,
    RoundNotFinalized = 706,
    ProjectNotEligible = 707,
    ProjectAlreadyEligible = 708,
    InvalidAmount = 709,
    InsufficientPoolBalance = 710,
    NoEligibleProjects = 711,
    RoundStillOpen = 712,
    MatchAlreadyDistributed = 713,
    InvalidRoundDates = 714,
    /// Legacy: kept for backwards compatibility; granular codes preferred.
    ContractPaused = 715,
    Reentrancy = 716,
    ContributionCapExceeded = 717,
    /// The Contribution scope (fund_pool / record_contribution) is paused.
    ContributionScopePaused = 718,
    /// The Payout scope (distribute_matching_funds) is paused.
    PayoutScopePaused = 719,
    /// The Governance scope (create_round, finalize_round, admin ops) is paused.
    GovernanceScopePaused = 720,
}
