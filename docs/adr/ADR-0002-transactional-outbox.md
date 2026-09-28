# ADR-0002: Transactional outbox for reliable side effects

- Status: Accepted
- Date: 2026-08-25

## Context

The backend needs to emit notifications, trigger downstream jobs, and integrate with the Python analytics pipeline without risking partial state. A naive approach of firing side effects directly from the application transaction can leave the database and external systems out of sync if the process crashes after the database writes but before the downstream call succeeds.

This is especially important for event-driven flows such as contract processing, webhook fan-out, and notification delivery, where the source-of-truth database update and the side effect must be kept consistent.

## Options considered

1. Fire downstream calls directly in the same transaction.
   - Pros: simple implementation and immediate delivery.
   - Cons: creates coupling to external systems, makes the database transaction dependent on network behavior, and risks partial writes or duplicate processing.

2. Publish events via an in-memory queue or direct broker call outside the DB transaction.
   - Pros: fast and decoupled from persistence.
   - Cons: loses reliability guarantees when the application crashes between committing and dispatching; also makes replay and auditing harder.

3. Use a transactional outbox.
   - Pros: preserves atomicity at the database boundary, enables durable replay, and keeps downstream delivery as an independent concern.
   - Cons: requires an outbox table, polling/dispatch job, and operational monitoring.

## Decision

We persist domain state and outbox entries in the same database transaction. A scheduled worker polls pending outbox rows, dispatches them to the appropriate downstream system, and marks the record as processed or failed. Failed events remain in the store for inspection or replay.

This makes the primary database transaction the source of truth while allowing downstream processing to be retried, audited, and recovered independently.

## Consequences

- The backend can safely record business state and later dispatch side effects without breaking transactional consistency.
- Outbox events can be retried after transient failures, which is critical for asynchronous systems.
- Extra operational complexity is introduced via the outbox table, a dispatch loop, and failure-state handling.
- The system must tolerate eventual consistency between the business transaction and the downstream side effect.

## Related implementation summaries

- [apps/backend/IMPLEMENTATION_SUMMARY.md](../../apps/backend/IMPLEMENTATION_SUMMARY.md)
- [apps/backend/IMPLEMENTATION_SUMMARY_DEAD_LETTER_QUEUE.md](../../apps/backend/IMPLEMENTATION_SUMMARY_DEAD_LETTER_QUEUE.md)
- [apps/backend/src/outbox/outbox.service.ts](../../apps/backend/src/outbox/outbox.service.ts)
