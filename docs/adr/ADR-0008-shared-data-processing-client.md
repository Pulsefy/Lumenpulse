# ADR-0008: Shared resilient data-processing client

- Status: Proposed
- Date: 2026-10-16

## Context

Backend Python-service callers independently construct URLs, authentication,
timeouts, and errors. A dependency outage can tie up unrelated endpoints.

## Options considered

- Keep independent HttpService calls: minimal wiring but divergent resilience.
- Retry every POST: risks duplicating retraining or rebuild work after a timeout.
- Introduce a shared injectable client with selective retries and a local breaker.

## Decision

Use a singleton Nest module/client for all Python-service calls, including health
probes. Centralize credentials and request context, enforce cancellable per-attempt
deadlines, retry only reads/analysis, and admit a single half-open recovery probe.
Export request outcomes and breaker state through the existing metrics registry.

## Consequences

Existing domain fallbacks remain intact. Mutation failures are not transparently
retried; durable request idempotency is required before enabling such retries.
The breaker is per process, not a distributed coordination mechanism. Explicit
long-running rebuild and health timeouts are preserved.

## Related implementation summaries

- [Shared data-processing client](../../apps/backend/DATA_PROCESSING_CLIENT.md)
