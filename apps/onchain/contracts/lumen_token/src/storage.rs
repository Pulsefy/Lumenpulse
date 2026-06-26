/// TTL constants for Soroban storage rent management.
/// LEDGER_THRESHOLD: if the remaining TTL falls below this value, extend it.
/// LEDGER_BUMP: the new TTL to set when extending (≈30 days at 5 s/ledger).
pub const LEDGER_THRESHOLD: u32 = 100_000;
pub const LEDGER_BUMP: u32 = 518_400;
