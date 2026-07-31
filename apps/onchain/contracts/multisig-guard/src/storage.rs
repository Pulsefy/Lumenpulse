use soroban_sdk::{contracttype, Address, Val, Vec};

pub const PROPOSAL_TTL_SECS: u64 = 72 * 60 * 60;
pub const MAX_SIGNERS: u32 = 10;
pub const LEDGER_THRESHOLD: u32 = 120_960;
pub const LEDGER_BUMP: u32 = 241_920;

#[contracttype]
#[derive(Clone)]
pub enum MultisigDataKey {
    MultisigConfig,
    Proposal(u64),
    NextProposalId,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Signer {
    pub address: Address,
    pub weight: u32,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct MultisigConfig {
    pub signers: Vec<Signer>,
    pub threshold: u32,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ProposalStatus {
    Pending = 0,
    Approved = 1,
    Executed = 2,
    Expired = 3,
    Cancelled = 4,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Proposal {
    pub id: u64,
    pub action: Vec<Val>,
    pub proposer: Address,
    pub created_at: u64,
    pub expires_at: u64,
    pub status: ProposalStatus,
    pub signers: Vec<Address>,
    pub weight_collected: u32,
}
