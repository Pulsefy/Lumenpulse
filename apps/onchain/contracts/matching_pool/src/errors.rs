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
    /// The entire contract is paused (legacy / global pause). Kept for
    /// backward-compatibility; new code should prefer `ScopePaused`.
    ContractPaused = 16,
    Reentrancy = 17,
    /// A specific action domain (scope) is currently paused. The caller
    /// should retry after the scope is unpaused via `unpause_scope`.
    ScopePaused = 18,
}
