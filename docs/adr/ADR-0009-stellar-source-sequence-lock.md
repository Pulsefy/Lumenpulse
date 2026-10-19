# ADR-0009: Serialize backend submissions per Stellar source

- Status: Proposed
- Date: 2026-10-16

## Context

Matching-pool, treasury, vesting, and gasless registration transactions share a
server source account. Concurrent account lookups can build identical sequence
numbers. Locking allocation alone does not guarantee ledger submission order.

## Options considered

- Uncoordinated reads: race-prone and opaque submission errors.
- A speculative sequence pool: unique numbers but ordering/gap recovery remains.
- Channel accounts: parallelism at the cost of funding, key custody, and revised
  source/authorization handling.
- A per-source FIFO lock covering lookup, submission, and confirmation.

## Decision

Use one coordination boundary on the shared Soroban RPC client. Serialize each
source until inclusion, then fetch the next authoritative account state. Retry
only definite tx_bad_seq rejections by rebuilding/simulating/signing with a fresh
account; bound attempts to three. Decode XDR result codes for metrics/API errors.
Rule out channel accounts for the current low-frequency admin/relayer workload.

## Consequences

Different accounts remain independent. Same-source calls wait for the preceding
ledger outcome. Locks are process-local, requiring one active signing process per
source for strict exclusion. Timeouts remain ambiguous and never trigger fresh
transaction replay. Distributed signing requires a separate coordination design.

## Related implementation summaries

- [Sequence management](../../apps/backend/SEQUENCE_MANAGEMENT.md)
