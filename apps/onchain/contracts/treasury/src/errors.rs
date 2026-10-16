use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum TreasuryError {
    NotInitialized = 2100,
    AlreadyInitialized = 2101,
    Unauthorized = 2102,
    InvalidAmount = 2103,
    InvalidDuration = 2104,
    InvalidStartTime = 2105,
    StreamNotFound = 2106,
    NothingToClaim = 2107,
    Reentrancy = 2108,
    AlreadyExecuted = 2109,
    SameBeneficiary = 2110,
    // ── Multisig proposal errors ──────────────────────────────
    ProposalNotFound = 2111,
    ProposalNotApproved = 2112,
    ProposalAlreadySigned = 2113,
    ProposalExpired = 2114,
    ProposalNotActive = 2115,
    WrongProposalAction = 2116,
    InvalidMultisigConfig = 2117,
    TooManySigners = 2118,
    // ── Cliff / schedule preview errors ───────────────────────
    /// Cliff time supplied for a stream was invalid: not yet at start_time,
    /// or cliff_time + step would overflow u64.
    InvalidCliffTime = 2119,
    /// A preview query received a zero step or step > max allowed.
    InvalidScheduleStep = 2120,
    /// preview_schedule asked for too many entries (caps iteration cost).
    TooManyInstallments = 2121,
    /// Total unreleased obligations across all streams exceed held balance.
    Insolvent = 2122,
}
