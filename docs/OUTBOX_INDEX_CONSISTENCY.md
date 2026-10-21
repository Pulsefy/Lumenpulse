# Outbox ↔ Soroban Event Index Consistency

Tracking issue: #1599. Code: `apps/backend/src/outbox-index-consistency/`.

## What is compared

The two pipelines share no foreign key, so the check joins them on the chain
operation itself:

- **Outbox side:** `outbox_events` rows whose `payload` carries `txHash`, and
  optionally `eventIndex`, the event's position within the transaction.
  Producers that publish application events for a chain operation must
  include these fields. An outbox event without `eventIndex` refers to the
  transaction as a whole.
- **Index side:** `soroban_events`, unique on `(txHash, eventIndex)`.

| Kind | Meaning | Alert severity |
|---|---|---|
| `published_not_indexed` | An outbox event names a chain event the index does not hold. | critical |
| `indexed_not_published` | An indexed event of a type in `OUTBOX_INDEX_CHECK_REQUIRED_TYPES` has no outbox event. | critical |
| `duplicate_publish` | The same chain event was published more than once under one outbox `eventType`. | warning |

"Indexed twice" cannot happen in `soroban_events`, because the
`(txHash, eventIndex)` unique index rejects a second row. The double-counting
risk therefore lives on the outbox side: `OutboxService.publish` has no
idempotency key. That is what `duplicate_publish` detects.

## Schedule and cost

- Runs hourly (`20 * * * *`) under the scheduler job lock. Each run is
  recorded in job history with counts and up to 50 discrepancies.
- **Window:** the run compares records created (outbox) or processed (index)
  in `[now − settle − window, now − settle)`. The defaults are a
  120-minute window and a 15-minute settle period, so consecutive runs
  overlap and in-flight work is not flagged.
- **Bounded:** each windowed query is `LIMIT OUTBOX_INDEX_CHECK_MAX_ROWS + 1`
  (default 5 000). Follow-up lookups go through indexes in chunks of 500
  hashes: the unique `soroban_events(txHash, …)` index, and the two partial
  `outbox_events` indexes added in migration `1866000000000`. Those indexes
  cover only rows with `payload.txHash`, so their size tracks chain-linked
  events alone. A run that hits the cap reports `truncated: true` and raises a
  warning alert rather than silently skipping rows.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `OUTBOX_INDEX_CHECK_WINDOW_MINUTES` | `120` | Window length per run |
| `OUTBOX_INDEX_CHECK_SETTLE_MINUTES` | `15` | Most recent period left out |
| `OUTBOX_INDEX_CHECK_MAX_ROWS` | `5000` | Per-query row cap (max 50 000) |
| `OUTBOX_INDEX_CHECK_REQUIRED_TYPES` | *(empty)* | Comma-separated soroban `canonicalType`s that must always be published |

## Alerting

Findings increment `lumenpulse_reconciliation_drift_total{dataset="outbox_event_index"}`.
The existing `ReconciliationDriftWarning` and `ReconciliationDriftCritical`
rules in `prometheus-rules.yml` alert on it with no rule changes. The response
steps are in [RECONCILIATION_ALERTING_RUNBOOK.md](RECONCILIATION_ALERTING_RUNBOOK.md#dataset-outbox_event_index).

## Findings during implementation

1. **No producer publishes chain-linked outbox events today.**
   `OutboxService.publish` has no callers anywhere in `apps/backend/src`, so
   `outbox_events` holds no rows with `payload.txHash`. The two pipelines
   currently share no operations. The check therefore reports nothing in the
   published → indexed direction until producers start publishing. This is
   the most significant gap: application consumers of chain activity are not
   fed through the outbox at all.
2. **The indexed → published direction is off by default.** With no
   producers, listing any canonical type in
   `OUTBOX_INDEX_CHECK_REQUIRED_TYPES` would flag every indexed event of that
   type. Enable it per type as the producer for that type is added.
3. **Duplicate publishes are possible.** `OutboxService.publish` accepts no
   idempotency key, so a retried producer can write the same event twice.
   `duplicate_publish` makes that visible. Consumers must deduplicate on
   `(txHash, eventIndex)`.
4. **Double indexing is prevented by schema.** The unique
   `(txHash, eventIndex)` index on `soroban_events` makes a second index row
   for one event impossible.

These findings come from reading the code. The check has not yet been run
against a staging or production database; its first scheduled runs there
will confirm the counts above (expected: zero rows compared).
