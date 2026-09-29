# ADR-0007 — Idempotency Guard: Tests and Adoption on `crowdfund_vault::deposit`

**Status**: Accepted  
**Date**: 2026-08-28  
**Issue**: #1224  

---

## Context

`apps/onchain/contracts/idempotency-guard` shipped as a utility library but had
no tests and was not referenced by any contract, making the duplicate-submission
protection it promises completely ineffective in practice.  Issue #1224
(paired with backend issue #3) requires the guard to be exercised on at least
one fund-moving entry point so that on-chain and off-chain duplicate defenses
are aligned.

`reentrancy-guard` served as the structural model: it has both unit tests
(`tests_reentrancy.rs`) and is actively used by `crowdfund_vault`.

---

## Decision

### 1. Test `idempotency-guard` in isolation (8 tests in `src/lib.rs`)

| Test | What it asserts |
|------|----------------|
| `first_call_is_accepted` | `Ok(())` on a fresh key |
| `first_call_stores_receipt` | `has_receipt()` is false before, true after |
| `repeated_call_is_rejected` | `AlreadyExecuted` on second call |
| `rejection_leaves_receipt_intact` | receipt still present after rejection |
| `different_keys_are_independent` | two distinct keys each succeed once |
| `expiry_constants_are_self_consistent` | `LEDGER_BUMP ≥ 2 × LEDGER_THRESHOLD` |
| `storage_cost_is_one_persistent_entry_per_operation` | exactly one entry per unique key |
| `already_executed_discriminant_is_100` | ABI-stable error code |

A public `has_receipt(env, request_id)` helper was added to `lib.rs` to make
state assertions readable in tests without re-implementing the DataKey lookup.

### 2. Expose `has_receipt` as a library function

This is a test-only helper but is `pub` so downstream crates (including
`crowdfund_vault`'s own test suite) can inspect guard state without duplicating
`DataKey` knowledge.

### 3. Adopt the guard in `crowdfund_vault::deposit`

`deposit` is the primary fund-moving write entry point.  Its new signature is:

```rust
pub fn deposit(
    env: Env,
    user: Address,
    project_id: u64,
    amount: i128,
    request_id: BytesN<32>,   // NEW — caller-supplied idempotency nonce
) -> Result<(), CrowdfundError>
```

The `idempotency_claim` call is the **first** operation inside the reentrancy
guard closure, before any state mutation.  This guarantees:

- A duplicate submission never reaches balance or contribution storage.
- The idempotency check does not fire if the reentrancy guard was already held
  (panic / revert path), so no phantom receipts are written.

`CrowdfundError::AlreadyExecuted = 32` was already reserved; no new error code
was added.

### 4. Five idempotency tests added to `crowdfund_vault`

| Test | Acceptance criterion |
|------|---------------------|
| `test_deposit_idempotency_duplicate_rejected` | AC-1, AC-3: second call with same `request_id` → `AlreadyExecuted`; balance unchanged |
| `test_deposit_idempotency_different_ids_are_independent` | AC-2: two calls with different IDs both accepted |
| `test_deposit_idempotency_rejection_after_multiple_unique_deposits` | AC-3: all three unique IDs accepted, all three re-submissions rejected |
| `test_deposit_idempotency_different_users_same_rid_conflict` | AC-3: `request_id` scope is global, not per-user |
| `test_deposit_idempotency_zero_bytes_id_accepted_once` | edge case: `[0u8; 32]` is a valid ID |

---

## Storage cost per guarded operation

| Item | Value |
|------|-------|
| Storage tier | `persistent` |
| Key size | 32 bytes (`BytesN<32>`) + `DataKey::ExecutionReceipt` discriminant overhead ≈ 4 bytes |
| Value | 1 byte (`bool true`) |
| Total on-ledger footprint | ~40–64 bytes per unique `request_id` |
| TTL window | ~14 days (241 920 ledgers at 5 s/ledger) |
| Auto-extend threshold | ~7 days (120 960 ledgers) |
| Cost at Soroban mainnet rates | < 0.001 XLM per operation (negligible) |
| Growth at 1 M deposits/month | ~64 MB of ledger state before expiry |

After `LEDGER_BUMP` ledgers without a TTL-extend read the key is evicted.
Re-use of the same `request_id` after expiry is therefore possible; callers
**must not** reuse IDs within the ~14-day window.

High-throughput deployments that approach ledger state limits should consider:
- Shorter `LEDGER_BUMP` (e.g., ~3 days) to accelerate eviction.
- An off-chain bloom filter to pre-screen duplicates before on-chain submission.

---

## Alternatives considered

| Alternative | Reason rejected |
|-------------|----------------|
| Scope receipt key to `(project_id, user)` instead of `request_id` | Would not protect against same user genuinely retrying with different amounts; caller cannot distinguish retries from new deposits without a nonce |
| Use `instance` storage for receipts | Instance storage has no per-key TTL; receipts would live forever or share a single TTL, causing unnecessary state bloat |
| Generate `request_id` server-side only | Puts the duplicate-check entirely off-chain; does not satisfy the requirement for on-chain protection |

---

## Consequences

- All callers of `crowdfund_vault::deposit` must now supply a `BytesN<32>` nonce.
- 77 existing test call-sites were mechanically updated to pass unique IDs.
- The `do_deposit` test helper in `invariants.rs` uses a process-wide
  `AtomicU64` counter so proptest workers each see distinct IDs.
- The `idempotency-guard` crate now has `[dev-dependencies]` for
  `soroban-sdk/testutils`.
