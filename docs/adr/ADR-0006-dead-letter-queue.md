# ADR-0006: Dead-letter queue and replayable event handling

- Status: Accepted
- Date: 2026-08-25

## Context

The platform ingests blockchain events and other asynchronous payloads that may fail for reasons outside the main business transaction. Errors can include schema drift, transient downstream dependency issues, contract state changes, or malformed payloads. A system that simply drops or retries in memory is not sufficient for operational safety.

The team needs a way to preserve failed work, inspect the exact failure context, and replay it with an explicit audit trail. This is essential for debugging production issues without losing event integrity.

## Options considered

1. Retry in process only and log failures.
   - Pros: minimal infrastructure and easiest initial implementation.
   - Cons: loses failed payloads when the process restarts, makes root-cause analysis weak, and does not give maintainers a safe replay path.

2. Drop failed events after a limited retry count.
   - Pros: simple to reason about and low storage cost.
   - Cons: data loss and poor operator confidence; impossible to recover from real production issues without re-ingestion.

3. Persist failed events to a dead-letter store with replay support.
   - Pros: preserves context, supports inspection and manual recovery, and provides a safe operational fallback.
   - Cons: requires storage, an API for inspection, and clear replay semantics.

## Decision

We persist failed events to a dead-letter queue with replay metadata, failure history, and maintainable status transitions. The system records the last error, preserves the original payload, and only replays when a maintainer or operator chooses to do so under explicit safeguards.

This gives the platform a durable failure recovery path without letting retry loops block the main event processor indefinitely.

## Consequences

- Operational failures become inspectable rather than silently lost.
- The system can recover from transient infrastructure faults and reprocess known-good events after fixes are in place.
- Additional storage, query, and review workflows are required.
- Replay semantics must remain idempotent so recovery does not create duplicate side effects.

## Related implementation summaries

- [apps/backend/IMPLEMENTATION_SUMMARY_DEAD_LETTER_QUEUE.md](../../apps/backend/IMPLEMENTATION_SUMMARY_DEAD_LETTER_QUEUE.md)
- [apps/backend/IMPLEMENTATION_SUMMARY_OUTBOUND_OBSERVABILITY.md](../../apps/backend/IMPLEMENTATION_SUMMARY_OUTBOUND_OBSERVABILITY.md)
- [apps/backend/src/soroban-events/soroban-events.processor.ts](../../apps/backend/src/soroban-events/soroban-events.processor.ts)
