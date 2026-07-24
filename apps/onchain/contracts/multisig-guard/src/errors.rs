use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum MultisigError {
    NotInitialized = 3000,
    Unauthorized = 3001,
    InvalidConfig = 3002,
    TooManySigners = 3003,
    ProposalNotFound = 3004,
    ProposalNotActive = 3005,
    ProposalExpired = 3006,
    ProposalAlreadySigned = 3007,
    ProposalNotApproved = 3008,
    WrongProposalAction = 3009,
}
