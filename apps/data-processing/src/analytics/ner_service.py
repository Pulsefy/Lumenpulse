"""
Named Entity Recognition service for news tagging.

Uses spaCy for entity extraction and includes crypto-specific patterns so
LumenPulse ecosystem entities are detected consistently.

The underlying spaCy model is ``pinned and vendored`` so that:

* Entity-extraction behaviour cannot change without a commit to this repo
  (the model is never resolved to a floating "latest" at runtime).
* The artifact is fetched at image build time, not at container start (see
  ``scripts/fetch_ner_model.py`` and the Dockerfile), so the service starts
  with no outbound network access for model resolution.
* A startup check verifies the expected model version is present and fails
  fast otherwise (see :func:`check_model_available` and the ``--check-models``
  CLI flag in ``src/main.py``).
"""

from __future__ import annotations

import json
import logging
import os
import re
from functools import lru_cache
from typing import Any, Dict, List, Optional

try:
    import spacy
except ImportError:  # pragma: no cover - exercised in minimal test envs
    spacy = None

from ..config.ner_config import NERConfig
from .keywords import CRYPTO_PROJECT_MAP, KNOWN_TICKERS

logger = logging.getLogger(__name__)

_NER_MODEL_META_FILENAME = "meta.json"


def _pinned_model_meta(cfg: NERConfig) -> Optional[Dict[str, Any]]:
    """Read the meta of the vendored model, or None if unavailable/broken."""
    meta_path = os.path.join(cfg.model_dir, _NER_MODEL_META_FILENAME)
    if not os.path.isfile(meta_path):
        return None
    try:
        with open(meta_path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def check_model_available(cfg: Optional[NERConfig] = None) -> None:
    """Verify the pinned NER model is present and the correct version.

    Raises :class:`MissingNERModelError` if the model is missing or does not
    match the pinned version, so callers can fail fast at startup before doing
    any real work.

    :param cfg: NER config override (defaults to pinned committed defaults).
    """
    cfg = cfg or NERConfig.from_env()

    meta = _pinned_model_meta(cfg)
    expected = cfg.shipped_version_tag

    if meta is None:
        raise MissingNERModelError(
            f"No vendored NER model found at {cfg.model_dir}. Expected "
            f"{expected}. Run `python scripts/fetch_ner_model.py` and rebuild "
            "the image (the model is fetched at build time, not at runtime)."
        )

    actual = meta.get("name")
    if actual != expected:
        raise MissingNERModelError(
            f"Ner model version mismatch: expected {expected} but found "
            f"{actual!r} at {cfg.model_dir}. Rebuild the image with the pinned "
            "model (see scripts/fetch_ner_model.py)."
        )


class MissingNERModelError(RuntimeError):
    """Raised when the pinned vendored NER model is absent or mismatched."""


class NERService:
    """Extract entities from news text for downstream filtering and tagging."""

    _PERSON_PATTERN = re.compile(
        r"\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)+)\b"
    )
    _TICKER_PATTERN = re.compile(r"(?:\$)?\b([A-Z]{2,6})\b")
    _PERSON_PREFIX_EXCLUSIONS = {"The", "This", "That", "New"}

    def __init__(self, cfg: Optional[NERConfig] = None) -> None:
        self._cfg = cfg or NERConfig.from_env()
        self._canonical_names = self._build_canonical_name_map()
        self._known_tickers = {ticker.upper() for ticker in KNOWN_TICKERS}
        self._nlp = self._initialize_pipeline()

    @property
    def model_version(self) -> str:
        """Exact pinned model version served by this service."""
        return self._cfg.model_version

    def _build_canonical_name_map(self) -> Dict[str, str]:
        canonical_names: Dict[str, str] = {}

        for key, values in CRYPTO_PROJECT_MAP.items():
            if values:
                name_candidate = values[-1]
                canonical_names[key.lower()] = name_candidate
                canonical_names[name_candidate.lower()] = name_candidate

            for value in values:
                canonical_names[value.lower()] = value

        return canonical_names

    def _initialize_pipeline(self) -> Optional[Any]:
        if spacy is None:
            logger.warning(
                "spaCy is not installed; using regex-only entity extraction fallback"
            )
            return None

        # Only the exact pinned/vendored model may be loaded. If it is not
        # present we fall back to the deterministic regex/canonical-name
        # extraction, which uses no model at all, rather than silently loading
        # an unpinned or blank model. The strict "fail fast" behaviour is
        # enforced by the startup gates (scripts/fetch_ner_model.py --check-only
        # and the `check-models` / `serve` commands in src/main.py), where the
        # missing model is an error; outside the container this simply means a
        # reduced but deterministic extraction mode.
        try:
            check_model_available(self._cfg)
        except MissingNERModelError as exc:
            logger.warning(
                "Pinned NER model is not available (%s); using regex-only "
                "entity extraction fallback. Run `python scripts/fetch_ner_model.py` "
                "to vendor the model, or `python src/main.py check-models` to enforce it.",
                exc,
            )
            return None
        model_name = self._cfg.shipped_version_tag

        try:
            nlp = spacy.load(
                self._cfg.model_dir,
                disable=["parser", "lemmatizer", "textcat"],
            )
            logger.info("Initialized pinned spaCy model for NER: %s", model_name)
        except OSError as exc:  # pragma: no cover - defensive
            raise MissingNERModelError(
                f"Failed to load pinned NER model at {self._cfg.model_dir}: {exc}"
            ) from exc

        if "entity_ruler" in nlp.pipe_names:
            nlp.remove_pipe("entity_ruler")

        ruler_config = {"phrase_matcher_attr": "LOWER"}
        if "ner" in nlp.pipe_names:
            ruler = nlp.add_pipe("entity_ruler", before="ner", config=ruler_config)
        else:
            ruler = nlp.add_pipe("entity_ruler", config=ruler_config)

        patterns = []

        for project_name in CRYPTO_PROJECT_MAP:
            patterns.append({"label": "PROJECT", "pattern": project_name})

        for ticker in self._known_tickers:
            patterns.append({"label": "ASSET", "pattern": ticker})
            patterns.append({"label": "ASSET", "pattern": f"${ticker}"})

        ruler.add_patterns(patterns)

        if "sentencizer" not in nlp.pipe_names:
            nlp.add_pipe("sentencizer")

        return nlp

    def _normalize_entity(self, value: str) -> Optional[str]:
        cleaned = value.strip(" \n\t.,:;()[]{}\"'`")
        if len(cleaned) < 2:
            return None

        ticker_candidate = cleaned.lstrip("$")
        if ticker_candidate.isupper() and ticker_candidate in self._known_tickers:
            return ticker_candidate

        normalized_lookup = cleaned.lower()
        if normalized_lookup in self._canonical_names:
            return self._canonical_names[normalized_lookup]

        return cleaned

    @lru_cache(maxsize=4096)
    def extract_entities(self, text: str) -> List[str]:
        """
        Extract entities from text.

        Returns a deduplicated list containing projects, assets, and people.
        """
        if not text or not text.strip():
            return []

        if len(text) > 20000:
            text = text[:20000]

        candidates: List[str] = []
        doc = self._nlp(text) if self._nlp is not None else None

        if doc is not None:
            for ent in doc.ents:
                if ent.label_ in {
                    "PERSON",
                    "ORG",
                    "PRODUCT",
                    "NORP",
                    "GPE",
                    "EVENT",
                    "PROJECT",
                    "ASSET",
                }:
                    candidates.append(ent.text)

        for alias in sorted(self._canonical_names, key=len, reverse=True):
            if len(alias) < 3:
                continue
            pattern = r"(?<![\w$])" + re.escape(alias) + r"(?![\w-])"
            if re.search(pattern, text, flags=re.IGNORECASE):
                candidates.append(self._canonical_names[alias])

        # Heuristic for names when running without a pretrained NER model.
        for match in self._PERSON_PATTERN.findall(text):
            first_word = match.split()[0]
            if first_word in self._PERSON_PREFIX_EXCLUSIONS:
                continue
            if any(part.isupper() for part in match.split()):
                continue
            candidates.append(match)

        # Explicit ticker extraction catches tokens that may not be tagged as entities.
        for ticker in self._TICKER_PATTERN.findall(text):
            if ticker in self._known_tickers:
                candidates.append(ticker)

        deduped: List[str] = []
        seen = set()

        for candidate in candidates:
            normalized = self._normalize_entity(candidate)
            if not normalized:
                continue

            key = normalized.lower()
            if key not in seen:
                deduped.append(normalized)
                seen.add(key)

        return deduped

    def extract_entities_from_article(
        self,
        title: Optional[str] = None,
        summary: Optional[str] = None,
        content: Optional[str] = None,
    ) -> List[str]:
        """Extract entities from combined article fields."""
        chunks = [
            value.strip()
            for value in [title or "", summary or "", content or ""]
            if value and value.strip()
        ]
        if not chunks:
            return []
        return self.extract_entities("\n".join(chunks))
