#! /usr/bin/env python3
"""
Configuration for the pinned, vendored spaCy embedding model.

The sentence/document embedding model used by
``embedding_service.EmbeddingService`` is pinned to an exact version so that
embedding vectors cannot drift without a commit to this repository. The model
artifact is fetched once at image build time (see
``scripts/fetch_embedding_model.py`` and the Dockerfile) and is served from an
on-disk vendored location at runtime, so the service starts with no outbound
network access.

``en_core_web_md`` is chosen because it ships 300-dimensional GloVe-style word
vectors baked into a single pip wheel (same distribution channel as the NER
model), which makes the exact pinned artifact replicable at build time.
"""

import os
from dataclasses import dataclass


# Exact install name / version for the spaCy model. Resolving against a
# floating "latest" is intentionally avoided; this is the single source of
# truth for which embedding model the service expects to be present.
EMBEDDING_MODEL_NAME = "en_core_web_md"
EMBEDDING_MODEL_VERSION = "3.7.1"

# Root of the data-processing app. When running from a container the working
# directory is /app, but this resolves correctly for local dev too.
_APP_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


@dataclass(frozen=True)
class EmbeddingConfig:
    """Runtime configuration for locating the vendored embedding model."""

    model_name: str = EMBEDDING_MODEL_NAME
    model_version: str = EMBEDDING_MODEL_VERSION
    # Directory where the model package is expected to be installed/vendored.
    model_dir: str = os.path.join(_APP_ROOT, "models", "embeddings")
    # Dimensionality of the vectors produced by the pinned model. Kept as a
    # single constant so callers can validate stored rows without importing
    # spaCy; must match the vendored model's `vector_width`.
    dimension: int = 300

    @property
    def shipped_version_tag(self) -> str:
        """Version tag embedded in the vendored model's meta.json."""
        return f"{self.model_name}-{self.model_version}"

    @property
    def model_wheel_url(self) -> str:
        """URL of the exact pinned model wheel published by Explosion."""
        return (
            f"https://github.com/explosion/spacy-models/releases/download/"
            f"{self.shipped_version_tag}/{self.shipped_version_tag}-py3-none-any.whl"
        )

    @classmethod
    def from_env(cls: type["EmbeddingConfig"]) -> "EmbeddingConfig":
        """Allow the vendored model location/version to be overridden via env.

        Overrides are useful for local testing, but the committed defaults are
        the exact pinned build-time artifact.
        """
        return cls(
            model_name=os.getenv("EMBEDDING_MODEL_NAME", EMBEDDING_MODEL_NAME),
            model_version=os.getenv("EMBEDDING_MODEL_VERSION", EMBEDDING_MODEL_VERSION),
            model_dir=os.getenv(
                "EMBEDDING_MODEL_DIR",
                os.path.join(_APP_ROOT, "models", "embeddings"),
            ),
            dimension=int(os.getenv("EMBEDDING_DIMENSION", "300")),
        )
