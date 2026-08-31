use soroban_sdk::{contracttype, Address, BytesN};

/// TTL constants for Soroban storage rent management.
/// LEDGER_THRESHOLD: if the remaining TTL falls below this value, extend it.
/// LEDGER_BUMP: the new TTL to set when extending (≈30 days at 5 s/ledger).
pub const LEDGER_THRESHOLD: u32 = 100_000;
pub const LEDGER_BUMP: u32 = 518_400;

/// Minimum delay before queued operations may execute.
pub const MIN_DELAY_SECONDS: u64 = 86_400; // 24 hours

/// Window after `execute_after` during which a ready operation may still be
/// executed. Once this elapses the operation can no longer be executed (it
/// must be re-queued); it stays in storage, queryable, until cancelled.
pub const GRACE_PERIOD_SECONDS: u64 = 7 * 24 * 60 * 60; // 7 days

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
    pub expires_at: u64,
    pub created_at: u64,
}

/// Freshness classification for a queued operation, exposed so callers can
/// check status without doing timestamp arithmetic themselves or triggering
/// `execute_operation`'s rejection.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OperationStatus {
    Pending,
    Ready,
    Expired,
}
