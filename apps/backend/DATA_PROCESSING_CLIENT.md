# Shared data-processing client

`DataProcessingModule` exports one `DataProcessingClient` shared by sentiment,
news sentiment enrichment, model retraining, read-model rebuilds, and Python
health probes. Callers supply relative paths, not URLs or API credentials.

## Configuration

The client reads `PYTHON_API_URL` and `PYTHON_API_KEY` using the existing config
fallbacks. It attaches `X-API-Key` and the active correlation/request IDs to each
request. Rebuilds retain their job-ID correlation fallback. Redirects are disabled
to prevent forwarding the service credential to another host.

Optional environment variables (invalid/out-of-range values use the default):

| Variable | Default | Range |
| --- | --- | --- |
| `PYTHON_CLIENT_TIMEOUT_MS` | 10000 | 1-300000 |
| `PYTHON_CLIENT_MAX_RETRIES` | 2 | 0-5 |
| `PYTHON_CLIENT_FAILURE_THRESHOLD` | 5 | 1-100 |
| `PYTHON_CLIENT_RESET_MS` | 30000 | 1-300000 |

Every attempt has an Axios timeout and an independent observable deadline that
cancels a stalled transport. Existing explicit health (5s) and synchronous rebuild
(5min) timeouts are retained. The readiness probe uses 3s and disables retries.

GET and the read-only `POST /analyze` retry transport errors, timeouts, HTTP 429,
and 5xx responses with 100ms exponential backoff. Other 4xx responses propagate
without retries and do not trip the breaker. Mutating POSTs (including retraining
and rebuilds) are never automatically replayed: a timed-out job may already have
started, and active-job deduplication is not durable request idempotency.

After the configured number of consecutive failed logical requests, the shared
breaker opens. Calls fail immediately with `DataProcessingUnavailableError`
(HTTP 503, `DATA_PROCESSING_UNAVAILABLE`, reason `circuit_open`). After the cooldown,
only one half-open probe is admitted; success closes the breaker, dependency
failure reopens it. Older concurrent requests cannot close a newly opened breaker.
Timeouts and exhausted dependency failures use the same typed error with reason
`timeout` or `unavailable`. News enrichment retains its non-blocking null fallback;
rebuild failures still follow the existing job failure path.

## Bias assessment

Wave 9 measured overall precision and recall for the anomaly detectors that feed
the suspicious-contribution flow. Wave 10 adds a contributor-segment bias
pass—measuring error rates across new accounts, small contributors, and
regional groups, reporting material disparities with their size, and recording
findings in the model card.

The client exposes `assess('v1')`, which POSTs to `/bias/assess` with
`regenerateAtRetraining: true`. The response is a `BiasAssessmentResponse`
containing the per-segment error rates, the material disparities and their
size, the mitigation applied (or the accepted disparities with a reason),
and the model-card update. The assessment is invoked as part of retraining, so
the report is regenerated on every retrain and the model card stays in sync.

## Metrics

The application's `/metrics` registry exports:

- `data_processing_requests_total{method,outcome}`: each successful/failed attempt,
  timeout, retry, and fail-fast circuit rejection. Labels have bounded cardinality
  and never include text, credentials, URLs, or job IDs.
- `data_processing_breaker_state`: 0 closed, 1 open, 2 half-open. Alert on a
  sustained value of 1 plus elevated error/timeout outcomes.

State is process-local. Each backend replica has its own breaker. A breaker limits
new work; it does not cancel unrelated requests already in flight.

## Focused validation

Run the client suite plus the sentiment, model-retraining, read-model-rebuild,
news-sentiment, health, and correlation-flow suites with Jest `--runInBand`.
