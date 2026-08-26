# Feature Schema Versioning & Train-vs-Serve Drift Detection (#1239)

`src/ml/feature_store.py` produces the feature matrix consumed by
`price_predictor.py`. Before this change nothing tied a trained model to the
*shape and distribution* of the features it learned from, so a feature could
change meaning or distribution between training and serving with **no
detection** — the classic silent-failure mode for a deployed model.

This change gives feature sets an explicit, versioned schema, records it with
every trained model, guards serving against schema skew, and runs scheduled
train-vs-serve distribution drift detection that alerts through the existing
alerting path.

## Acceptance criteria → implementation

| Acceptance criterion | Where |
| --- | --- |
| Feature sets carry an explicit schema version recorded with each trained model | `src/ml/feature_schema.py` defines the versioned schema; `src/ml/retraining_pipeline.py` writes `schema_version` + `schema_fingerprint` into each model's registry metadata sidecar (`models/price_predictor/<version>.meta.json`) via `model_registry.save_model(..., metadata=...)` |
| Serving refuses or loudly warns when the serving schema version differs from the training version | `PricePredictor.fit` records `training_schema_version`; `PricePredictor.predict` calls `feature_schema.check_serving_schema` → raises `SchemaVersionMismatch` (strict) or logs a loud warning (default), controlled by `FEATURE_SCHEMA_ENFORCEMENT` |
| Training-vs-serving distribution drift computed per feature on a schedule | `src/ml/feature_drift_detector.py` computes per-feature **PSI** against the training baseline; scheduled every `FEATURE_DRIFT_INTERVAL_HOURS` (default 6) by `scheduler.py::_feature_drift_detection_job` |
| Drift beyond a configured threshold raises an alert through the existing alerting path | Threshold `FEATURE_DRIFT_PSI_THRESHOLD` (default 0.25); alert raised via `AlertNotifier.notify_feature_drift` (same Telegram + webhook fan-out as anomaly alerts) |
| `feature_lineage.yaml` updated to reflect the versioned schema | `src/lineage/feature_lineage.yaml` — `price_predictor_features` now carries `schema_version`, `schema_fingerprint`, and a `drift_detection` block |

## Key concepts

### Schema version vs fingerprint
* **`schema_version`** (`"1.0"`) — a human-curated `<major>.<minor>` string,
  bumped deliberately when the feature set's meaning/composition changes. It is
  what serving compares against.
* **`schema_fingerprint`** (`sha256("name:dtype|…")[:12]`) — derived from the
  ordered `(name, dtype)` pairs. It catches *accidental* structural drift (a
  column added/removed/reordered/retyped) **even when someone forgets to bump
  the version**. The drift detector treats a fingerprint change as a drift
  signal in its own right.

The single source of truth is `src/ml/feature_schema.py`; the lineage manifest
mirrors it (kept honest by `scripts/validate_lineage.py`).

### Population Stability Index (PSI)
Per feature, PSI compares the training-time distribution (quantile bins +
proportions captured at retraining and stored in the model metadata) against
the current serving distribution:

```
PSI = Σ_bins (serving% − baseline%) · ln(serving% / baseline%)
```

Conventional bands: `<0.10` none · `0.10–0.25` moderate · `≥0.25` major. The
alert threshold defaults to `0.25` and is configurable.

## Serving guard behaviour

`FEATURE_SCHEMA_ENFORCEMENT`:
* `warn` (default) — `predict` logs a loud warning on a version mismatch and
  still serves. Safe for existing callers; nothing breaks.
* `strict` — `predict` raises `SchemaVersionMismatch` and refuses to serve a
  model against features it was not trained on.

A legacy model with no recorded `training_schema_version` is always allowed to
serve (the gap is logged), so older artifacts keep working.

## Configuration

| Env var | Default | Meaning |
| --- | --- | --- |
| `FEATURE_SCHEMA_ENFORCEMENT` | `warn` | `strict` \| `warn` serving guard |
| `FEATURE_DRIFT_PSI_THRESHOLD` | `0.25` | PSI above which a feature is "drifted" |
| `FEATURE_DRIFT_INTERVAL_HOURS` | `6` | Scheduled drift-check cadence |
| `FEATURE_DRIFT_ASSET` | `XLM` | Asset sampled for the serving distribution |
| `FEATURE_DRIFT_SERVING_WINDOW` | `7d` | Look-back window for serving features |

## Observability (Prometheus)
* `lumenpulse_feature_drift_psi{feature_set,feature}` — latest PSI per feature
* `lumenpulse_feature_drift_alerts_total{feature_set,reason}` — drift alerts
  (`reason` = `distribution` | `schema`)
* `lumenpulse_feature_schema_mismatch_total{feature_set}` — serving-time schema
  version mismatches

`model_registry.get_registry_status()` now also surfaces the live model's
`current_metadata` (schema version/fingerprint + training baseline summary).

## Safety / blast radius
* Additive and backward compatible: `save_model`'s `metadata` arg is optional;
  the pickle format is untouched (metadata lives in a JSON sidecar).
* `FeatureStore` tags frames via `DataFrame.attrs` only — no column changes, so
  existing consumers are unaffected.
* The scheduled detector is strictly read-only and fully defensive: a missing
  baseline, empty serving window, or failed notification is logged and reported,
  never fatal — it can't crash the scheduler.

## Tests
* `tests/test_feature_schema.py` — versioning, fingerprint stability/sensitivity,
  strict/warn enforcement.
* `tests/test_model_registry_metadata.py` — metadata sidecar save/load, `current`
  resolution across promotion.
* `tests/test_feature_drift_detector.py` — PSI math, no-drift vs drift, schema
  mismatch alerting, threshold config, defensive error handling.
* `tests/test_price_predictor.py` — schema version recorded at fit; predict
  warns (default) / raises (strict) on skew.
