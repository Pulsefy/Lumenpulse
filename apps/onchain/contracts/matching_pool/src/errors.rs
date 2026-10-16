use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum MatchingPoolError {
    NotInitialized = 1600,
    AlreadyInitialized = 1601,
    Unauthorized = 1602,
    RoundNotFound = 1603,
    RoundNotActive = 1604,
    RoundAlreadyFinalized = 1605,
    RoundNotFinalized = 1606,
    ProjectNotEligible = 1607,
    ProjectAlreadyEligible = 1608,
    InvalidAmount = 1609,
    InsufficientPoolBalance = 1610,
    NoEligibleProjects = 1611,
    RoundStillOpen = 1612,
    MatchAlreadyDistributed = 1613,
    InvalidRoundDates = 1614,
    /// Legacy: kept for backwards compatibility; granular codes preferred.
    ContractPaused = 1615,
    Reentrancy = 1616,
    ContributionCapExceeded = 1617,
    /// The Contribution scope (fund_pool / record_contribution) is paused.
    ContributionScopePaused = 1618,
    /// The Payout scope (distribute_matching_funds) is paused.
    PayoutScopePaused = 1619,
    /// The Governance scope (create_round, finalize_round, admin ops) is paused.
    GovernanceScopePaused = 1620,
}
