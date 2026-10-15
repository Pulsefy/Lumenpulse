#! /usr/bin/env python3
"""
Configuration for the pinned, vendored spaCy NER model.

The NER model used by ``ner_service.NERService`` is pinned to an exact version
so that entity-extraction behaviour cannot drift without a commit to this
repository. The model artifact is fetched once at image build time (see
``scripts/fetch_ner_model.py`` and the Dockerfile) and is served from an
on-disk vendored location at runtime, so the service starts with no outbound
network access.
"""

from dataclasses import dataclass
import os


# Exact install name / version for the spaCy model. Resolving against a
# floating "latest" is intentionally avoided; this is the single source of
# truth for which model the service expects to be present.
NER_MODEL_NAME = "en_core_web_sm"
NER_MODEL_VERSION = "3.7.1"

# Root of the data-processing app. When running from a container the working
# directory is /app, but this resolves correctly for local dev too.
_APP_ROOT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..")
)


@dataclass(frozen=True)
class NERConfig:
    """Runtime configuration for locating the vendored NER model."""

    model_name: str = NER_MODEL_NAME
    model_version: str = NER_MODEL_VERSION
    # Directory where the model package is expected to be installed/vendored.
    model_dir: str = os.path.join(_APP_ROOT, "models", "ner")

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
    def from_env(cls: type["NERConfig"]) -> "NERConfig":
        """Allow the vendored model location/version to be overridden via env.

        Overrides are useful for local testing, but the committed defaults are
        the exact pinned build-time artifact.
        """
        return cls(
            model_name=os.getenv("NER_MODEL_NAME", NER_MODEL_NAME),
            model_version=os.getenv("NER_MODEL_VERSION", NER_MODEL_VERSION),
            model_dir=os.getenv(
                "NER_MODEL_DIR",
                os.path.join(_APP_ROOT, "models", "ner"),
            ),
        )
