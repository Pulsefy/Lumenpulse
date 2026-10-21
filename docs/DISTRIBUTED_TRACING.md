# Distributed Tracing Architecture & Propagation (#1588)

## 1. Overview
LumenPulse backend implements distributed tracing compliant with the **W3C Trace Context** specification (`traceparent` and `tracestate`). This enables observability across asynchronous job queues, database queries, and inter-service boundaries between NestJS backend and the Python data processing engine.

## 2. Specification & Standards
- **Standard**: W3C Trace Context Level 1 (`00-<trace_id>-<parent_id>-<flags>`).
  - `trace_id`: 16-byte random hex (32 characters).
  - `span_id`: 8-byte random hex (16 characters).
  - `flags`: `01` (sampled), `00` (not sampled).
- **Correlation ID Mapping**: Every span automatically captures `lumenpulse.correlation_id` (and `correlation_id`) linked to the request correlation ID (`X-Request-Id`).
- **Sampling**: Configurable via `TRACING_SAMPLE_RATE` (0.0 to 1.0) with a production default of **0.05 (5%)** low-rate sampling. Spans with errors are logged regardless of sampling status.

## 3. Span Coverage
1. **Inbound HTTP Requests**: `TracingMiddleware` intercepts incoming requests, parses existing `traceparent` or creates a root trace context, and creates a `SERVER` span covering request lifecycle.
2. **Database Queries**: `TypeOrmQueryTracer` implements TypeORM `Logger` interface to wrap queries in `INTERNAL` or `CLIENT` spans (`db.statement`, `db.duration_ms`).
3. **Queue Jobs (BullMQ)**: Trace context is serialized into queue job payloads and restored on the consumer worker.
4. **Outbound Service Calls**: Outbound HTTP requests (e.g., Python sentiment analysis client) inject `traceparent` headers into outgoing requests.
5. **Python Service Propagation**: `backend_client.py` and Flask middleware extract incoming `traceparent` headers, continuing the trace across language barriers.

## 4. Worked Trace: End-to-End Contribution Flow
The following trace represents a contribution ingestion request originating from a client through backend controllers, database transactions, and background indexing:

```
[Trace: 4bf92f3577b34da6a3ce929d0e0e4736 | Correlation: req-98a2-c7f4]
│
├── [SERVER] POST /v1/contributions (142ms)
│   ├── [INTERNAL] Authentication & Guard Validation (4ms)
│   ├── [CLIENT] SELECT FROM "users" WHERE id = $1 (8ms)
│   │   └── db.system: postgresql
│   ├── [INTERNAL] ContributionService.createContribution (120ms)
│   │   ├── [CLIENT] INSERT INTO "contributions" VALUES (...) (15ms)
│   │   ├── [PRODUCER] BullMQ.addJob("contributions.process") (12ms)
│   │   │   └── queue: contribution-processing
│   │   └── [CLIENT] Outbound HTTP POST http://data-processing:8000/sentiment/analyze (78ms)
│   │       ├── http.url: /sentiment/analyze
│   │       ├── traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-6e8a01cf29ab7801-01
│   │       └── [SERVER] Python SentimentWorker.analyze (65ms)
│   │           └── model: vader-lexicon
│   └── [INTERNAL] Response Serialization & Header Injection (2ms)
│       └── headers: traceparent, x-request-id
```

## 5. Configuration Reference
| Environment Variable | Description | Default |
| :--- | :--- | :--- |
| `TRACING_ENABLED` | Toggle distributed tracing (`true` / `false`) | `true` |
| `TRACING_SAMPLE_RATE` | Ratio of requests sampled (0.0 to 1.0) | `0.05` (5%) |
