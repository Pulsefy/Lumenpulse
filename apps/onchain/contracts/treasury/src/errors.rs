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
}
