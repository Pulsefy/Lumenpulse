# Feature & KPI Lineage

This document explains how the lineage manifest works, how to read it, and
what to do when you add or change a feature or KPI.  It is the primary
onboarding guide for contributors working on the data-processing module.

---

## What is lineage and why does it matter?

Every number that LumenPulse shows a user — a market health score, a
sentiment badge, a cohort retention rate — is derived from raw data through
a chain of transformations.  Without documentation of that chain:

- Bugs hide because no-one knows which source feeds which output.
- Computed metrics drift silently when upstream code changes.
- New contributors spend hours reverse-engineering pipelines before writing
  a single line of code.
- Ownership is unclear, so incidents have no obvious point of contact.

The lineage manifest makes that chain explicit and machine-readable.

---

## Where is the manifest?

```
apps/data-processing/
└── src/
    └── lineage/
        ├── __init__.py               # Python package; exposes MANIFEST_PATH
        └── feature_lineage.yaml      # ← THE manifest  (edit this file)
```

The manifest lives next to the pipeline code so that `git diff` on a source
file naturally prompts you to update the adjacent manifest.

---

## Quick start for contributors

```bash
# 1. Validate the manifest (runs all checks)
cd apps/data-processing
python scripts/validate_lineage.py

# 2. Print a summary of all registered features and KPIs
python scripts/validate_lineage.py --summary

# 3. Inspect a specific entry (e.g. the market health score)
python scripts/validate_lineage.py --show market_health_score

# 4. Verify that every source_file path actually exists
python scripts/validate_lineage.py --check-files

# 5. Machine-readable output for CI pipelines
python scripts/validate_lineage.py --json
```

---

## Manifest structure

The manifest is a YAML file with three top-level sections:

```yaml
manifest_version: "1.0"
project: lumenpulse
module: data-processing

ml_feature_sets:    # ML input features
  - id: ...

kpi_datasets:       # Derived metrics surfaced via the API
  - id: ...
```

### Entry schema

Every entry (whether an ML feature set or a KPI dataset) **must** contain:

| Key            | Type   | Description                                               |
|----------------|--------|-----------------------------------------------------------|
| `id`           | str    | Unique snake_case identifier.  Never re-use a deleted id. |
| `display_name` | str    | Human-readable label shown in summaries.                  |
| `description`  | str    | What this feature/KPI is and why it exists.               |
| `owner`        | str    | Email (`you@domain`) or GitHub handle (`@username`).      |
| `source_file`  | str    | Path (relative to `apps/data-processing`) to the file     |
|                |        | where this is computed.                                   |

Entries **should** also contain:

| Key           | Description                                                  |
|---------------|--------------------------------------------------------------|
| `formula`     | Mathematical or algorithmic definition.                      |
| `inputs`      | List of upstream features/tables/services this depends on.   |
| `downstream`  | Files/APIs that consume this output.                         |
| `storage`     | Where the result is stored (table, file, in-memory, etc.).   |
| `update_cadence` | How often this is recomputed.                             |

---

## Registered ML Feature Sets

### `price_predictor_features`

Source: `src/ml/feature_store.py`  
Model: `src/ml/price_predictor.py`  
Registry key: `price_predictor`

Three time-aligned columns fetched per asset and outer-merged on timestamp:

| Feature          | Range       | Source view / service               |
|------------------|-------------|--------------------------------------|
| `sentiment_score`| [-1.0, 1.0] | `asset_sentiment_view` → SentimentAnalyzer |
| `volume`         | [0, ∞)      | `asset_volume_view` → StellarFetcher |
| `volatility`     | [0, ∞)      | `asset_volatility_view` → PriceFetcher |

Gaps are forward-filled then filled with 0.  The target column is supplied
by the caller at training time.

Quality gate: `MIN_PRICE_R2` env var (default `-1.0`; tighten in production).

---

### `sentiment_model_features`

Source: `src/ml/retraining_pipeline.py`  
Model: `src/analytics/sentiment.py`  
Registry key: `sentiment`

The "features" here are lexicon entries that extend the VADER base lexicon:

| Component              | Description                                               |
|------------------------|-----------------------------------------------------------|
| `vader_base_lexicon`   | ~7,500 built-in VADER tokens.                             |
| `crypto_slang_lexicon` | Custom extensions from `data/crypto_slang_lexicon.json`.  |
| `finbert_transformer`  | ProsusAI/FinBERT (HuggingFace); used for English when the `transformers` library is installed and `SENTIMENT_DISABLE_TRANSFORMER != true`. |

---

## Registered KPI Datasets

### `market_health_score`

```
market_health_score = (sentiment_score × 0.7) + (tanh(volume_change) × 0.3)
```

Output range `(-1, 1)`.  Classified as:

- `bullish`  when score > 0.2
- `bearish`  when score < −0.2
- `neutral`  otherwise

Consumed by: `forecaster.py`, `GET /api/market-analysis`.  
Written to: `data/analytics.jsonl`.

---

### `sentiment_compound`

Per-text score from `SentimentAnalyzer`:

- **English**: FinBERT primary, VADER + crypto-keyword boost as fallback.
- **Spanish / Portuguese**: keyword-hit ratio.

Range `[-1, 1]`.  Thresholds: bullish ≥ 0.05, bearish ≤ −0.05.  
Stored in: `articles.sentiment_score` (PostgreSQL).

---

### `cohort_metrics`

Produced by `CohortAnalyzer` from on-chain Soroban contribution events.
Key fields: `retention_rate`, `avg_contributed_per_member`, `member_count`.
Stored in: `cohort_members`, `cohort_analysis_results` tables.

---

### `attribution_score`

Weighted average of five signals (weights sum to 1.0):

| Signal               | Weight |
|----------------------|--------|
| `entity_link`        | 0.35   |
| `mention`            | 0.25   |
| `keyword`            | 0.20   |
| `sentiment_coherence`| 0.10   |
| `category`           | 0.10   |

Confidence tiers: high ≥ 0.75 | medium ≥ 0.50 | low ≥ 0.25 | very_low < 0.25.  
Stored in: `narrative_attribution_scores` table.

---

### `round_anomaly_signals`

Statistical anomaly signals for quadratic-funding rounds:
`CONCENTRATION_RISK`, `SYBIL_SUSPICION`, `UNUSUAL_TIMING`,
`DISPROPORTIONATE_ALLOCATION`, `LOW_PARTICIPATION`,
`HIGH_SINGLE_CONTRIBUTION`.  
Stored in: `round_anomaly_signals` table.

---

### `project_verification_trend`

Approval / rejection rates over sliding windows, with trend direction
(`improving` | `declining` | `stable`) derived from delta vs. previous
window.  Not persisted — returned in API response.

---

### `correlation_result`

Pearson r between sentiment scores and price or volume series.  
Includes p-value, confidence level, optional time-lag, and scatter data.  
Not persisted — returned in `GET /api/correlation`.

---

### `market_forecast`

24h / 48h predictions of `market_health_score`.  Auto-selects backend:
Prophet → scikit-learn Ridge → heuristic decay.  
Source data: `data/analytics.jsonl`.

---

### `anomaly_detection_result`

Z-Score + Isolation Forest detector for volume / sentiment spikes.  
Rolling 24-hour window, z-threshold 2.5.  
Triggers alerts via `alert_notifier` / `alertbot`.

---

## How to update the manifest

### Adding a new feature or KPI

1. Implement the computation in the appropriate source file.
2. Open `src/lineage/feature_lineage.yaml`.
3. Add a new entry under `ml_feature_sets` or `kpi_datasets`.
4. Fill in **all required keys** (`id`, `display_name`, `description`,
   `owner`, `source_file`) plus as many optional keys as you can.
5. Run `python scripts/validate_lineage.py --check-files` and fix any
   errors before opening a PR.

### Changing an existing computation

1. Make your code change.
2. Find the corresponding entry in the manifest by its `id`.
3. Update `formula`, `inputs`, `output_fields`, or any other affected keys.
4. If ownership has changed, update `owner`.
5. Re-run the validator.

### Removing a feature or KPI

1. Mark the entry with `deprecated: true` and add a `deprecated_reason`
   field — do **not** delete it immediately, so that audit trails are
   preserved.
2. After one release cycle, remove the entry entirely.
3. Never re-use a deleted `id`.

---

## CI enforcement

The validator is designed to be dropped into any CI pipeline:

```yaml
# GitHub Actions example
- name: Validate lineage manifest
  run: |
    cd apps/data-processing
    python scripts/validate_lineage.py --json --check-files
```

Exit code 0 = valid.  Exit code 1 = errors; details in stdout JSON.

---

## Who to contact

All entries are owned by `data-team@lumenpulse.io`.  For feature-specific
questions, check the `owner` field in the manifest or look at the
`source_file` for the Git blame trail.
