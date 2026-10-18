# Serving Compute Cost Attribution (Issue #1643)

The pipeline side profiles cost per stage (#1454). This document covers the
**serving** side: what a given model version costs to run, and which serving
paths (endpoints) consume the most compute.

Cost is attributed per **model version** and per **endpoint**, reported as
cost per thousand inferences, compared across a model promotion, and exported
as Prometheus metrics on `GET /metrics` alongside the stage-level profiling
(#1454). The same numbers are served as a report from
`GET /model/cost-report`.

## Cost model

Compute cost is measured from observed inference time, not estimated from
traffic volume:

```
cost_usd = compute_seconds * hourly_rate_usd / 3600
```

`compute_seconds` is the wall-clock time of the inference call inside the
endpoint (sentiment analysis, batch analysis, embedding, forecast). A batch
request charges its full execution time once and counts one inference per
item.

### Configuring the hourly rate

Resolved in this precedence order:

| Level | Environment variable | Example |
| --- | --- | --- |
| Model version | `SERVING_COST_RATES_JSON` (JSON map of `"<type>@<version>"` or `"<type>"` to USD/hour) | `{"sentiment@v1.2": 0.40}` |
| Model type | `SERVING_COST_PER_HOUR_USD_<MODEL_TYPE>` | `SERVING_COST_PER_HOUR_USD_SENTIMENT=0.25` |
| Global default | `SERVING_COST_PER_HOUR_USD` | `SERVING_COST_PER_HOUR_USD=0.05` |

When nothing is configured the built-in default is `0.05` USD/hour (roughly a
small container CPU-hour). Invalid or negative values fall through to the next
level. Version-specific rates are how a more expensive new model version gets
priced differently from its predecessor.

## Metrics

All metrics are labelled with `model_type`, `model_version` and (where
relevant) `endpoint`, and are exported on `GET /metrics` from the same
Prometheus registry as the latency-budget and stage-profiling metrics.

| Metric | Type | Meaning |
| --- | --- | --- |
| `lumenpulse_serving_inferences_total` | counter | Inferences served, per model version and endpoint. |
| `lumenpulse_serving_compute_cost_usd_total` | counter | Attributed compute cost in USD, per model version and endpoint. |
| `lumenpulse_serving_cost_per_1k_inferences_usd` | gauge | Cost per thousand inferences, per model version **and** endpoint. |
| `lumenpulse_serving_model_cost_per_1k_inferences_usd` | gauge | Cost per thousand inferences, per model version across all endpoints. |
| `lumenpulse_serving_path_cost_usd_total` | counter | Attributed cost per serving path (endpoint). |
| `lumenpulse_serving_promotion_cost_delta_usd_per_1k` | gauge | Cost-per-1k delta of a promoted version against its predecessor (positive = more expensive). |

### Promotion cost delta

When `promote_model()` swaps in a new version, the registry records the
promotion. The delta is published once both the predecessor and the promoted
version have served at least one request (before that it stays unset, because
there is nothing to compare yet) and is refreshed as traffic accrues. It is
also included in the cost report under `promotions`.

## Report

`GET /model/cost-report` (X-API-Key) returns:

- `models` — per model version: inferences, total cost, cost per 1k
  inferences.
- `endpoints` — per serving path: inferences, total cost, cost per 1k,
  share of total cost.
- `top_serving_paths` — the **three most expensive serving paths**, ranked by
  attributed cost, with each one's share of total serving cost.
- `promotions` — for each model type, the latest promotion with predecessor
  and promoted cost per 1k and the delta between them.

## Instrumented endpoints

| Endpoint | Model type | Version source |
| --- | --- | --- |
| `POST /analyze` | `sentiment` | live registry pointer |
| `POST /analyze-batch` | `sentiment` | live registry pointer (one inference per item) |
| `GET /search/similar` | `embedding` | pinned embedding model version |
| `GET /analytics/forecast` | `forecast` | forecast model backend |

Attribution is per API process and resets on restart, exactly like the other
Prometheus metrics in this service.
