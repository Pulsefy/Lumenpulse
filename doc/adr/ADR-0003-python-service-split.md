# ADR-0003: Separate Python service for analytics and inference

- Status: Accepted
- Date: 2026-08-25

## Context

The platform includes model-driven workloads such as sentiment scoring, anomaly detection, and data-processing jobs. These workloads rely on Python libraries, heavier runtime dependencies, and execution patterns that do not belong naturally inside the NestJS backend process.

The backend already owns API orchestration, authentication, and database concerns. Embedding the data science runtime directly into the backend would mix a rapidly-changing inference stack with a user-facing application lifecycle and would increase deployment and dependency risk.

## Options considered

1. Run Python workloads inline inside the backend process.
   - Pros: simpler first implementation and fewer network boundaries.
   - Cons: couples a production API to Python package management, model lifecycle, and long-running analytics tasks; increases startup and operational risk.

2. Keep Python as a dedicated service that exposes HTTP or queue-based APIs.
   - Pros: cleaner dependency isolation, independent deployment, easier model experimentation, and resilience when the analytics service is unavailable.
   - Cons: adds network latency and requires contract definitions between services.

3. Use asynchronous workers inside the same backend codebase without a dedicated service.
   - Pros: less deployment complexity than a full service.
   - Cons: still mixes operational concerns and makes performance tuning harder.

## Decision

We split Python data-processing and inference work into a dedicated service boundary, with the backend calling it over a narrow interface instead of embedding the Python runtime directly. The backend treats the service as a dependency that may be temporarily unavailable and handles degraded operation explicitly.

This keeps model pipelines, experimental libraries, and analytics automation outside the critical path of request handling while preserving a clear integration contract between services.

## Consequences

- The backend remains focused on request orchestration and domain logic.
- Data-processing and machine-learning workflows can evolve independently without forcing backend deployments.
- Workflow reliability depends on service health, timeout policy, and retry semantics.
- Additional integration work is required for API contracts, observability, and graceful fallback behavior.

## Related implementation summaries

- [apps/backend/IMPLEMENTATION_SUMMARY.md](../../apps/backend/IMPLEMENTATION_SUMMARY.md)
- [apps/backend/IMPLEMENTATION_SUMMARY_DEAD_LETTER_QUEUE.md](../../apps/backend/IMPLEMENTATION_SUMMARY_DEAD_LETTER_QUEUE.md)
- [apps/data-processing/ROUND_ANOMALY_DETECTION_IMPLEMENTATION.md](../../apps/data-processing/ROUND_ANOMALY_DETECTION_IMPLEMENTATION.md)
