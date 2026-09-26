# Stellar Sequence Number Management

Backend-submitted Stellar transactions all sign with the same server key
(`STELLAR_SERVER_SECRET`). Stellar only accepts a transaction whose
`tx.seqNum` equals `account.seqNum + 1`, so two concurrent submissions that
each read the account sequence from the network race: both build with sequence
`N + 1` and the loser is rejected with `tx_bad_seq`.

Before this change that rejection surfaced as an opaque
`SOROBAN_SUBMISSION_FAILED` error and the operation was lost.

## How it works

`apps/backend/src/stellar/services/sequence-manager.service.ts` owns sequence
numbers for every submission path.

1. **Per-account lock.** A keyed mutex (`KeyedMutex`) serialises the *allocation*
   critical section only — never the whole submit/confirm cycle — so
   concurrently submitted transactions do not block on each other.
2. **Managed pool.** The first allocation for an account reads the sequence
   from Soroban RPC and caches the next value to hand out. Every subsequent
   allocation increments that in-process cursor, so 25 parallel callers get 25
   distinct sequences with a single network round-trip.
3. **`tx_bad_seq` detection.** `extractTransactionResultCode()` reads the
   `errorResult` XDR returned by `sendTransaction` and normalises the SDK union
   member (`txBadSeq`) to the canonical `tx_bad_seq` label.
   `SorobanRpcClientService.sendTransaction` raises
   `SorobanErrorCode.SUBMISSION_BAD_SEQUENCE` carrying that `resultCode`, and
   the retry loop in `SequenceManagerService.withSequence()` invalidates the
   cache, re-reads the authoritative sequence from the network (resync) and
   retries with a fresh sequence.
4. **Bounded retries.** `DEFAULT_BAD_SEQ_RETRIES` (3) retries after the initial
   attempt. A sequence gap costs at most one extra attempt: the resync pulls
   the cursor back to the chain value, so the retry always uses a usable
   sequence. If the budget is exhausted the last `tx_bad_seq` error is
   rethrown and mapped to a client-facing error instead of being swallowed.

### Callers

Every backend path that submits a transaction signed with
`STELLAR_SERVER_SECRET` now allocates its source account through
`withSequence()` instead of calling `getAccount()` directly:

| Caller | Contract operations | File |
| --- | --- | --- |
| Matching pool admin | `create_round`, `approve_project` | `apps/backend/src/stellar/services/matching-pool-admin.service.ts` |
| Treasury | `allocate_budget`, `rotate_beneficiary` | `apps/backend/src/treasury/treasury-soroban.client.ts` |
| Vesting wallet | `create_vesting`, `create_vesting_with_milestone` | `apps/backend/src/vesting-wallet/vesting-wallet-soroban.client.ts` |
| Contributor registry (gasless relayer) | `register_contributor_with_sig` | `apps/backend/src/contributor-registry/contributor-registry.service.ts` |

Read-only simulations (`get_claimable`, `get_contributor`, `get_reputation`,
`get_registration_nonce`, `buildRegistrationXdr`) intentionally keep using
`getAccount()`/`rawServer` directly: they never submit, so consuming a pooled
sequence there would burn a sequence for nothing.

## Metrics

| Metric | Labels | Meaning |
| --- | --- | --- |
| `stellar_submission_failures_total` | `result_code` | Submission rejections, labelled by the Stellar result code (`tx_bad_seq`, `tx_insufficient_fee`, …). `unknown` when the code cannot be decoded. |
| `stellar_sequence_allocations_total` | `account` | Sequence numbers reserved from the managed pool. |
| `stellar_sequence_bad_seq_retries_total` | `account` | `tx_bad_seq` rejections retried with a fresh sequence. |
| `stellar_sequence_resyncs_total` | `account` | Times the pool was re-read from the network. |
| `stellar_sequence_reservations_in_flight` | `account` | Reservations currently held. Should return to `0`; a sustained non-zero value indicates a leaked reservation. |

Alert on `rate(stellar_submission_failures_total{result_code="tx_bad_seq"}[5m])`
sustained above zero: with the managed pool in place a steady stream of
`tx_bad_seq` means another process is signing with the same server key.

## Channel accounts: ruled out

Channel accounts (extra funded source accounts used round-robin to parallelise
submissions) are **not** used. The reasons, as required by the acceptance
criteria:

* The backend is configured with a **single** admin key (`STELLAR_SERVER_SECRET`
  → `config.stellar.serverSecret`). Matching-pool administration, treasury
  releases and testnet bootstrap all sign with it. There is no provisioned pool
  of additional funded accounts, and no operational flow to top them up.
* All backend submission paths are **admin-initiated and low frequency**
  (round creation, project approval, budget allocation, beneficiary rotation).
  The per-account lock removes contention completely at this volume.
* Channel accounts add real cost and risk — N funded accounts, N key materials
  to rotate, N balances to monitor — for throughput this workload does not
  need.
* If the submission rate ever outgrows a single in-flight transaction per
  account, channel accounts are the correct next step. `KeyedMutex` is already
  keyed per account, so `SequenceManagerService` supports multiple accounts
  without change; only the keypair selection strategy would be added.

## Tests

`apps/backend/src/stellar/services/sequence-manager.service.spec.ts`

* 25 concurrent allocations produce 25 unique sequences with one network read.
* A deterministic two-caller race (both queued before the single `getAccount`
  read settles) reproduces the contention the fix removes: sequences `501` and
  `502` instead of two identical `501`s.
* A `tx_bad_seq` rejection whose sequence was consumed by another submitter is
  retried with a freshly resynced sequence (`101` → `151`).
* Unrelated submission failures are not retried.
* The retry budget is bounded and the reservation is always released, including
  on failure.
