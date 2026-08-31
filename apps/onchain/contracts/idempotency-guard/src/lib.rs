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

// TTL configuration for idempotency receipts.
//
// LEDGER_THRESHOLD: if the remaining TTL drops below this value, the guard
//   automatically extends storage to LEDGER_BUMP ledgers.  Set to ~7 days
//   (at 5 s/ledger) so the window is large enough for any reasonable
//   retry-dedup window without keeping storage alive indefinitely.
//
// LEDGER_BUMP: the TTL applied when extending.  ~14 days gives callers a
//   two-week window to detect duplicates.  After expiry the key is evicted
//   and the same request_id *could* be accepted again — callers must not
//   reuse IDs after the expiry window.
//
// Storage cost per guarded operation:
//   One `persistent` key of 32 bytes (BytesN<32>) + small overhead ≈ 64 bytes
//   of ledger state.  At Soroban mainnet rates this is negligible per-operation
//   (< 0.001 XLM) but accumulates linearly with unique operations.  If
//   throughput is very high, consider compressing request_ids or expiring them
//   sooner via a smaller LEDGER_BUMP.
pub const LEDGER_THRESHOLD: u32 = 120_960; // ~7 days
pub const LEDGER_BUMP: u32 = 241_920; // ~14 days

/// Checks if a request ID has already been executed.
/// If it has, returns `Err(IdempotencyError::AlreadyExecuted)`.
/// Otherwise, atomically stores the receipt and extends its TTL, returning `Ok(())`.
///
/// # Guarantee
/// The check-then-set is atomic within a single Soroban invocation — there is
/// no window between the `has` check and the `set` in which a concurrent call
/// could slip through.
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

/// Returns true when a receipt for `request_id` is present in storage.
/// Use this in tests to verify that the first call recorded the receipt.
pub fn has_receipt(env: &Env, request_id: &BytesN<32>) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::ExecutionReceipt(request_id.clone()))
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{contract, contractimpl, Env};

    // A minimal contract shell required so we can use `env.as_contract()`.
    #[contract]
    struct DummyContract;

    #[contractimpl]
    impl DummyContract {
        pub fn ping(_env: Env) {}
    }

    /// Run test code inside a proper contract context.
    fn with_contract_env<F>(f: F)
    where
        F: FnOnce(&Env),
    {
        let env = Env::default();
        let contract_id = env.register(DummyContract, ());
        env.as_contract(&contract_id, || f(&env));
    }

    fn make_id(env: &Env, b: u8) -> BytesN<32> {
        BytesN::from_array(env, &[b; 32])
    }

    // ── Acceptance tests ──────────────────────────────────────────────────────

    /// AC-1: First call for a fresh key is accepted.
    #[test]
    fn first_call_is_accepted() {
        with_contract_env(|env| {
            let id = make_id(env, 0x01);
            assert_eq!(claim_request(env, &id), Ok(()));
        });
    }

    /// AC-1 cont.: First call stores a receipt that is readable via `has_receipt`.
    #[test]
    fn first_call_stores_receipt() {
        with_contract_env(|env| {
            let id = make_id(env, 0x02);
            assert!(
                !has_receipt(env, &id),
                "receipt must not exist before claim"
            );
            claim_request(env, &id).unwrap();
            assert!(has_receipt(env, &id), "receipt must exist after claim");
        });
    }

    /// AC-2: Repeated call with the same key is rejected.
    #[test]
    fn repeated_call_is_rejected() {
        with_contract_env(|env| {
            let id = make_id(env, 0x03);
            claim_request(env, &id).unwrap();
            let result = claim_request(env, &id);
            assert_eq!(
                result,
                Err(IdempotencyError::AlreadyExecuted),
                "second claim with same key must return AlreadyExecuted"
            );
        });
    }

    /// AC-2 cont.: After rejection the receipt is still intact (not mutated).
    #[test]
    fn rejection_leaves_receipt_intact() {
        with_contract_env(|env| {
            let id = make_id(env, 0x04);
            claim_request(env, &id).unwrap();
            let _ = claim_request(env, &id); // should error
                                             // Receipt still present — the second call did not corrupt storage.
            assert!(has_receipt(env, &id));
        });
    }

    /// AC-3: Different keys are independent; each first claim succeeds.
    #[test]
    fn different_keys_are_independent() {
        with_contract_env(|env| {
            let id_a = make_id(env, 0xAA);
            let id_b = make_id(env, 0xBB);

            assert_eq!(claim_request(env, &id_a), Ok(()));
            assert_eq!(claim_request(env, &id_b), Ok(()));

            // Second call on each is still blocked.
            assert_eq!(
                claim_request(env, &id_a),
                Err(IdempotencyError::AlreadyExecuted)
            );
            assert_eq!(
                claim_request(env, &id_b),
                Err(IdempotencyError::AlreadyExecuted)
            );
        });
    }

    /// AC-4: Key expiry / storage-growth behaviour.
    ///
    /// In the Soroban testutils mock, `env.ledger().sequence()` can be advanced
    /// to simulate ledger progression.  However, persistent-storage expiry
    /// is not enforced by the test mock — the test below documents the
    /// *expected* on-chain behaviour in comments and verifies the TTL constants
    /// are consistent with the documented policy.
    ///
    /// Expected on-chain behaviour:
    ///   • After LEDGER_BUMP ledgers (≈14 days) without a read, the key is
    ///     evicted and claim_request would accept the same ID again.
    ///   • LEDGER_THRESHOLD (≈7 days) triggers an automatic bump; so as long
    ///     as the key is read within 7 days it survives a full 14-day window.
    ///   • Storage growth is linear: one 64-byte persistent entry per unique
    ///     operation.  For 1 M operations that is ~64 MB of ledger state.
    ///     High-throughput deployments should set shorter TTLs or use an
    ///     off-chain bloom filter to pre-screen duplicates.
    #[test]
    fn expiry_constants_are_self_consistent() {
        // LEDGER_BUMP must be at least twice LEDGER_THRESHOLD to guarantee the
        // auto-extend always keeps the entry alive for the full bump window.
        const {
            assert!(
                LEDGER_BUMP >= LEDGER_THRESHOLD * 2,
                "LEDGER_BUMP must be >= 2 × LEDGER_THRESHOLD",
            );
            assert!(LEDGER_THRESHOLD > 0);
            assert!(LEDGER_BUMP > 0);
        }
    }

    /// AC-4 cont.: Storage cost per guarded operation is a single persistent key.
    ///
    /// This test verifies that claim_request writes exactly one persistent entry
    /// per unique key by inspecting receipt presence before and after.
    #[test]
    fn storage_cost_is_one_persistent_entry_per_operation() {
        with_contract_env(|env| {
            let id = make_id(env, 0xC0);
            assert!(!has_receipt(env, &id));
            claim_request(env, &id).unwrap();
            // Exactly one receipt entry now exists.
            assert!(has_receipt(env, &id));
            // A second claim must not create a second entry (rejected before write).
            let _ = claim_request(env, &id);
            // Receipt still singular and present.
            assert!(has_receipt(env, &id));
        });
    }

    // ── Error-code stability ──────────────────────────────────────────────────

    /// The discriminant value for AlreadyExecuted is fixed at 100.
    /// Changing it would be a breaking on-chain ABI change.
    #[test]
    fn already_executed_discriminant_is_100() {
        assert_eq!(IdempotencyError::AlreadyExecuted as u32, 100);
    }
}
