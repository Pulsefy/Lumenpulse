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
| `lumenpulse_inference_latency_seconds` | histogram | Request processing latency, labelled by `endpoint`, `method`, and `model_version`. |
| `lumenpulse_inference_latency_budget_breaches_total` | counter | Requests that exceeded their endpoint budget, labelled by `endpoint`, `method`, and `model_version`. |

### Documented Latency Targets per Endpoint

Each endpoint has stated latency targets at the **50th (p50)** and **95th (p95)** percentiles. The p95 target serves as the maximum acceptable latency budget threshold.

| Endpoint | p50 Target (ms) | p95 Budget (ms) | Override env var (p95) | Override env var (p50) |
| --- | --- | --- | --- | --- |
| `POST /analyze` | 150 | 500 | `ANALYZE_LATENCY_BUDGET_MS` | `ANALYZE_LATENCY_P50_MS` |
| `POST /analyze-batch` | 800 | 2000 | `ANALYZE_BATCH_LATENCY_BUDGET_MS` | `ANALYZE_BATCH_LATENCY_P50_MS` |
| `POST /correlation/analyze` | 350 | 1000 | `CORRELATION_ANALYZE_LATENCY_BUDGET_MS` | `CORRELATION_ANALYZE_LATENCY_P50_MS` |
| `POST /correlation/lag-analysis` | 400 | 1000 | `CORRELATION_LAG_LATENCY_BUDGET_MS` | `CORRELATION_LAG_LATENCY_P50_MS` |
| `GET /analytics/forecast` | 600 | 2000 | `FORECAST_LATENCY_BUDGET_MS` | `FORECAST_LATENCY_P50_MS` |
| `POST /retrain` | 5000 | 30000 | `RETRAIN_LATENCY_BUDGET_MS` | `RETRAIN_LATENCY_P50_MS` |
| `GET /search/similar` | 100 | 300 | `SEARCH_SIMILAR_LATENCY_BUDGET_MS` | `SEARCH_SIMILAR_LATENCY_P50_MS` |
| any other endpoint | 500 | 1000 | `LATENCY_BUDGET_MS` (fallback) | - |

The `/search/similar` budget (issue #1455) excludes the fixed cost of loading
the vendored spaCy embedding pipeline (done once at first use) and covers the
embedding of the query plus the cosine ranking pass over stored 300-dim
article vectors.

Budgets are resolved in `src/config/latency_budget.py`:

1. An endpoint-specific environment variable, if set;
2. the documented per-endpoint default above;
3. the global `LATENCY_BUDGET_MS` fallback.

A request is a **breach** when its measured duration (in ms) is strictly
greater than the configured budget. Breaches increment
`lumenpulse_inference_latency_budget_breaches_total{endpoint,method,model_version}`
and trigger alert evaluation through `src/alert_engine/` (with deduplication rule
`dedup_inference_latency_breach`), in addition to Prometheus alerting rules in
`prometheus-rules.yml`.


### Per-token explanations (`explain: true`)

`POST /analyze` can optionally return per-token sentiment explanations
(`{"text": "...", "explain": true}`, Issue #1456). Explanation work is off by
default and bounded:

* The `/analyze` endpoint uses the pure-VADER analyzer, so explaining adds only
  in-process lexical passes (no extra transformer inference) — well within the
  500 ms budget.
* The ingestion-side analyzer (`src/analytics/sentiment.py`) can additionally
  explain the FinBERT path, which costs at most 20 extra transformer forward
  passes (each truncated to 512 tokens) — this is why `explain` is opt-in.

Method-specific overhead bounds are detailed in
`SENTIMENT_EXPLANATIONS.md` and exposed programmatically via
`explanation_latency_overhead(method)`.

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
