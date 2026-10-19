//! Ledger (time / sequence) helpers.
//!
//! Tests used to inline `env.ledger().set_timestamp(...)` and
//! `env.ledger().with_mut(|li| li.sequence_number += n)` everywhere. These
//! wrappers give that a name and keep it consistent.

use soroban_sdk::{testutils::Ledger, Env};

/// The current ledger timestamp, in seconds.
pub fn timestamp(env: &Env) -> u64 {
    env.ledger().timestamp()
}

/// Move the ledger timestamp to `timestamp`.
pub fn set_time(env: &Env, timestamp: u64) {
    env.ledger().set_timestamp(timestamp);
}

/// Advance the ledger timestamp by `seconds`.
pub fn advance_time(env: &Env, seconds: u64) {
    let now = env.ledger().timestamp();
    env.ledger().set_timestamp(now + seconds);
}

/// Set the ledger sequence number.
pub fn set_sequence(env: &Env, sequence: u32) {
    env.ledger().with_mut(|li| li.sequence_number = sequence);
}

/// Advance the ledger sequence number by `ledgers`.
pub fn advance_sequence(env: &Env, ledgers: u32) {
    env.ledger().with_mut(|li| li.sequence_number += ledgers);
}
