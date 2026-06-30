#![no_std]

use soroban_sdk::{contracterror, contracttype, BytesN, Env};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum IdempotencyError {
    AlreadyExecuted = 100,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    ExecutionReceipt(BytesN<32>),
}

// TTL configuration:
// LEDGER_THRESHOLD: if the remaining TTL falls below this, extend it.
// LEDGER_BUMP: the new TTL to set when extending (≈14 days at 5s/ledger).
const LEDGER_THRESHOLD: u32 = 120_960; // ~7 days
const LEDGER_BUMP: u32 = 241_920; // ~14 days

/// Checks if a request ID has already been executed.
/// If it has, returns Err(IdempotencyError::AlreadyExecuted).
/// Otherwise, stores the receipt and extends its TTL, returning Ok(()).
pub fn claim_request(env: &Env, request_id: &BytesN<32>) -> Result<(), IdempotencyError> {
    let key = DataKey::ExecutionReceipt(request_id.clone());
    if env.storage().persistent().has(&key) {
        return Err(IdempotencyError::AlreadyExecuted);
    }
    env.storage().persistent().set(&key, &true);
    env.storage()
        .persistent()
        .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
    Ok(())
}
