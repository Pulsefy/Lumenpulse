# Vendored spaCy NER Model

This directory is the runtime home for the **pinned** spaCy NER model used by
[`src/analytics/ner_service.py`](../src/analytics/ner_service.py).

The artifact itself is **fetched at image build time**, not at container start.
It is baked into the container image via
[`scripts/fetch_ner_model.py`](../scripts/fetch_ner_model.py) (invoked from the
[Dockerfile](../Dockerfile)), so the service starts with **no outbound network
access** for model resolution.

## Pinned Model

| Field        | Value             |
| ------------ | ----------------- |
| Model        | `en_core_web_sm`  |
| Version      | `3.7.1`           |
| License      | MIT               |
| Source       | Explosion spaCy models (GitHub releases) |
| Wheel URL    | `https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.7.1/en_core_web_sm-3.7.1-py3-none-any.whl` |
| Config       | `src/config/ner_config.py` |

The version is pinned explicitly in [`src/config/ner_config.py`](../src/config/ner_config.py);
the service never resolves a floating "latest".

## How to rebuild / update

1. Update `NER_MODEL_NAME` / `NER_MODEL_VERSION` in `src/config/ner_config.py`.
2. Rebuild the image; the Dockerfile runs `scripts/fetch_ner_model.py`, which
   downloads and vendors the new exact version and fails the build on mismatch.

```bash
docker build -f apps/data-processing/Dockerfile -t lumenpulse-data-processing apps/data-processing
```

## Verifying at runtime

A container startup gate (`python src/main.py check-models`) verifies the
expected model version is present and fails fast otherwise. The `serve` mode
runs the same gate before starting the scheduler.

> This binary artifact is intentionally not committed to the repository; it is
> reproduced deterministically from the pinned wheel at image build time.
