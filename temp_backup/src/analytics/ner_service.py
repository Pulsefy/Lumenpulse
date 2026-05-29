"""
Named Entity Recognition service for news tagging.

Uses spaCy for entity extraction and includes crypto-specific patterns so
LumenPulse ecosystem entities are detected consistently.
"""

from __future__ import annotations

import logging
import re
from functools import lru_cache
from typing import Dict, List, Optional

import spacy
from spacy.language import Language

from .keywords import CRYPTO_PROJECT_MAP, KNOWN_TICKERS

logger = logging.getLogger(__name__)


class NERService:
    """Extract entities from news text for downstream filtering and tagging."""

    _MODEL_CANDIDATES = ("en_core_web_sm", "en_core_web_md")
    _PERSON_PATTERN = re.compile(
        r"\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)+)\b"
    )
    _TICKER_PATTERN = re.compile(r"(?:\$)?\b([A-Z]{2,6})\b")

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

    def _initialize_pipeline(self) -> Language:
        nlp: Optional[Language] = None

        for model_name in self._MODEL_CANDIDATES:
            try:
                nlp = spacy.load(model_name, disable=["parser", "lemmatizer", "textcat"])
                logger.info("Initialized spaCy model for NER: %s", model_name)
                break
            except OSError:
                continue

        if nlp is None:
            nlp = spacy.blank("en")
            logger.warning(
                "spaCy pretrained model not found; using blank English pipeline with custom entity rules"
            )

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
        doc = self._nlp(text)

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

        # Heuristic for names when running without a pretrained NER model.
        for match in self._PERSON_PATTERN.findall(text):
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
        chunks = [value.strip() for value in [title or "", summary or "", content or ""] if value and value.strip()]
        if not chunks:
            return []
        return self.extract_entities("\n".join(chunks))
