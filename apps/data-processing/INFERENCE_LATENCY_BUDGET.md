# Inference Latency Budgets & Analysis Caching

This document describes how the data-processing API keeps inference latency
bounded and avoids repeating expensive analysis work across ingestion runs.

Reference: Issue #1251 — "Data-processing: Set an inference latency budget and
cache repeated analyses".

---

## 1. Latency budgets

Every inference endpoint has a **latency budget**: the maximum acceptable
end-to-end processing time for a single request. The API middleware measures
each request and exports the result to Prometheus:

| Metric | Type | Meaning |
| --- | --- | --- |
| `lumenpulse_inference_latency_seconds` | histogram | Request processing latency, labelled by `endpoint` and `method`. |
| `lumenpulse_inference_latency_budget_breaches_total` | counter | Requests that exceeded their endpoint budget. |

### Budgets per endpoint

| Endpoint | Default budget (ms) | Override env var |
| --- | --- | --- |
| `POST /analyze` | 500 | `ANALYZE_LATENCY_BUDGET_MS` |
| `POST /analyze-batch` | 2000 | `ANALYZE_BATCH_LATENCY_BUDGET_MS` |
| `POST /correlation/analyze` | 1000 | `CORRELATION_ANALYZE_LATENCY_BUDGET_MS` |
| `POST /correlation/lag-analysis` | 1000 | `CORRELATION_LAG_LATENCY_BUDGET_MS` |
| `GET /analytics/forecast` | 2000 | `FORECAST_LATENCY_BUDGET_MS` |
| `POST /retrain` | 30000 | `RETRAIN_LATENCY_BUDGET_MS` |
| any other endpoint | 1000 | `LATENCY_BUDGET_MS` (global fallback) |

Budgets are resolved in `src/config/latency_budget.py`:

1. An endpoint-specific environment variable, if set;
2. the documented per-endpoint default above;
3. the global `LATENCY_BUDGET_MS` fallback.

A request is a **breach** when its measured duration (in ms) is strictly
greater than the configured budget. Breaches increment
`lumenpulse_inference_latency_budget_breaches_total{endpoint,method}` and are
therefore visible in `/metrics` and alertable via Prometheus.

---

## 2. Caching repeated analyses

The backend's sentiment service calls `POST /analyze` once per article, so
the same content is scored repeatedly across ingestion runs. The
`SentimentAnalyzer` (used by `/analyze`) therefore caches every analysis
result in Redis through `src/cache_manager.py`.

### Cache keys

Keys are derived deterministically from:

1. a **sha256 content hash** of the analysed text;
2. the **promoted model version** (`get_current_version("sentiment")` from the
   model registry, falling back to `v1.0`);
3. the optional asset filter.

Format:

```
sha256(text) | <model_version> | <asset_filter>
```

The joined key is hashed again by `CacheManager._generate_key`, so the final
Redis key is `sentiment:<sha256(joined)>`. Because the model version is part
of the key, results produced by one model version are never read back after a
promotion.

### Model promotion invalidates the cache

`promote_model()` in `src/ml/model_registry.py` clears the whole cache
namespace for the model type after a promotion, so entries produced by the
previous model version are evicted immediately. The invalidation is
best-effort: when Redis is unavailable (e.g. during a worker-side retrain) it
is logged and skipped.

### Cache hit rate

Every lookup is counted and exported:

| Metric | Type | Meaning |
| --- | --- | --- |
| `lumenpulse_cache_operations_total` | counter | Lookups labelled by `namespace` and `outcome` (`hit` / `miss`). |
| `lumenpulse_cache_hit_rate` | gauge | `hits / (hits + misses)` per namespace. |

The `/metrics` endpoint exposes both, so the hit rate can be tracked over time
and compared before/after a deployment. `CacheManager.hit_rate()` also returns
the observed rate programmatically.

### Disabling the cache

Set `CACHE_ENABLED=false` to bypass Redis entirely (useful for debugging or
load testing). When disabled, `CacheManager` never opens a Redis connection and
`get`/`set` become no-ops:

```bash
CACHE_ENABLED=false python start_api.py
```

The same switch can be passed programmatically:
`CacheManager(namespace="sentiment", enabled=False)`.
