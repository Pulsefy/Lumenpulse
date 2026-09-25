"""
Sentence/document embedding service for semantic news search.

Uses a **pinned and vendored** spaCy pipeline (``en_core_web_md``) to project
article text into a fixed-dimension vector space. Cosine similarity over these
vectors drives the semantic search endpoint and the backfill/quality tooling,
mirroring the way the NER service pins its model artifact:

* Embedding behaviour cannot change without a commit to this repo (the model
  is never resolved to a floating "latest" at runtime).
* The artifact is fetched at image build time, not at container start (see
  ``scripts/fetch_embedding_model.py`` and the Dockerfile), so the service
  starts with no outbound network access for model resolution.
* A startup check verifies the expected model version is present and fails
  fast otherwise (see :func:`check_model_available` and the ``--check-models``
  CLI flag in ``src/main.py``).
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from typing import Any, Dict, List, Optional, Sequence

try:
    import spacy
except ImportError:  # pragma: no cover - exercised in minimal test envs
    spacy = None

from ..config.embedding_config import EmbeddingConfig

logger = logging.getLogger(__name__)

_EMBEDDING_MODEL_META_FILENAME = "meta.json"


def _pinned_model_meta(cfg: EmbeddingConfig) -> Optional[Dict[str, Any]]:
    """Read the meta of the vendored model, or None if unavailable/broken."""
    meta_path = os.path.join(cfg.model_dir, _EMBEDDING_MODEL_META_FILENAME)
    if not os.path.isfile(meta_path):
        return None
    try:
        with open(meta_path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def check_model_available(cfg: Optional[EmbeddingConfig] = None) -> None:
    """Verify the pinned embedding model is present and the correct version.

    Raises :class:`MissingEmbeddingModelError` if the model is missing or does
    not match the pinned version, so callers can fail fast at startup before
    doing any real work.

    :param cfg: Embedding config override (defaults to pinned committed
        defaults).
    """
    cfg = cfg or EmbeddingConfig.from_env()

    meta = _pinned_model_meta(cfg)
    expected = cfg.shipped_version_tag

    if meta is None:
        raise MissingEmbeddingModelError(
            f"No vendored embedding model found at {cfg.model_dir}. Expected "
            f"{expected}. Run `python scripts/fetch_embedding_model.py` and "
            "rebuild the image (the model is fetched at build time, not at "
            "runtime)."
        )

    actual = meta.get("name")
    if actual != expected:
        raise MissingEmbeddingModelError(
            f"Embedding model version mismatch: expected {expected} but found "
            f"{actual!r} at {cfg.model_dir}. Rebuild the image with the pinned "
            "model (see scripts/fetch_embedding_model.py)."
        )


class MissingEmbeddingModelError(RuntimeError):
    """Raised when the pinned vendored embedding model is absent/mismatched."""


def normalize_vector(vector: Sequence[float]) -> List[float]:
    """Return a unit-length copy of ``vector`` (unchanged if all zero)."""
    norm = sum(float(value) ** 2 for value in vector) ** 0.5
    if norm == 0.0:
        return [float(value) for value in vector]
    return [float(value) / norm for value in vector]


def cosine_similarity(a: Sequence[float], b: Sequence[float]) -> float:
    """
    Cosine similarity between two numeric vectors.

    Empty or all-zero vectors yield 0.0 so ranked search never sees a NaN.
    """
    if not a or not b or len(a) != len(b):
        return 0.0

    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(y * y for y in b) ** 0.5

    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


def article_text(
    title: Optional[str] = None,
    summary: Optional[str] = None,
    content: Optional[str] = None,
) -> str:
    """
    Canonical text an article is embedded from.

    Title, summary and content are joined in that order so the headline and
    lead dominate the vector, mirroring how the text is truncated at inference
    time (headline + lead are preserved for long articles).
    """
    chunks = [
        value.strip()
        for value in (title or "", summary or "", content or "")
        if value and value.strip()
    ]
    return "\n".join(chunks)


def hash_article_text(
    title: Optional[str] = None,
    summary: Optional[str] = None,
    content: Optional[str] = None,
) -> str:
    """sha256 hexdigest over :func:`article_text` for stale-row detection."""
    return hashlib.sha256(
        article_text(title, summary, content).encode("utf-8")
    ).hexdigest()


class EmbeddingService:
    """
    Encode news text into fixed-dimension vectors using the pinned model.
    """

    def __init__(self, cfg: Optional[EmbeddingConfig] = None) -> None:
        self._cfg = cfg or EmbeddingConfig.from_env()
        self._nlp = self._initialize_pipeline()

    @property
    def model_version(self) -> str:
        """Exact pinned model version served by this service (e.g. ``3.7.1``)."""
        return self._cfg.model_version

    @property
    def model_name(self) -> str:
        """Pinned model artifact name (``en_core_web_md``)."""
        return self._cfg.model_name

    @property
    def dimension(self) -> int:
        """Dimensionality of the vectors produced by the pinned model."""
        return self._cfg.dimension

    def _initialize_pipeline(self) -> Optional[Any]:
        if spacy is None:
            logger.warning("spaCy is not installed; embedding inference is unavailable")
            return None

        # Only the exact pinned/vendored model may be loaded. If it is not
        # present we refuse to fall back to an unpinned or blank pipeline; the
        # strict "fail fast" behaviour is enforced by the startup gates
        # (scripts/fetch_embedding_model.py --check-only and the `check-models`
        # / `serve` commands in src/main.py), where a missing model is an error.
        try:
            check_model_available(self._cfg)
        except MissingEmbeddingModelError as exc:
            logger.warning(
                "Pinned embedding model is not available (%s); embedding "
                "inference is disabled. Run `python scripts/fetch_embedding_model.py` "
                "to vendor the model (or `python src/main.py check-models` "
                "to enforce it).",
                exc,
            )
            return None

        try:
            nlp = spacy.load(
                self._cfg.model_dir,
                exclude=["ner", "parser", "lemmatizer", "tagger", "textcat"],
            )
        except OSError as exc:  # pragma: no cover - defensive
            raise MissingEmbeddingModelError(
                f"Failed to load pinned embedding model at {self._cfg.model_dir}: {exc}"
            ) from exc

        if nlp.meta.get("name") != self._cfg.shipped_version_tag:
            raise MissingEmbeddingModelError(
                f"Embedding model meta mismatch: expected "
                f"{self._cfg.shipped_version_tag} at {self._cfg.model_dir}."
            )

        logger.info("Initialized pinned embedding model: %s", self.model_version)
        return nlp

    def embed(self, text: Optional[str]) -> List[float]:
        """
        Encode ``text`` into a unit-length vector.

        Raises :class:`MissingEmbeddingModelError` when the pinned model is not
        loaded (missing artifact/spaCy), so callers fail loudly instead of
        silently searching with empty vectors.
        """
        if self._nlp is None:
            raise MissingEmbeddingModelError(
                f"Pinned embedding model {self.model_version} is not available "
                "at runtime; run `python scripts/fetch_embedding_model.py`."
            )
        if not text or not text.strip():
            return [0.0] * self._cfg.dimension

        # Long articles are truncated so vectorisation stays within a bounded
        # word budget while preserving the headline + lead of the article.
        clipped = text.strip()[:100000]
        doc = self._nlp(clipped)
        return normalize_vector(doc.vector.tolist())

    def embed_article(
        self,
        title: Optional[str] = None,
        summary: Optional[str] = None,
        content: Optional[str] = None,
    ) -> List[float]:
        """Encode the concatenated article fields into a single vector."""
        return self.embed(article_text(title=title, summary=summary, content=content))
