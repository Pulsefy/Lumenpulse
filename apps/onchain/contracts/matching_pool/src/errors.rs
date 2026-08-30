use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum MatchingPoolError {
    NotInitialized = 2101,
    AlreadyInitialized = 2102,
    Unauthorized = 2103,
    RoundNotFound = 2104,
    RoundNotActive = 2105,
    RoundAlreadyFinalized = 2106,
    RoundNotFinalized = 2107,
    ProjectNotEligible = 2108,
    ProjectAlreadyEligible = 2109,
    InvalidAmount = 2110,
    InsufficientPoolBalance = 2111,
    NoEligibleProjects = 2112,
    RoundStillOpen = 2113,
    MatchAlreadyDistributed = 2114,
    InvalidRoundDates = 2115,
    /// Legacy: kept for backwards compatibility; granular codes preferred.
    ContractPaused = 2116,
    Reentrancy = 2117,
    ContributionCapExceeded = 2118,
    /// The Contribution scope (fund_pool / record_contribution) is paused.
    ContributionScopePaused = 2119,
    /// The Payout scope (distribute_matching_funds) is paused.
    PayoutScopePaused = 2120,
    /// The Governance scope (create_round, finalize_round, admin ops) is paused.
    GovernanceScopePaused = 2121,
}
