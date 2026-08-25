"""
Named Entity Recognition service for news tagging.

Uses spaCy for entity extraction and includes crypto-specific patterns so
LumenPulse ecosystem entities are detected consistently.

Model: en_core_web_sm 3.7.1
Licence: MIT (https://github.com/explosion/spacy-models/blob/master/LICENSE)
Source: https://github.com/explosion/spacy-models/releases/tag/en_core_web_sm-3.7.1

The model artifact is fetched at image **build** time (see Dockerfile) and is
therefore available without any outbound network access at container start.
"""

from __future__ import annotations

import logging
import re
from functools import lru_cache
from typing import Any, Dict, List, Optional

try:
    import spacy
except ImportError:  # pragma: no cover - exercised in minimal test envs
    spacy = None

from .keywords import CRYPTO_PROJECT_MAP, KNOWN_TICKERS

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Pinned model identity
# ---------------------------------------------------------------------------
# Bump ONLY via a deliberate commit that also updates the Dockerfile RUN step
# and this file's module docstring.
NER_MODEL_NAME = "en_core_web_sm"
NER_MODEL_VERSION = "3.7.1"
NER_MODEL_FULL = f"{NER_MODEL_NAME}-{NER_MODEL_VERSION}"


class ModelVersionError(RuntimeError):
    """Raised when the loaded spaCy model does not match the pinned version."""


class NERService:
    """Extract entities from news text for downstream filtering and tagging."""

    _PERSON_PATTERN = re.compile(
        r"\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)+)\b"
    )
    _TICKER_PATTERN = re.compile(r"(?:\$)?\b([A-Z]{2,6})\b")
    _PERSON_PREFIX_EXCLUSIONS = {"The", "This", "That", "New"}

    def __init__(self) -> None:
        self._canonical_names = self._build_canonical_name_map()
        self._known_tickers = {ticker.upper() for ticker in KNOWN_TICKERS}
        self._nlp = self._initialize_pipeline()

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

    # ------------------------------------------------------------------
    # Startup version guard
    # ------------------------------------------------------------------

    @staticmethod
    def _check_model_version(nlp: Any) -> None:
        """Raise ModelVersionError if *nlp* does not match the pinned version.

        The check inspects the ``meta`` dict that every spaCy model exposes.
        If the meta is absent (e.g. a blank pipeline) the check is skipped so
        that unit tests using ``spacy.blank("en")`` still work.
        """
        if nlp is None:
            return

        meta = getattr(nlp, "meta", {})
        if not meta:
            # Blank pipeline created as a fallback — no version to check.
            return

        loaded_name = meta.get("name", "")
        loaded_version = meta.get("version", "")
        loaded_full = f"{loaded_name}-{loaded_version}"

        if loaded_name != NER_MODEL_NAME or loaded_version != NER_MODEL_VERSION:
            raise ModelVersionError(
                f"Expected spaCy model '{NER_MODEL_FULL}' but found "
                f"'{loaded_full}'. "
                "Update NER_MODEL_VERSION and rebuild the Docker image."
            )

        logger.info(
            "spaCy model version check passed: %s", loaded_full
        )

    # ------------------------------------------------------------------
    # Pipeline initialisation
    # ------------------------------------------------------------------

    def _initialize_pipeline(self) -> Optional[Any]:
        if spacy is None:
            logger.warning(
                "spaCy is not installed; using regex-only entity extraction fallback"
            )
            return None

        nlp: Optional[Any] = None

        # Try the exact pinned name first, then the bare name as a fallback so
        # that local development environments that installed the model without
        # the version suffix still work.
        for model_name in (NER_MODEL_FULL, NER_MODEL_NAME):
            try:
                nlp = spacy.load(
                    model_name, disable=["parser", "lemmatizer", "textcat"]
                )
                logger.info("Initialized spaCy model for NER: %s", model_name)
                break
            except OSError:
                continue

        if nlp is None:
            # No pretrained model found — use a blank pipeline so the service
            # still starts, but log a prominent warning.
            nlp = spacy.blank("en")
            logger.warning(
                "spaCy pretrained model '%s' not found; using blank English "
                "pipeline with custom entity rules. "
                "Ensure the model was downloaded at image build time.",
                NER_MODEL_FULL,
            )

        # Fail fast if the loaded model is not the pinned version.
        self._check_model_version(nlp)

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
