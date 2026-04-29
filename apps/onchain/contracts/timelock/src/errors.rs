use soroban_sdk::contracterror;

/// Timelock error codes
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum TimelockError {
    /// Contract already initialized
    AlreadyInitialized = 100,
    /// Contract not initialized
    NotInitialized = 101,
    /// Caller is not authorized
    Unauthorized = 102,
    /// Invalid delay configuration
    InvalidDelay = 103,
    /// Delay too short (below min_delay)
    DelayTooShort = 104,
    /// Delay too long (above max_delay)
    DelayTooLong = 105,
    /// Proposal already exists
    ProposalAlreadyExists = 106,
    /// Proposal not found
    ProposalNotFound = 107,
    /// Proposal already executed
    AlreadyExecuted = 108,
    /// Proposal has been cancelled
    ProposalCancelled = 109,
    /// Delay has not elapsed yet
    DelayNotElapsed = 110,
    /// Proposal has expired
    ProposalExpired = 111,
}
