use soroban_sdk::{contracttype, Address, Bytes, BytesN, Symbol};

/// Configuration for the timelock contract
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TimelockConfig {
    /// Minimum delay (in seconds) before a proposal can be executed
    pub min_delay: u64,
    /// Maximum delay (in seconds) for proposal validity
    pub max_delay: u64,
}

/// A timelocked proposal
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TimelockProposal {
    /// Unique proposal identifier (SHA256 hash)
    pub id: BytesN<32>,
    /// Address of the proposer
    pub proposer: Address,
    /// Type of action to execute (e.g., "update_config", "pause", "set_admin", "upgrade")
    pub action_type: Symbol,
    /// Target contract address where the action will be executed
    pub target_contract: Address,
    /// Encoded parameters for the action
    pub payload: Bytes,
    /// Delay in seconds before execution
    pub delay: u64,
    /// Timestamp when the proposal was queued
    pub queued_at: u64,
    /// Timestamp when the proposal can be executed
    pub execute_at: u64,
    /// Timestamp when the proposal expires
    pub expires_at: u64,
    /// Whether the proposal has been executed
    pub executed: bool,
    /// Whether the proposal has been cancelled
    pub cancelled: bool,
}

/// Storage key enumeration
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Admin address
    Admin,
    /// Timelock configuration
    Config,
    /// Proposal storage (proposal_id -> TimelockProposal)
    Proposal(BytesN<32>),
    /// Nonce counter for generating unique proposal IDs
    Nonce,
}

/// Ledger TTL constants
pub const LEDGER_THRESHOLD: u32 = 100_000;
pub const LEDGER_BUMP: u32 = 100_000;
