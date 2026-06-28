use soroban_sdk::{contracttype, Address, BytesN};

/// TTL constants for Soroban storage rent management.
/// LEDGER_THRESHOLD: if the remaining TTL falls below this value, extend it.
/// LEDGER_BUMP: the new TTL to set when extending (≈30 days at 5 s/ledger).
pub const LEDGER_THRESHOLD: u32 = 100_000;
pub const LEDGER_BUMP: u32 = 518_400;

/// Minimum delay before queued operations may execute.
pub const MIN_DELAY_SECONDS: u64 = 86_400; // 24 hours

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TimelockAction {
    Upgrade(BytesN<32>),
    SetAdmin(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct QueuedOperation {
    pub proposer: Address,
    pub action: TimelockAction,
    pub execute_after: u64,
    pub created_at: u64,
}
