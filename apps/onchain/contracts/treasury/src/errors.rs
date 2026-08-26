use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum TreasuryError {
    NotInitialized = 1300,
    AlreadyInitialized = 1301,
    Unauthorized = 1302,
    InvalidAmount = 1303,
    InvalidDuration = 1304,
    InvalidStartTime = 1305,
    StreamNotFound = 1306,
    NothingToClaim = 1307,
    Reentrancy = 1308,
    AlreadyExecuted = 1309,
    SameBeneficiary = 1310,
    // ── Multisig proposal errors ──────────────────────────────
    ProposalNotFound = 1311,
    ProposalNotApproved = 1312,
    ProposalAlreadySigned = 1313,
    ProposalExpired = 1314,
    ProposalNotActive = 1315,
    WrongProposalAction = 1316,
    InvalidMultisigConfig = 1317,
    TooManySigners = 1318,
    // ── Cliff / schedule preview errors ───────────────────────
    /// Cliff time supplied for a stream was invalid: not yet at start_time,
    /// or cliff_time + step would overflow u64.
    InvalidCliffTime = 1319,
    /// A preview query received a zero step or step > max allowed.
    InvalidScheduleStep = 1320,
    /// preview_schedule asked for too many entries (caps iteration cost).
    TooManyInstallments = 1321,
    /// Contract does not have sufficient balance to cover obligations
    Insolvent = 1322,
}
