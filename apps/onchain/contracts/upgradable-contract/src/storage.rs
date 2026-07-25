use soroban_sdk::{contracttype, Address, BytesN};

/// TTL constants for Soroban storage rent management.
/// LEDGER_THRESHOLD: if the remaining TTL falls below this value, extend it.
/// LEDGER_BUMP: the new TTL to set when extending (≈30 days at 5 s/ledger).
pub const LEDGER_THRESHOLD: u32 = 100_000;
pub const LEDGER_BUMP: u32 = 518_400;

/// Minimum delay before queued operations may execute (24 hours).
pub const MIN_DELAY_SECONDS: u64 = 86_400;

/// Grace period after `execute_after` during which the operation remains valid (7 days).
/// After `execute_after + GRACE_PERIOD_SECONDS`, the operation expires and cannot be executed.
pub const GRACE_PERIOD_SECONDS: u64 = 604_800;

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
    pub expires_at: u64,
}
