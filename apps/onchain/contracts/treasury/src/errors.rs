use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum TreasuryError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    InvalidAmount = 4,
    InvalidDuration = 5,
    InvalidStartTime = 6,
    StreamNotFound = 7,
    NothingToClaim = 8,
    Reentrancy = 9,
    AlreadyExecuted = 10,
    SameBeneficiary = 11,
    // ── Multisig proposal errors ──────────────────────────────
    ProposalNotFound = 12,
    ProposalNotApproved = 13,
    ProposalAlreadySigned = 14,
    ProposalExpired = 15,
    ProposalNotActive = 16,
    WrongProposalAction = 17,
    InvalidMultisigConfig = 18,
    TooManySigners = 19,
    // ── Cliff / schedule preview errors ───────────────────────
    /// Cliff time supplied for a stream was invalid: not yet at start_time,
    /// or cliff_time + step would overflow u64.
    InvalidCliffTime = 20,
    /// A preview query received a zero step or step > max allowed.
    InvalidScheduleStep = 21,
    /// preview_schedule asked for too many entries (caps iteration cost).
    TooManyInstallments = 22,
    /// Total unreleased obligations across all streams exceed held balance.
    Insolvent = 23,
}
