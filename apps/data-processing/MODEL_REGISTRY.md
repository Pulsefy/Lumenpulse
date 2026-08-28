# Model registry layout

Each model type has its own directory beneath `MODEL_REGISTRY_PATH` (default
`./models`):

```text
models/
  sentiment/
    v1.0.pkl
    v1.0.meta.json
    current.json          # JSON pointer file
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