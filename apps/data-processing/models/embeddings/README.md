# Vendored spaCy Embedding Model

This directory is the runtime home for the **pinned** spaCy document-embedding
model used by [`src/analytics/embedding_service.py`](../src/analytics/embedding_service.py)
for semantic news search ([issue #1455](../INFERENCE_LATENCY_BUDGET.md)).

The artifact itself is **fetched at image build time**, not at container start.
It is baked into the container image via
[`scripts/fetch_embedding_model.py`](../scripts/fetch_embedding_model.py)
(invoked from the [Dockerfile](../Dockerfile)), so the service starts with **no
outbound network access** for model resolution.

## Pinned Model

| Field       | Value             |
| ----------- | ----------------- |
| Model       | `en_core_web_md`  |
| Version     | `3.7.1`           |
| Dimension   | 300               |
| License     | MIT               |
| Source      | Explosion spaCy models (GitHub releases) |
| Wheel URL   | `https://github.com/explosion/spacy-models/releases/download/en_core_web_md-3.7.1/en_core_web_md-3.7.1-py3-none-any.whl` |
| Config      | `src/config/embedding_config.py` |

The version is pinned explicitly in
[`src/config/embedding_config.py`](../src/config/embedding_config.py); the
service never resolves a floating "latest".

## How to rebuild / update

1. Update `EMBEDDING_MODEL_NAME` / `EMBEDDING_MODEL_VERSION` in
   `src/config/embedding_config.py`.
2. Rebuild the image; the Dockerfile runs `scripts/fetch_embedding_model.py`,
   which downloads and vendors the new exact version and fails the build on
   mismatch.

```bash
docker build -f apps/data-processing/Dockerfile -t lumenpulse-data-processing apps/data-processing
```

## Verifying at runtime

A container startup gate (`python src/main.py check-models`) verifies the
expected model version is present and fails fast otherwise. The `serve` mode
runs the same gate before starting the scheduler. `GET /search/similar`
returns `503` while the model is missing rather than searching over empty
vectors.

## Backfill

Existing articles are embedded through the resumable backfill:

```bash
python scripts/backfill_embeddings.py                # full resumable run
python scripts/backfill_embeddings.py --limit 50     # bounded/smoke run
python scripts/backfill_embeddings.py --dry-run      # plan, no writes
```

> This binary artifact is intentionally not committed to the repository; it is
> reproduced deterministically from the pinned wheel at image build time.