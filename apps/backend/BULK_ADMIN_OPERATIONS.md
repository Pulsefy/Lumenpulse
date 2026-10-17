# Bulk admin operations

The admin batch endpoints process each item independently. A failure for one item does not roll back successful work on other items. Each response includes a server-generated `bulkOperationId` and a result for every input item, so clients can retry only failed items. Batch size is limited to 50.

Each operation records its actor, operation ID, target, and outcome in the audit log. Existing replay limits and idempotency checks still apply to dead-letter events.

## Endpoints

- `POST /moderation/queue/bulk`: apply status and review-note updates to reports.
- `POST /moderation/queue/assign/bulk`: assign or unassign report reviewers.
- `POST /review-history/decisions/bulk`: record decisions for multiple review targets.
- `POST /soroban-events/dead-letter/bulk/replay`: queue multiple dead-letter events for replay.

Each endpoint accepts an `items` array and returns a `results` array with an item identifier, success flag, and either the operation result or an error message.
