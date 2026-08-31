# AI Model Lifecycle Documentation

This document describes the complete lifecycle of AI models in the Lumenpulse system, from data selection through training, registration, evaluation, promotion, serving, and rollback. All behaviors described below are extracted from the actual source code implementation.

---

## Model Types

The system manages two distinct model types:

| Model Type | Description | Implementation |
|---|---|---|
| `sentiment` | VADER lexicon-based sentiment analyzer enriched with a custom crypto-slang dictionary | [retraining_pipeline.py#L78-L98](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/retraining_pipeline.py#L78-L98) |
| `price_predictor` | scikit-learn LinearRegression pipeline with StandardScaler preprocessing | [price_predictor.py#L19-L146](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/price_predictor.py#L19-L146) |

---

## 1. Lifecycle Overview

### Flow Diagram

```
Data Selection → Training → Registration → Evaluation → Promotion → Serving
     ↑                                                              ↓
     └──────────── Feature Drift Detection (monitoring) ───────────┘
```

### Stage 1: Data Selection

**What happens:** Training data is assembled for each model type from different sources.

- **Sentiment Model:** The data is the crypto-slang lexicon file loaded directly from disk at `./data/crypto_slang_lexicon.json` (configurable via `CRYPTO_SLANG_LEXICON` env var). This is a JSON file mapping words to sentiment scores.
  - Source: [retraining_pipeline.py#L59-L75](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/retraining_pipeline.py#L59-L75)
  - Responsible file: [retraining_pipeline.py](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/retraining_pipeline.py) (`_load_crypto_slang`)

- **Price Predictor Model:** Feature data is retrieved from the `FeatureStore`, which queries three database views:
  - `asset_sentiment_view` → `sentiment_score`
  - `asset_volume_view` → `volume`
  - `asset_volatility_view` → `volatility`
  - Data is merged via outer join on `timestamp`, forward-filled, and NaNs filled with 0.
  - Target column is derived: `target = sentiment_score.shift(-1)` (next-period sentiment shift)
  - Default window: last 30 days of data
  - **Fallback:** If the feature store or DB is unavailable, synthetic data (200 rows of seeded random data) is generated so the pipeline never hard-fails in CI/dev.
  - Source: [retraining_pipeline.py#L105-L152](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/retraining_pipeline.py#L105-L152)
  - Responsible file: [feature_store.py](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/feature_store.py) (`FeatureStore.get_features_for_asset`)

### Stage 2: Training

**What happens:** Model-specific training logic is executed.

- **Sentiment Model Training:**
  - A new `SentimentIntensityAnalyzer` (VADER) instance is created.
  - The base VADER lexicon is updated with the crypto-slang terms via `analyzer.lexicon.update(slang)`.
  - Metrics recorded: `base_lexicon_size`, `custom_terms_added`, `total_lexicon_size`, `coverage_ratio`.
  - No train/test split — the lexicon update is deterministic.
  - Source: [retraining_pipeline.py#L78-L98](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/retraining_pipeline.py#L78-L98)
  - Responsible file: [retraining_pipeline.py](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/retraining_pipeline.py) (`_build_sentiment_model`)

- **Price Predictor Training:**
  - A `PricePredictor` instance wraps a scikit-learn `Pipeline([StandardScaler, LinearRegression])`.
  - Data is split 80/20 via `train_test_split(..., random_state=42)`.
  - The pipeline is fit on the training split.
  - Metrics computed on the held-out test split: `mse` (mean squared error), `r2` (R-squared coefficient).
  - The feature schema version from the training frame's `attrs['schema_version']` is recorded as `training_schema_version` on the predictor instance for train/serve skew protection.
  - Source: [price_predictor.py#L54-L111](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/price_predictor.py#L54-L111)
  - Responsible file: [price_predictor.py](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/price_predictor.py) (`PricePredictor.fit`)

### Stage 3: Registration

**What happens:** Trained models are persisted to disk with versioned filenames and optional metadata sidecars.

- Model artifacts are pickled with `pickle.HIGHEST_PROTOCOL` and stored under `MODEL_REGISTRY_PATH` (default: `./models/`).
- Directory layout:
  ```
  models/
    <model_type>/
      v<major>.<minor>.pkl        # Pickled model artifact
      v<major>.<minor>.meta.json   # Metadata sidecar (feature schema, baseline, etc.)
      v<major>.<minor>.card.json   # Model card (if created via save_model_with_card)
      current.json                 # Atomic pointer {"version": "v1.2"}
      promotion_log.jsonl          # Audit log of promotion events
      shadow/
        v<major>.<minor>.pkl      # Isolated shadow model copy
        shadow_current -> v*.pkl  # Shadow symlink
        comparison_log.jsonl     # Live vs shadow prediction comparisons
  ```
- Versions follow semver-lite: `v<major>.<minor>` (e.g. `v1.0`, `v1.1`, `v2.0`). Auto-increment increments the minor version of the latest existing version.
- Metadata sidecar (`<version>.meta.json`) for price_predictor contains:
  - `schema_version`, `schema_fingerprint`, `feature_set` (from feature_schema)
  - `trained_at` timestamp, `metrics` (mse, r2)
  - `feature_names`, `feature_baseline` (distribution stats for drift detection)
  - `seed`, `data_query_bounds`, `row_count`, `library_versions`
- If a `manifest` is provided to `run_retraining()`, the seed and data_query_bounds from the manifest are used for reproducibility.
- Source: [model_registry.py#L191-L234](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/model_registry.py#L191-L234)
- Responsible file: [model_registry.py](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/model_registry.py) (`save_model`, `_next_version`, `_metadata_path`)

### Stage 4: Evaluation

**What happens:** Quality gates and evaluation checks are applied before a model can be promoted to production.

- **Sentiment Model Quality Gate:**
  - Check: `coverage_ratio >= MIN_SENTIMENT_COVERAGE` (default `0.0`, permissive)
  - `coverage_ratio = custom_terms_added / total_lexicon_size`
  - Configurable via env var: `MIN_SENTIMENT_COVERAGE`
  - If gate fails: model is saved but **not** promoted; status `quality_gate_failed`.
  - Source: [retraining_pipeline.py#L283-L305](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/retraining_pipeline.py#L283-L305)

- **Price Predictor Quality Gates (two layers):**
  1. **Pre-registration gate:** `r2 >= MIN_PRICE_R2` (default `-1.0`, permissive). Fail = no save, no promotion.
  2. **Post-registration promotion evaluation:** Both the candidate model and the current incumbent (if exists) are scored on the held-out evaluation set. Checks:
     - `threshold` (configurable `PROMOTION_THRESHOLD` env or parameter): candidate score must meet minimum absolute threshold.
     - `min_delta` (configurable `PROMOTION_MIN_DELTA` env or parameter, default `0.0`): candidate must improve upon the incumbent by this delta.
     - Direction logic: for `mse` lower-is-better; for `r2` and `accuracy` higher-is-better.
     - If either check fails **and** `force=False`: promotion is refused with reason codes `threshold_failed` and/or `regressed_against_incumbent`.
     - All evaluation outcomes are written to `promotion_log.jsonl` with timestamps, candidate/incumbent metrics, and status (`refused` / `forced` / normal).
  - Supported metrics: `r2` (default for price_predictor), `mse`, `accuracy`
  - Source: [model_registry.py#L330-L459](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/model_registry.py#L330-L459)
  - Responsible file: [model_registry.py](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/model_registry.py) (`promote_model`, `_score_model`)

### Stage 5: Promotion

**What happens:** A registered model version becomes the active ("current") production model with zero-downtime swap.

- **Atomic on-disk update:** The `current.json` pointer file is replaced atomically via `tempfile.NamedTemporaryFile` + `os.replace()`, ensuring readers never see a partial/missing pointer.
- **In-memory hot-swap:** Under a reentrant `RLock`, the in-memory `_live_models[model_type]` cache is updated. In-flight requests finish with the old model; new requests immediately use the new one.
- **Cache invalidation:** After promotion, the `CacheManager` namespace for the model type is cleared (`cache.clear_namespace()`) to ensure stale cached inference results from the previous version are never served. Best-effort: failure is logged and swallowed.
- **Thread safety:** Only one retraining run executes at a time (guarded by `_retrain_lock` threading lock in the pipeline orchestrator).
- **Force promotion:** `promote_model(..., force=True)` bypasses all evaluation gates and logs a `forced` promotion event.
- Source: [model_registry.py#L330-L459](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/model_registry.py#L330-L459)
- Responsible file: [model_registry.py](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/model_registry.py) (`promote_model`, `_write_current_version`)

### Stage 6: Serving

**What happens:** Live production models serve inference requests with schema skew protection, caching, and optional shadow-mode comparison.

- **Sentiment Inference:**
  - HTTP API: `POST /analyze` (single text) and `POST /analyze-batch` (batch) via FastAPI.
  - Implementation: `SentimentAnalyzer.analyze()` → calls `SentimentIntensityAnalyzer.polarity_scores()` on the live model.
  - Cache: Results cached in Redis via `CacheManager(namespace="sentiment")`. Cache key includes the **promoted model version** (`_current_sentiment_model_version()`) so a model promotion never serves results from an older version.
  - Thresholds: `compound >= 0.05` → positive; `compound <= -0.05` → negative; else neutral.
  - Prediction logging: Every inference is logged (optionally with raw input, controlled by `LOG_PREDICTION_RAW_INPUT` env) to the `prediction_logs` table with model version, input hash, output, and latency.
  - Source: [sentiment.py#L158-L215](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/sentiment.py#L158-L215)
  - Responsible file: [sentiment.py](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/sentiment.py) (`SentimentAnalyzer`)
  - API route: [server.py#L434-L575](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/api/server.py#L434-L575) (`/analyze`, `/analyze-batch`)

- **Price Predictor Inference:**
  - The `PricePredictor.predict()` method runs the sklearn pipeline.
  - **Schema Skew Guard (CRITICAL):** Before inference, `check_serving_schema()` compares the `training_schema_version` recorded at fit-time against the `schema_version` stamped on the incoming feature frame (via FeatureStore).
    - `FEATURE_SCHEMA_ENFORCEMENT=strict` (env): raises `SchemaVersionMismatch` and **refuses to serve**.
    - `FEATURE_SCHEMA_ENFORCEMENT=warn` (default): logs a loud warning and increments `FEATURE_SCHEMA_MISMATCH_TOTAL` metric but still serves.
  - Responsible file: [price_predictor.py#L113-L140](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/price_predictor.py#L113-L140) (`predict`)
  - Schema guard implementation: [feature_schema.py#L165-L218](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/feature_schema.py#L165-L218) (`check_serving_schema`)

- **Model Loading for Serving:**
  - Hot path (preferred): `get_live_model(model_type)` → returns the in-memory cached model under `RLock`. Fast, zero disk I/O.
  - Cold path (fallback): `load_model(model_type, "current")` → reads `current.json`, resolves the version, un-pickles from disk, then warms the in-memory cache.
  - Source: [model_registry.py#L484-L506](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/model_registry.py#L484-L506) (`get_live_model`)

- **Backend → Model Service Communication:**
  - The NestJS backend (`apps/backend`) communicates with the Python data-processing service via HTTP.
  - `ModelRetrainingService.triggerRetraining()` → POST `${PYTHON_API_URL}/retrain` (5-minute timeout).
  - `ModelRetrainingService.getModelStatus()` → GET `${PYTHON_API_URL}/model/status`.
  - Authentication: `X-API-Key` header (PYTHON_API_KEY config).
  - Responsible file: [model-retraining.service.ts](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/backend/src/model-retraining/model-retraining.service.ts)

---

## 2. Model Registry

### Location & Implementation

- **Primary implementation:** [model_registry.py](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/model_registry.py)
- **Root directory:** Configurable via `MODEL_REGISTRY_PATH` env var; defaults to `./models/` relative to the data-processing working directory.

### How Models Are Stored

| Storage Layer | Format | Field / Mechanism |
|---|---|---|
| Model artifact | Pickle file (`v*.pkl`) | `pickle.dump(..., protocol=pickle.HIGHEST_PROTOCOL)` |
| Metadata sidecar | JSON file (`v*.meta.json`) | Keys: `model_type`, `version`, `saved_at`, feature schema fields, `metrics`, `feature_baseline` |
| Model card (optional) | JSON file (`v*.card.json`) | Full `ModelCard` dataclass: training data, hyperparameters, evaluation metrics, feature schema, provenance |
| Version pointer | `current.json` | JSON file with single key: `{"version": "v1.2"}` — updated atomically via temp file + `os.replace()` |
| Legacy pointer | `current` symlink | Auto-migrated to `current.json` on first read; symlink deleted after migration |
| Promotion audit log | `promotion_log.jsonl` | Each line: `{timestamp, model_type, version, metric, candidate_metrics, incumbent_metrics, status, reasons, evaluation_error}` |
| In-memory hot cache | Python dicts + `RLock` | `_live_models: dict[str, Any]`, `_live_versions: dict[str, str]` — guarded by `threading.RLock()` |

### What "Current" Means

- **Definition:** The "current" model is the version whose string is stored in `current.json` (or legacy `current` symlink, auto-migrated).
- **Resolution order for `get_current_version()`:**
  1. Check in-memory `_live_versions[model_type]` dict (fast, under RLock).
  2. Read `current.json` pointer from disk, extracting `data["version"]`.
  3. If `current.json` doesn't exist but a legacy `current` symlink exists: resolve the symlink target filename, write `current.json`, delete the symlink, return the version.
  4. Return `None` if nothing is promoted yet.
- **`load_model(model_type, "current")`** and **`load_metadata(model_type, "current")`** both resolve `"current"` to the actual version string via `_read_current_version()` before accessing the versioned files.
- **Zero-downtime swap guarantee:** After `promote_model()` returns, the on-disk `current.json` and in-memory `_live_models` / `_live_versions` are consistent. The hot-swap happens under the reentrant RLock; in-flight requests that acquired the lock before promotion complete with the old model, and requests that acquire it after see the new model.

### What "Pinned Version" / Shadow Mode Means

The system does **not** have an explicit "pinned version" label in the traditional sense. Instead, it provides a **shadow-mode deployment** mechanism that serves as the equivalent of a staging/pinned candidate alongside production:

- **Shadow model directory:** `models/<model_type>/shadow/` — completely isolated from the promoted versions directory.
- **Shadow file copy:** When a version is registered for shadow via `register_shadow(model_type, version)`, the `.pkl` file is **copied** into the shadow subdirectory (not symlinked), and a `shadow_current` symlink points to the copy. The model is also loaded into the `_shadow_models` in-memory cache.
- **Shadow inference behavior:** Shadow models run alongside the live model without ever being returned to callers. The `ShadowPredictor` wrapper:
  - Runs the live model synchronously (as normal).
  - Runs the shadow model in a background thread with a timeout (`SHADOW_TIMEOUT_SEC`, default 5.0s).
  - Logs a `ComparisonEntry` dataclass for every inference: live version, shadow version, input hash, both predictions, agreement flag, divergence type, latencies, timeout flag.
  - Shadow thread is a daemon thread; timeouts abandon the thread and mark `shadow_timed_out=True`.
  - Maximum documented latency overhead: `SHADOW_TIMEOUT_SEC * 1000` ms (configurable).
- **Comparison buffering:** Comparison entries are held in an in-memory ring buffer (`_MAX_IN_MEMORY_COMPARISONS = 1000` per model type). When the buffer fills, entries are flushed to `shadow/comparison_log.jsonl` as JSONL.
- **Comparison report:** `generate_comparison_report()` computes from the log:
  - Agreement rate, directional agreement, divergence breakdown, timeout rate.
  - Latency stats (avg, p50, p99) for both live and shadow.
  - **Recommendation logic:**
    - Agreement ≥ 99% AND 0 timeouts → "Safe to promote"
    - Agreement ≥ 95% → "Review divergence patterns before promoting"
    - Agreement ≥ 80% → "Investigate divergence before promoting"
    - Agreement < 80% → "Low agreement. Do not promote without investigation"
- Responsible file: [shadow_predictor.py](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/shadow_predictor.py) (`ShadowPredictor`)
- Registry API: [model_registry.py#L549-L947](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/model_registry.py#L549-L947) (`register_shadow`, `unregister_shadow`, `promote_shadow`, `get_shadow_status`, `generate_comparison_report`)

### Model Cards

In addition to metadata sidecars, the registry supports structured `ModelCard` JSON documents (`v*.card.json`) containing:
- Training data range, row count, source, feature list
- Hyperparameters and tuning notes
- Full evaluation metrics (accuracy, precision, recall, f1, auc, mae, rmse, r2, plus custom metrics)
- Feature schema (version, feature names/types, target column)
- Provenance: source code commit, training script, creator identity
- Implementation: [model_card.py](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/model_card.py) (`ModelCard` dataclass)

---

## 3. Retraining Pipeline

### Orchestration Entry Point

- **Python primary orchestrator:** [retraining_pipeline.py](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/retraining_pipeline.py) `run_retraining(db_session=None, force=False, manifest=None, seed=None)`
- **Thread safety:** `_retrain_lock` threading lock ensures only one retraining run executes at a time. If the lock cannot be acquired immediately, the trigger returns `{"status": "skipped", "reason": "already_running"}`.

### How Retraining Is Triggered

There are **four independent trigger paths** (all safe to fire concurrently due to deduplication):

| Trigger | Implementation | Schedule | Notes |
|---|---|---|---|
| **Python APScheduler cron** | [scheduler.py#L173-L191](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/scheduler.py#L173-L191) `_retraining_job` | Daily at **02:00 UTC** (`CronTrigger(hour=2, minute=0, timezone="UTC")`) | Primary trigger; runs in the data-processing background scheduler process |
| **NestJS fallback cron** | [model-retraining.scheduler.ts#L30-L61](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/backend/src/model-retraining/model-retraining.scheduler.ts#L30-L61) `handleDailyRetraining` | Daily at **02:30 UTC** (`@Cron('30 2 * * *', {timeZone: 'UTC'})`) | Redundant fallback, fires 30 minutes after Python's own job in case the Python process missed its window. Uses `JobLockService.tryAcquire("model-retraining-daily")` (advisory lock) to prevent multiple NestJS instances from firing simultaneously. Records job history via `JobHistoryService`. |
| **FastAPI HTTP endpoint** | [server.py#L638-L665](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/api/server.py#L638-L665) `POST /retrain` | On demand | Runs synchronously in a thread pool; response returns only after retraining completes. Rate-limited to 5/min. Requires `X-API-Key` header. Accepts `{ force: boolean }` body. |
| **NestJS admin HTTP endpoint** | [model-retraining.controller.ts#L108-L126](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/backend/src/model-retraining/model-retraining.controller.ts#L108-L126) `POST /admin/models/retrain` | On demand | Proxies to Python `/retrain` endpoint via `ModelRetrainingService`. Requires JWT auth + `ADMIN` role (guarded by `JwtAuthGuard` + `RolesGuard`). |

### Schedule Logic

- The Python APScheduler is configured in `AnalyticsScheduler.start()` [scheduler.py#L452-L459](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/scheduler.py#L452-L459).
- The cron fires at minute 0 of hour 2 UTC every day. Job ID: `model_retraining_daily`.
- The `replace_existing=True` flag ensures duplicate scheduler starts don't create duplicate jobs.
- The NestJS fallback scheduler uses `@Cron('30 2 * * *')` (2:30 AM UTC). It explicitly runs 30 minutes later to give the primary Python trigger time to acquire its threading lock first.
- **Metrics:** Prometheus counters exported:
  - `MODEL_RETRAINING_TOTAL{model_type, status="success"/"failed"}`
  - `MODEL_RETRAINING_DURATION{model_type}` (histogram/timer)
  - `JOBS_RUN_TOTAL` (incremented on successful pipeline completion)

### Conditions for Retraining & Promotion Decisions

Each model type has its own quality gate before auto-promotion:

| Model | Quality Gate | Default Threshold | Env Var | Fail Behavior |
|---|---|---|---|---|
| sentiment | `coverage_ratio >= threshold` | `0.0` (always passes) | `MIN_SENTIMENT_COVERAGE` | Model saved, **not promoted**, reason=`quality_gate_failed` |
| price_predictor | `r2 >= MIN_PRICE_R2` (pre-register) | `-1.0` (always passes) | `MIN_PRICE_R2` | Model not saved, not promoted |
| price_predictor | `candidate_score >= PROMOTION_THRESHOLD` AND `candidate >= incumbent + PROMOTION_MIN_DELTA` (promotion eval) | `threshold=-inf`, `delta=0.0` (no delta required) | `PROMOTION_THRESHOLD`, `PROMOTION_MIN_DELTA` | Model saved, **not promoted**, reason=`promotion_evaluation_failed` with codes `threshold_failed` / `regressed_against_incumbent` |

- **`force=True` flag:** Bypasses all quality gates and evaluation checks. Logged as `status: "forced"` in the promotion audit log. Useful for emergency promotion or reproducing from a manifest.
- **Reproducibility from manifest:** When `manifest` is provided (e.g., from a previous run's `result["models"]["price_predictor"]`), the `seed` and `data_query_bounds` (start_time, end_time) are reused, enabling bit-identical re-runs.
- Manifest source: [retraining_pipeline.py#L258-L272](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/retraining_pipeline.py#L258-L272)

### How to Disable Retraining Safely

There are **multiple safe methods** — choose whichever is appropriate for your environment (no code changes required):

1. **Disable Python APScheduler trigger (simplest):**
   - Stop the data-processing `serve` mode (which starts the scheduler) and switch to `run` single-shot mode only.
   - The scheduler is started in `start_scheduler()` called from `main()` when `sys.argv[1] == "serve"`. By not running `serve`, the 02:00 UTC cron never fires.
   - Source: [main.py#L336-L375](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/main.py#L336-L375)

2. **Remove the retraining cron from the scheduler job list:**
   - Comment out or remove the `retrain_job` block in `AnalyticsScheduler.start()`.
   - This is a code change; use only for permanent disabling.
   - Source: [scheduler.py#L452-L459](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/scheduler.py#L452-L459)

3. **Set the NestJS scheduler module to not load:**
   - The `ModelRetrainingScheduler` is registered as a provider in [model-retraining.module.ts](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/backend/src/model-retraining/model-retraining.module.ts). Do not import `ModelRetrainingModule` into `AppModule`.
   - Note: This only disables the 02:30 UTC fallback; the Python 02:00 UTC trigger still fires. Use method #1 together with this.

4. **Set impossibly strict quality gates (de facto disable promotion, retraining still runs):**
   - `MIN_SENTIMENT_COVERAGE=2.0` (coverage ratio can never exceed 1.0).
   - `MIN_PRICE_R2=1.0` (R-squared of 1.0 is perfect fit, practically unreachable).
   - Models are still trained and registered, but never auto-promoted. This is the **safest partial disable** because it keeps the pipeline exercised but never promotes anything new to production.
   - Manual admin promotion with `force=True` is still available via the API if needed.

5. **Emergency: Kill the retraining lock holder:**
   - If `run_retraining()` is stuck, it holds `_retrain_lock`. Since the lock is a threading lock (not a file lock or DB lock), restarting the data-processing process clears the lock cleanly.
   - The NestJS fallback also acquires an advisory lock via `JobLockService.tryAcquire()`; restarting the backend service clears this.

---

## 4. Promotion Process

### Who/What Promotes a Model

There are **three promotion paths**:

| Promoter | Mechanism | Guarded by Eval? |
|---|---|---|
| **Automated retraining pipeline** | `retraining_pipeline.py` calls `promote_model()` directly after passing quality gates | Yes (unless `force=True`) |
| **Shadow → Live promotion (API)** | `POST /model/shadow/promote` → calls `promote_shadow()` → internally calls `promote_model()` then `unregister_shadow()` | No — by registering a shadow, the operator asserts evaluation has been done via the comparison report |
| **Direct API call (via rollback)** | `POST /model/rollback` with `target_version` → calls `promote_model(target_version)` directly | No — rollback is an operator override action |

### What Checks Happen Before Promotion

The checks are implemented in `promote_model()` in [model_registry.py#L330-L459](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/model_registry.py#L330-L459):

1. **Existence check:** The version `.pkl` file must exist at `models/<type>/<version>.pkl`. If not, `FileNotFoundError`.

2. **Evaluation set scoring (if `evaluation_set` provided):**
   - Both the candidate model and the incumbent (if exists and different from candidate) are loaded and scored.
   - Candidate metrics: `{metric: candidate_score}`. Incumbent metrics: `{metric: incumbent_score}`.
   - If evaluation throws an error and `force=False`: re-raises. If `force=True`: logs a warning and continues.

3. **Threshold check:**
   - Configurable `threshold` parameter, falls back to `PROMOTION_THRESHOLD` env var (default: `-inf`).
   - For higher-is-better metrics (`r2`, `accuracy`): `candidate_score < configured_threshold` → fail.
   - For lower-is-better metric (`mse`): `candidate_score > configured_threshold` → fail.

4. **Delta-over-incumbent check:**
   - Configurable `min_delta` parameter, falls back to `PROMOTION_MIN_DELTA` env var (default: `0.0`).
   - Regressed if: `candidate < incumbent + delta` (higher-is-better) or `candidate > incumbent - delta` (lower-is-better).
   - If no incumbent exists (first run), this check is skipped.

5. **Force override:**
   - If `force=True`: threshold and delta checks are skipped, but evaluation still runs (for the audit log).
   - Status `"forced"` recorded in `promotion_log.jsonl` instead of `"refused"` or implicit success.

6. **Refusal outcomes:**
   - If any non-forced check fails: return `False`, write a `promotion_log.jsonl` entry with `status: "refused"` and `reasons: ["threshold_failed", "regressed_against_incumbent"]`, log a warning.

7. **Promotion execution (after all gates pass):**
   1. Atomically write `current.json` via temp file + `os.replace()` (under `_lock` RLock).
   2. Load the new model from disk.
   3. Hot-swap `_live_models[model_type]` and `_live_versions[model_type]` under the same RLock.
   4. Invalidate the inference cache (`CacheManager.clear_namespace()` for the model type namespace) — best effort, errors logged and swallowed.
   5. Return `True`.

---

## 5. Rollback Procedure (CRITICAL)

Follow these steps **in order** to revert a bad model version. The steps reflect the actual system implementation in [server.py#L889-L969](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/api/server.py#L889-L969) and [model_registry.py#L330-L459](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/model_registry.py#L330-L459).

### Step 1: Identify the Bad Model

1. **Check prediction logs for the suspect version:**
   ```
   GET /model/prediction-logs?model_version=v1.5&model_type=sentiment&limit=100
   ```
   - Endpoint: [server.py#L1086-L1114](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/api/server.py#L1086-L1114)
   - Filters by `model_version` and optional `model_type`. Each log includes `request_id`, `input_hash`, `output`, `latency_ms`, and optionally `raw_input` (if `LOG_PREDICTION_RAW_INPUT=true`).

2. **Check registry status to confirm current version and available versions:**
   ```
   GET /model/status               (Python API, X-API-Key required)
   GET /admin/models/status        (NestJS admin proxy, JWT + ADMIN required)
   ```
   - Response includes: `registry.<type>.current_version`, `available_versions: []`, `current_metadata`, `shadow` status.
   - Endpoint: [server.py#L668-L679](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/api/server.py#L668-L679)

3. **Check the promotion audit log (on disk):**
   - File: `models/<model_type>/promotion_log.jsonl`
   - Each entry includes `timestamp`, `model_type`, `version`, `candidate_metrics`, `incumbent_metrics`, `status` (normal / `forced` / `refused`), `reasons[]`.
   - Use this to identify what version was live before the bad promotion and what thresholds were met/broken.

### Step 2: Revert to a Previous or Pinned Version

Use the dedicated rollback endpoint. This is the **only** supported rollback path.

```http
POST /model/rollback
X-API-Key: <python-api-key>
Content-Type: application/json

{
  "model_type": "price_predictor",
  "target_version": "v1.4"    // OMIT to auto-select the version just before current
}
```

Implementation details of what the endpoint does ([server.py#L889-L969](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/api/server.py#L889-L969)):

1. Captures `previous_live = get_current_version(model_type)` for the response message.
2. Validates that **at least 2 versions exist** (`list_versions()` length >= 2). If not, returns HTTP 400.
3. If `target_version` is omitted: auto-selects the version immediately before the current version in the sorted version list. If current is already the first (oldest), picks the next one (index 1 if available, else index 0).
4. Validates target ≠ current live version (HTTP 400 if already live).
5. Validates target exists in `available_versions` (HTTP 400 if not found).
6. **Calls `promote_model(model_type, target)`** — this performs the atomic zero-downtime swap:
   - Updates `current.json` atomically under RLock.
   - Hot-swaps `_live_models` and `_live_versions` in memory.
   - Invalidates the inference cache namespace.
7. **Clears any registered shadow model** (`unregister_shadow()`) so the old shadow (which may be the bad model you're rolling back from or something conflicting) doesn't interfere.
8. Response includes: `{ status: "rolled_back", previous_version, new_version, message }`.

### Step 3: Update Registry

The rollback endpoint already updates the registry via `promote_model()`, which:

1. **Atomically updates `current.json`** on disk (via temp file + `os.replace()`) under the RLock.
2. **Updates in-memory caches** `_live_models[model_type]` and `_live_versions[model_type]` under the same RLock.
3. **Invalidates cached inference results** for the model type by calling `CacheManager(namespace=model_type).clear_namespace()`.

**No additional registry updates are needed** after calling the rollback endpoint. The operation is idempotent: calling rollback to the same `target_version` that is now live returns HTTP 400 (no-op).

### Step 4: Verify Serving

Verify that the rollback took effect and the service is healthy:

1. **Confirm the current version changed:**
   ```
   GET /model/status
   ```
   Verify `registry.<model_type>.current_version === <target_version>`.
   Also verify `live_in_memory: true` (the hot cache was warmed).

2. **Run a smoke test inference:**
   ```
   POST /analyze       (for sentiment)
   Body: { "text": "Bitcoin looks bullish today" }
   ```
   - Verify HTTP 200.
   - Note the returned `X-Correlation-ID` header for tracing.
   - Then immediately query:
     ```
     GET /model/prediction-logs?model_version=<target_version>&limit=1
     ```
   - Confirm the most recent log entry shows `model_version: <target_version>`.

3. **Clear comparison log (if shadow model was in play during rollback):**
   ```
   DELETE /model/shadow/comparison-log?model_type=price_predictor
   ```
   Rollback already unregistered the shadow, but old comparison log entries remain; clear them to avoid stale reports.

4. **Feature drift sanity check (optional but recommended):**
   The `FeatureDriftDetector` runs on a schedule (every 6 hours by default). After rollback, the restored model's `feature_baseline` (from its `.meta.json`) is what the drift detector will use. Confirm the detector's next run passes without schema mismatch alerts by checking the `schema_version` in the restored metadata matches the current feature schema version (`feature_schema.py`).
   - Detector run: [scheduler.py#L323-L345](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/scheduler.py#L323-L345)
   - Detector implementation: [feature_drift_detector.py](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/feature_drift_detector.py)

5. **Health check:**
   ```
   GET /health
   ```
   Should return `{ status: "healthy" }`.

---

## 6. Serving

### How Models Are Used in Production

#### Sentiment Model Serving Path

```
HTTP Client
    ↓
NestJS Backend (proxy / admin) → apps/backend/src/model-retraining/model-retraining.service.ts
    ↓ POST /retrain, GET /model/status
Python FastAPI Service → apps/data-processing/src/api/server.py
    ↓ POST /analyze, POST /analyze-batch
SentimentAnalyzer.analyze() → apps/data-processing/src/sentiment.py
    ↓ Redis cache check (keyed by content hash + model version + asset filter)
    ↓ Cache miss: get_live_model("sentiment") → VADER polarity_scores()
    ↓ Cache write (on miss)
    ↓ Prediction log write (postgres_service.log_prediction)
    ↓ Correlation ID in response header
```

- **Cache invalidation on model promotion:** Since the cache key includes the model version, promoting a new version inherently changes all cache keys for subsequent requests. Additionally, `promote_model()` explicitly calls `_invalidate_cached_inference(model_type)` → `CacheManager(namespace=model_type).clear_namespace()` to evict the entire namespace.
- **Batch parallelism:** For large batches (≥20 texts), `SentimentAnalyzer.analyze_batch_parallel()` uses `ProcessPoolExecutor` with each worker initializing its own VADER instance.
- Source files:
  - [sentiment.py](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/sentiment.py)
  - [server.py#L434-L575](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/api/server.py#L434-L575)

#### Price Predictor Serving Path

The price predictor is a reusable component. Its inference path:

```
FeatureStore.get_features_for_asset(asset, window)
    ↓ SQL queries → asset_sentiment_view, asset_volume_view, asset_volatility_view
    ↓ Outer merge, forward-fill, NaN→0
    ↓ attrs stamped: schema_version, schema_fingerprint, feature_set
PricePredictor.predict(features_df)
    ↓ check_serving_schema(training_schema_version, attrs["schema_version"])
        ↓ strict: raise SchemaVersionMismatch
        ↓ warn:   log WARNING + increment FEATURE_SCHEMA_MISMATCH_TOTAL
    ↓ pipeline.predict(features) → StandardScaler → LinearRegression
```

- **The feature schema contract** (critical for preventing silent wrong predictions):
  - The feature set `PRICE_PREDICTOR_FEATURE_SET = "price_predictor_features"` is defined in [feature_schema.py#L121-L135](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/feature_schema.py#L121-L135).
  - Current schema v1.0 features:
    1. `sentiment_score` (float64) — Compound sentiment score [-1, 1]
    2. `volume` (float64) — XLM-equivalent on-chain volume [0, +inf)
    3. `volatility` (float64) — Rolling log-return volatility [0, +inf)
  - Schema fingerprint is a deterministic SHA-256 hash of ordered `name:dtype` pairs (first 12 chars). This catches **accidental** structural drift even if someone forgets to bump the version string.
  - Enforcement mode environment variable: `FEATURE_SCHEMA_ENFORCEMENT` (`"strict"` or `"warn"`, default `"warn"`).
  - Source: [feature_schema.py#L165-L218](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/feature_schema.py#L165-L218) (`check_serving_schema`)

#### Feature Drift Monitoring (Serving Health)

Every `FEATURE_DRIFT_INTERVAL_HOURS` hours (default: 6), the scheduler runs `FeatureDriftDetector.detect()`:

1. Loads the **current promoted model's metadata sidecar** (`load_metadata("price_predictor", "current")`) to retrieve:
   - `feature_baseline` — quantile-bin edges and proportions per feature from training time.
   - `schema_version`, `schema_fingerprint` recorded at training time.
2. Pulls the **current serving feature window** (`FEATURE_DRIFT_SERVING_WINDOW`, default `"7d"`) for asset `FEATURE_DRIFT_ASSET` (default `"XLM"`) via the same `FeatureStore` the model consumes.
3. Performs two drift classes:
   - **Schema-level drift:** training `schema_version`/`schema_fingerprint` vs current serving schema. Mismatch is itself a drift signal.
   - **Distribution-level drift per feature:** Computes Population Stability Index (PSI) between training baseline and serving sample.
     - PSI formula: `Σ_bins (serving% − baseline%) · ln(serving% / baseline%)`
     - Threshold: `FEATURE_DRIFT_PSI_THRESHOLD` (default: `0.25`, industry convention for "major shift").
4. If drift detected: raises an alert via `AlertNotifier.notify_feature_drift(report_dict)`. Also increments `FEATURE_DRIFT_ALERTS_TOTAL` with reason codes `"schema"` or `"distribution"`.
5. The detector is **strictly read-only and defensive**. All exceptions are caught and logged; a failed drift check never crashes the scheduler.
- Source: [feature_drift_detector.py](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/feature_drift_detector.py)
- Scheduler integration: [scheduler.py#L323-L345](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/scheduler.py#L323-L345)

### Files Responsible for Inference or Loading Models

| Purpose | File | Key Functions / Classes |
|---|---|---|
| Model registry (load, hot cache, promote) | [model_registry.py](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/model_registry.py) | `get_live_model()`, `load_model()`, `load_metadata()`, `get_current_version()` |
| Sentiment inference | [sentiment.py](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/sentiment.py) | `SentimentAnalyzer.analyze()`, `.analyze_batch()`, `.analyze_batch_parallel()` |
| Price predictor inference + skew guard | [price_predictor.py](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/price_predictor.py) | `PricePredictor.predict()` |
| Feature set assembly for serving | [feature_store.py](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/feature_store.py) | `FeatureStore.get_features_for_asset()` |
| Schema skew guard enforcement | [feature_schema.py](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/feature_schema.py) | `check_serving_schema()`, `SchemaVersionMismatch` |
| Shadow-mode dual inference | [shadow_predictor.py](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/shadow_predictor.py) | `ShadowPredictor.predict()`, `create_shadow_predictor()` |
| Serving distribution drift detection | [feature_drift_detector.py](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/ml/feature_drift_detector.py) | `FeatureDriftDetector.detect()` |
| HTTP serving endpoints | [server.py](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/data-processing/src/api/server.py) | `/analyze`, `/analyze-batch`, `/model/*` endpoints |
| Backend proxy to model service | [model-retraining.service.ts](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/backend/src/model-retraining/model-retraining.service.ts) | `triggerRetraining()`, `getModelStatus()` |
| Backend admin endpoints | [model-retraining.controller.ts](file:///C:/Users/USER/Documents/GitHub/Lumenpulse/apps/backend/src/model-retraining/model-retraining.controller.ts) | `POST /admin/models/retrain`, `GET /admin/models/status` |

---

## Assumptions & Known Gaps

The following are explicitly stated as assumptions because the codebase does not implement them:

1. **Model rollback in the NestJS backend admin API:** The backend `ModelRetrainingController` only exposes `POST /admin/models/retrain` and `GET /admin/models/status`. It does **not** proxy the Python service's `POST /model/rollback`, `POST /model/shadow/*`, or `GET /model/shadow/*` endpoints. Operators performing rollback or shadow operations must call the Python service directly with the `X-API-Key` header.

2. **Explicit "pinned version" concept:** The codebase does not have a separate `pinned.json` pointer or `is_pinned` boolean field. The shadow mode (`register_shadow` + `promote_shadow`) is the functionally equivalent mechanism for staging a candidate. There is no way to mark an arbitrary historical version as "pinned" separately from "current" without registering it as a shadow.

3. **Direct serving of price_predictor via HTTP:** The FastAPI server exposes sentiment inference endpoints (`/analyze`, `/analyze-batch`) but does not have a dedicated `/predict-price` endpoint. The `PricePredictor` class is a reusable component intended to be consumed by internal analytics jobs (e.g., the forecast endpoint uses a different `SentimentForecaster`). Any production price prediction serving must be built by composing `FeatureStore` → `PricePredictor.predict` in a new route.

4. **Feature drift detection is read-only alerting only:** The `FeatureDriftDetector` raises alerts but does **not** automatically trigger retraining, rollback, or model rotation. It is an operator-facing signal, not an automated actuator.
