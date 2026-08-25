# NER Model Catalogue

This document records every model artifact used by the data-processing service,
its pinned version, and its licence. Update this file in the **same commit** as
any version bump so the history stays auditable.

---

## en_core_web_sm — spaCy English pipeline (small)

| Field        | Value |
|--------------|-------|
| Model name   | `en_core_web_sm` |
| Pinned version | **3.7.1** |
| Full package | `en_core_web_sm-3.7.1` |
| Source       | <https://github.com/explosion/spacy-models/releases/tag/en_core_web_sm-3.7.1> |
| Licence      | **MIT** — <https://github.com/explosion/spacy-models/blob/master/LICENSE> |
| Used by      | `src/analytics/ner_service.py` → `NERService` |
| Download timing | **Image build time** (Dockerfile builder stage) |

### Why this model?

`en_core_web_sm` provides the named-entity recognition pipeline
(`PERSON`, `ORG`, `GPE`, `PRODUCT`, …) that powers `NERService`.
It is supplemented with a custom `entity_ruler` for crypto-specific
`PROJECT` and `ASSET` labels derived from `keywords.py`.

The *small* variant is chosen for its low footprint (~12 MB) and adequate
precision for news-tagging workloads.  Upgrade to `en_core_web_md` or
`en_core_web_lg` only after benchmarking precision gains against the added
image-size cost, and update `NER_MODEL_NAME` / `NER_MODEL_VERSION` in
`ner_service.py` together with this file and the Dockerfile.

### Upgrading

1. Pick the new version from <https://github.com/explosion/spacy-models/releases>.
2. Update `NER_MODEL_VERSION` in `src/analytics/ner_service.py`.
3. Update the `python -m spacy download` line in `Dockerfile` (builder stage).
4. Update the table above.
5. Run `pytest tests/` and confirm the version-check test passes.
6. Rebuild the Docker image (`docker build .`) to bake the new weights in.

---

## ProsusAI/finbert — FinBERT sentiment model

| Field        | Value |
|--------------|-------|
| Model name   | `ProsusAI/finbert` |
| Pinned version | Hugging Face Hub HEAD at build time (hash-pinned via `requirements.lock`) |
| Licence      | **Apache 2.0** |
| Used by      | `src/sentiment.py` |
| Download timing | **Image build time** (Dockerfile builder stage) |
