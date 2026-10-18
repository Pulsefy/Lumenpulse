# Backend Stellar sequence coordination

## Submission boundary

Every server-signed submission calls the singleton
`SorobanRpcClientService.withSequence(source, callback)`. The callback receives a
fresh SDK `Account` and builds, simulates, signs, and submits the transaction.
Matching-pool admin operations, treasury releases/beneficiary rotation, vesting
creation, and contributor gasless registration all use this boundary. Read-only
simulations and unsigned XDR generation do not reserve sequences.

A per-source FIFO lock covers lookup through ledger inclusion, not just number
allocation. Merely assigning consecutive numbers is insufficient: a later
transaction can reach the ledger before its predecessor and still get
`tx_bad_seq`. A pending submission therefore keeps its account locked until RPC
reports SUCCESS or FAILED (30s bounded polling). Treasury and vesting callbacks
already wait for confirmation and return SUCCESS, avoiding duplicate polling.
Different accounts use independent locks; completed queues are removed.

Only a definitive `tx_bad_seq` rejection retries the entire callback, at most
three attempts with 250ms/500ms backoff. Each attempt re-reads the authoritative
sequence, rebuilds, resimulates, and signs fresh bytes. No cursor guesses or
JavaScript number conversions are used. Unrelated rejections propagate without
rebuilding. An ambiguous network/confirmation timeout never triggers a fresh
signed transaction: the original may still land. Existing transport retries can
resend identical bytes safely; they do not allocate another sequence.

## Channel accounts and deployment limits

Channel accounts are explicitly ruled out for this change. Admin contract
operations and relayer fee payment currently use one configured server identity;
channels require funding, additional key custody, and changes to the source vs.
authorizer signing model. Serializing low-frequency admin operations is the
smaller, auditable fix. Friendbot bootstrap is faucet-managed and does not sign
with the backend's source account, so it is outside this lock.

Locks are process-local. Run a single active signing process per configured
source account for serialization guarantees. Independent signers/replicas can
still contend; bounded fresh-sequence retries handle definitive rejections, not
distributed exclusion. Multi-writer deployments require a distributed lock or
separate channel/source accounts; this PR does not claim otherwise.

## Result-code metrics and API errors

`stellar_submission_failures_total{result_code}` is registered with the existing
application metrics registry and exposed by `/metrics`. It counts rejected RPC
submissions and definitive failed ledger outcomes observed by the coordinator.
The label is derived from the SDK's transaction-result XDR enum (for example
`tx_bad_seq` or `tx_insufficient_fee`); malformed/unavailable XDR maps to `unknown`.
It does not label by address, transaction hash, or arbitrary error text.
Transport failures remain in the existing Soroban RPC error metrics because no
Stellar transaction result is available.

Exhausted sequence rejections retain `resultCode: tx_bad_seq` and map to the
standard transaction-failed API error. Treasury/vesting use their domain
transaction-failed exceptions rather than disguising contention as an RPC outage.

## Focused tests

`soroban-sequence.spec.ts` covers a deterministic two-caller race, 25 concurrent
submissions, independent source locks, fresh rebuilds on rejection, retry limits,
lock release, non-sequence failures, ambiguous timeouts, ledger confirmation,
sequence precision above Number.MAX_SAFE_INTEGER, XDR decoding, metrics, and API
error mapping. `sequence-callers.spec.ts` exercises all seven signing paths and
asserts fresh signed bytes on callback re-execution. This also corrects the
milestone argument to use the SDK-required number for u32 encoding (rather than
a bigint, which fails XDR serialization). No live network or funded Stellar
account is needed.
