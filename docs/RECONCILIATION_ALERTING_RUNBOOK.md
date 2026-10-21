# Reconciliation Alerting Runbook

Reconciliation alerts identify differences between live Stellar balances and the `portfolio_assets` read model.

## Configuration

Set these backend environment variables in the same units as the stored asset amount:

- `RECONCILIATION_PORTFOLIO_ASSETS_WARNING_THRESHOLD` (default: `0.0000001`)
- `RECONCILIATION_PORTFOLIO_ASSETS_CRITICAL_THRESHOLD` (default: `0.00001`)

The critical threshold must be greater than or equal to the warning threshold.

## Response

1. Inspect the `dataset` and `severity` labels on `lumenpulse_reconciliation_drift_total`.
2. Query recent reconciliation jobs at `GET /admin/reconciliation` and inspect `driftDetails` for `userId`, asset code, issuer, stored amount, upstream amount, delta, and repair status.
3. Confirm the corresponding Stellar account and determine whether the read model or upstream balance is authoritative.
4. Re-run reconciliation after correcting the underlying cause and verify that the alert clears.
## Dataset `outbox_event_index`

An hourly job (`outbox-index-consistency`) compares outbox events that reference a chain operation (`payload.txHash`, optionally `payload.eventIndex`) with the `soroban_events` index. Details, configuration and current findings are in [OUTBOX_INDEX_CONSISTENCY.md](OUTBOX_INDEX_CONSISTENCY.md).

- `severity="critical"`: `published_not_indexed` or `indexed_not_published` discrepancies. `lumenpulse_reconciliation_drift_delta` holds their count.
- `severity="warning"`: `duplicate_publish` discrepancies, or a run that hit `OUTBOX_INDEX_CHECK_MAX_ROWS` (delta equals the cap).

Response:

1. Open the latest `outbox-index-consistency` entry in the scheduler job history. `result.discrepancies` lists up to 50 findings with `kind`, `txHash`, `eventIndex`, `outboxEventIds` and `sorobanEventId`; the backend logs carry up to 100 per run (`Outbox/index discrepancy`).
2. `published_not_indexed`: check the indexer cursor and the soroban dead-letter queue for that `txHash`. If the event is on chain, replay it (see [SOROBAN_EVENT_REPLAY_RUNBOOK.md](SOROBAN_EVENT_REPLAY_RUNBOOK.md)). If it is not on chain, the outbox event was published for a transaction that never landed; treat the producer as faulty.
3. `indexed_not_published`: the producer for that canonical type did not write an outbox event. Publish the missing event from the indexed row, then fix the producer.
4. `duplicate_publish`: the outbox ids listed describe the same chain event. Confirm consumers are idempotent on `(txHash, eventIndex)` before marking one as handled.
5. Truncated run: raise `OUTBOX_INDEX_CHECK_MAX_ROWS` or shorten `OUTBOX_INDEX_CHECK_WINDOW_MINUTES` until runs complete under the cap.
