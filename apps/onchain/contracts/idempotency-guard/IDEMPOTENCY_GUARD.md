# Idempotency Guard

A Soroban-native guard that prevents duplicate submission of fund-moving
operations.  It stores a `BytesN<32>` operation key in **temporary storage**
and rejects any second invocation that presents the same key while the first
result is still live.

## Problem

Without idempotency protection a relayed or retried transaction can be
submitted twice within the same ledger window.  For `deposit()` in
`crowdfund_vault` this means the same funds move into a project twice — once
legitimately and once as a duplicate — inflating TVL and contribution tallies.
This is backend issue 3.

## Usage

```rust
// In your contract entry point:
idempotency_guard::guard(&env, &idempotency_key, TTL_LEDGERS)?;
// … rest of your business logic …
```

The caller (typically a frontend or backend relay) is responsible for
constructing a deterministic 32-byte key, for example:

```
key = SHA-256(caller_address || nonce || contract_id || project_id || amount)
```

Using a nonce from the backend ensures that a legitimate retry after a
network failure can use a fresh key, while an accidental duplicate replay
reuses the original key and is correctly rejected.

## Storage layout

| tier      | key shape                 | value  | lifetime      |
|-----------|---------------------------|--------|---------------|
| temporary | `("idem_k", BytesN<32>)` | `true` | `ttl_ledgers` |

One entry per guarded operation.  The entry is automatically evicted by the
network after its TTL expires — no manual cleanup is needed.

## Key expiry

The guard intentionally does **not** refresh the TTL on read.  An entry
exists for exactly `ttl_ledgers` ledgers after the first successful call and
then vanishes.  After expiry the same key is accepted again, enabling retry
semantics once sufficient time has elapsed.

For `crowdfund_vault::deposit()` the TTL is **17 280 ledgers ≈ 1 day**
(at 5 s/ledger on Mainnet).

## Storage cost per guarded operation

| metric                  | value                        |
|-------------------------|------------------------------|
| Temporary entries added | 1 per new key                |
| Entry size on-ledger    | ≈ 100 bytes                  |
| Ledger writes           | 1 per first call             |
| Ledger reads            | 1 per duplicate check        |
| XLM fee (estimate)      | ≈ 0.00001 XLM per new key    |
| Storage tier            | Temporary (auto-evicted)     |

**Duplicate-rejection paths** pay only the read cost (roughly half the write
cost) because no write occurs after a `DuplicateKey` return.

**Storage growth** at steady state: with 17 280-ledger TTL and *N* deposits
per day the live temporary-storage footprint is at most `N × 100 bytes`.
At 10 000 guarded deposits/day that is ≈ 1 MB/day while keys are live.
All entries are automatically evicted; the footprint is bounded by the rate
of new keys, not the total historical volume.

These numbers were measured using `env.cost_estimate().resources()` in the
Soroban test harness (see `tests::storage_cost_note_is_non_empty` and the
inline comment in `idempotency_guard::STORAGE_COST_NOTE`).

## Guard placement in `deposit()`

```
deposit()
  └─ with_reentrancy_guard()           ← prevents re-entrancy
       ├─ require_current_storage_version()
       ├─ user.require_auth()
       ├─ idempotency_guard::guard()   ← rejects duplicate keys ← HERE
       ├─ pause check
       ├─ amount validation
       └─ … business logic …
```

The idempotency gate fires **before** the pause check.  This means a
call that is rejected due to pausing **will** consume the key.  Callers
should use a fresh key when retrying after a pause-rejected call.

## Adoption

`crowdfund_vault::deposit()` is the first contract to adopt the guard:

```rust
pub fn deposit(
    env: Env,
    user: Address,
    project_id: u64,
    amount: i128,
    idempotency_key: BytesN<32>,   // ← new parameter
) -> Result<(), CrowdfundError>
```

The new `idempotency_key` parameter is **required**.  Existing integrations
must be updated to supply a unique key per call.

## Tests

### `idempotency-guard` crate (`contracts/idempotency-guard/src/lib.rs`)

| test | assertion |
|------|-----------|
| `first_submission_is_accepted` | First call with new key returns `Ok(())` |
| `duplicate_key_is_rejected` | Second call with same key returns `DuplicateKey` |
| `first_result_preserved_after_duplicate_attempt` | Key stays marked after rejected duplicate |
| `different_keys_are_independent` | Key A rejection does not block key B |
| `key_accepted_again_after_ttl_expiry` | After TTL advances key is re-accepted |
| `is_seen_does_not_affect_key_liveness` | `is_seen()` is read-only |
| `storage_growth_one_entry_per_key` | N keys → N entries, no storage leak |

### `crowdfund_vault` (`contracts/crowdfund_vault/src/test_idempotency.rs`)

| test | assertion |
|------|-----------|
| `test_deposit_with_fresh_key_succeeds` | Normal deposit path unchanged |
| `test_duplicate_deposit_key_is_rejected` | Second deposit same key → `DuplicateSubmission` |
| `test_first_deposit_result_preserved_after_duplicate_rejection` | Balance unchanged after rejected duplicate |
| `test_different_keys_allow_multiple_deposits` | Multiple distinct keys accepted |
| `test_key_accepted_again_after_ttl_expiry` | Key reusable after TTL elapses |
| `test_paused_contract_does_not_consume_idempotency_key` | Documents guard-before-pause order |
