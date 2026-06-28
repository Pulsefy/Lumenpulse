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
    SameBeneficiary = 10,
    // ── Multisig proposal errors ──────────────────────────────
    ProposalNotFound = 11,
    ProposalNotApproved = 12,
    ProposalAlreadySigned = 13,
    ProposalExpired = 14,
    ProposalNotActive = 15,
    WrongProposalAction = 16,
    InvalidMultisigConfig = 17,
    TooManySigners = 18,
}
