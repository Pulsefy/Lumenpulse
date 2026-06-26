use soroban_sdk::{contracttype, Address, String};

/// Metadata a proposer provides about their project.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ProjectMetadata {
    /// Human-readable project name (max 100 chars).
    pub name: String,
    /// Project description / pitch (max 1000 chars).
    pub description: String,
    /// Link to a IPFS/Arweave doc or website.
    pub url: String,
    /// On-chain address that will receive matching funds.
    pub funding_address: Address,
}

/// Lifecycle status of a proposed project.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum ProjectStatus {
    /// Proposal submitted, voting in progress.
    Pending,
    /// Threshold met — eligible for matching funds.
    Verified,
    /// Rejected by community vote, admin, or window expiry.
    Rejected,
}

/// Full on-chain state for a proposal.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ProposalState {
    pub project_id: u64,
    pub proposer: Address,
    pub metadata: ProjectMetadata,
    pub status: ProjectStatus,
    /// Cumulative reputation-weighted YES votes.
    pub yes_votes: u64,
    /// Cumulative reputation-weighted NO votes.
    pub no_votes: u64,
    /// Snapshot of total reputation at time of first vote.
    pub total_voting_power_snapshot: u64,
    /// Whether the deposit has been returned (Verified path only).
    pub deposit_returned: bool,
    pub created_ledger: u32,
    pub voting_ends_ledger: u32,
}

/// Individual vote record stored per (project_id, voter).
#[contracttype]
#[derive(Clone, Debug)]
pub struct VoteRecord {
    pub voter: Address,
    pub project_id: u64,
    /// true = YES / verify, false = NO / reject.
    pub approve: bool,
    /// Voting power used (reputation score at vote time).
    pub voting_power: u64,
    pub ledger: u32,
}
