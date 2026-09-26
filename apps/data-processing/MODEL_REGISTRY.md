# Model registry layout

Each model type has its own directory beneath `MODEL_REGISTRY_PATH` (default
`./models`):

```text
models/
  sentiment/
    v1.0.pkl
    v1.0.meta.json
    current.json          # JSON pointer file (live version)
    previous.json         # version that was live before current.json
    promotion_log.jsonl
    shadow/
```

The live pointer is a small JSON file named `current.json`:

```json
{"version":"v1.0"}
```

Promotion writes a temporary pointer in the same directory and replaces
`current.json` with `os.replace`, so readers see either the old or new
complete pointer. On first resolution, a legacy `current` symlink is read,
converted to this JSON format, and removed. Model files remain versioned and
are never overwritten by promotion.

## Retention and garbage collection

`save_model` adds a version on every retraining run, so old versions are
removed with a retention command:

```bash
python -m src.ml.model_registry_gc --dry-run      # list what would be deleted
python -m src.ml.model_registry_gc                # delete
python -m src.ml.model_registry_gc --model-type sentiment --keep-last 3
```

A version is kept if any of these hold:

- it is one of the newest `keep_last` versions of its model type
  (`--keep-last` / `MODEL_RETENTION_KEEP_LAST`, default 5);
- it was saved within `max_age_days` days
  (`--max-age-days` / `MODEL_RETENTION_MAX_AGE_DAYS`, default 30; `0` turns
  the age rule off);
- it is protected: the live version, the previous live version
  (`previous.json`, or the version saved just before the live one when no
  history exists) and any shadow version. Protected versions are never
  removed, whatever the policy says.

Removing a version deletes its `.pkl`, `.meta.json` and `.card.json` files.
Each removal is logged with the space reclaimed, and the command prints a
summary. Files that are not named `v<major>.<minor>` are left alone. Do not
run the command while a promotion is in progress in another process.
