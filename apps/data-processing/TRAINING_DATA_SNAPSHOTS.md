# Training Data Snapshots

Immutable, content-addressed snapshots of the exact dataset used to train a
model. Introduced for Issue #1449 so Wave 8 seeded manifests remain reproducible
even when live feature-store tables have moved on.

## Why

`_fetch_training_data` previously queried live tables (or generated fresh
synthetic rows) at training time. Re-running a recorded manifest against a
changed database could not reproduce the original artefact. Snapshots freeze
the frame that was actually fit.

## How it works

1. On a fresh training run, the pipeline fetches live/synthetic data, then
   calls `write_snapshot(df)` which:
   - Serializes the frame to a **canonical CSV** (sorted columns, stable float
     format).
   - Computes `sha256` and assigns `snapshot_id = tds_<first 16 hex chars>`.
   - Writes `data/training_snapshots/<id>.csv` + `<id>.manifest.json`.
2. The snapshot reference (`snapshot_id`, `content_hash`, `uri`, retention +
   cost estimate) is recorded in:
   - the model metadata sidecar (`*.meta.json`)
   - the **model card** (`*.card.json` → `training_data.snapshot_*`)
3. Replaying a manifest with `snapshot_ref` / `snapshot_id` loads the CSV and
   **skips** the live query, producing an identical artefact.

Environment overrides:

| Variable | Default | Meaning |
| --- | --- | --- |
| `TRAINING_SNAPSHOT_PATH` | `./data/training_snapshots` | Snapshot root |
| `TRAINING_SNAPSHOT_RETENTION_DAYS` | `90` | Retention window |
| `TRAINING_SNAPSHOT_COST_USD_PER_GB_MONTH` | `0.023` | Cost model (S3 std-ish) |

## Retention policy

- Snapshots are retained for **90 days** by default.
- `apply_retention()` deletes CSV + manifest pairs whose `created_at` is older
  than the retention window. Safe to schedule via cron.
- Content-addressed objects are shared: identical datasets reuse one id, so
  retention is evaluated per snapshot id (manifest mtime / `created_at`).
- After purge, bit-for-bit reproduction requires restoring the snapshot from
  backup. Model artefacts themselves remain on disk under the model registry.

## Cost estimate

`estimate_storage_cost(bytes_used=…)` and each snapshot's
`cost_estimate` field report:

- GiB used
- USD / GB-month (default `0.023`)
- Estimated USD per month
- Estimated USD over the retention window (`retention_days / 30 × monthly`)

Example: a 5 MiB snapshot ≈ `0.000005` GiB → roughly `$0.0000001` / month at
the default rate — negligible for CI synthetic frames; scale linearly with
production feature-store dumps.

Operators can call:

```python
from src.ml.training_data_snapshot import (
    get_retention_policy,
    total_snapshot_bytes,
    estimate_storage_cost,
    apply_retention,
)

policy = get_retention_policy()
cost = estimate_storage_cost(bytes_used=total_snapshot_bytes())
apply_retention()  # housekeeping
```

## Model card

Every promoted `price_predictor` version writes a model card whose
`training_data` block includes:

- `snapshot_id`
- `snapshot_hash` (full sha256)
- `snapshot_uri` (`file://…` local path)

Acceptance: the snapshot reference is visible on the card without digging into
the metadata sidecar.
