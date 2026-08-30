use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum TreasuryError {
    NotInitialized = 1301,
    AlreadyInitialized = 1302,
    Unauthorized = 1303,
    InvalidAmount = 1304,
    InvalidDuration = 1305,
    InvalidStartTime = 1306,
    StreamNotFound = 1307,
    NothingToClaim = 1308,
    Reentrancy = 1309,
    AlreadyExecuted = 1310,
    SameBeneficiary = 1311,
    // ── Multisig proposal errors ──────────────────────────────
    ProposalNotFound = 1312,
    ProposalNotApproved = 1313,
    ProposalAlreadySigned = 1314,
    ProposalExpired = 1315,
    ProposalNotActive = 1316,
    WrongProposalAction = 1317,
    InvalidMultisigConfig = 1318,
    TooManySigners = 1319,
    // ── Cliff / schedule preview errors ───────────────────────
    /// Cliff time supplied for a stream was invalid: not yet at start_time,
    /// or cliff_time + step would overflow u64.
    InvalidCliffTime = 1320,
    /// A preview query received a zero step or step > max allowed.
    InvalidScheduleStep = 1321,
    /// preview_schedule asked for too many entries (caps iteration cost).
    TooManyInstallments = 1322,
    /// Total unreleased obligations across all streams exceed held balance.
    Insolvent = 1323,
}
