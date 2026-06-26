"""Link article text to on-chain project and asset entities."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set

from .keywords import TICKER_TO_PROJECT


@dataclass(frozen=True)
class OnchainEntityCandidate:
    """A project or asset that can be linked from article text."""

    stable_id: str
    entity_type: str
    display_name: str
    aliases: Sequence[str]
    asset_code: Optional[str] = None
    project_id: Optional[int] = None
    contract_id: Optional[str] = None


@dataclass(frozen=True)
class OnchainEntityLink:
    """A stable article-to-entity link produced by the linker."""

    stable_id: str
    entity_type: str
    display_name: str
    matched_text: str
    confidence: float
    source: str
    asset_code: Optional[str] = None
    project_id: Optional[int] = None
    contract_id: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Serialize for DB JSON fields and API responses."""
        return {
            "stable_id": self.stable_id,
            "entity_type": self.entity_type,
            "display_name": self.display_name,
            "matched_text": self.matched_text,
            "confidence": self.confidence,
            "source": self.source,
            "asset_code": self.asset_code,
            "project_id": self.project_id,
            "contract_id": self.contract_id,
        }


class OnchainEntityLinker:
    """Deterministic linker for testnet projects/assets mentioned in news."""

    DEFAULT_ASSETS: Sequence[OnchainEntityCandidate] = tuple(
        OnchainEntityCandidate(
            stable_id=f"asset:{asset_code}",
            entity_type="asset",
            display_name=project_names[0],
            aliases=tuple({asset_code, *project_names}),
            asset_code=asset_code,
        )
        for asset_code, project_names in sorted(TICKER_TO_PROJECT.items())
    )

    def __init__(
        self,
        candidates: Optional[Sequence[OnchainEntityCandidate]] = None,
    ) -> None:
        self.candidates = self._dedupe_candidates(
            list(candidates or []) + list(self.DEFAULT_ASSETS)
        )

    def link_text(
        self,
        text: str,
        detected_entities: Optional[Sequence[str]] = None,
    ) -> List[OnchainEntityLink]:
        """Return deterministic links found in text and existing NER entities."""
        if not text and not detected_entities:
            return []

        haystack = "\n".join(
            value for value in [text or "", " ".join(detected_entities or [])] if value
        )
        links: Dict[str, OnchainEntityLink] = {}

        for candidate in self.candidates:
            match = self._first_alias_match(haystack, candidate.aliases)
            if not match:
                continue

            confidence = 0.95 if match.lower() == candidate.display_name.lower() else 0.85
            if candidate.entity_type == "asset" and match.upper() == candidate.asset_code:
                confidence = 0.9

            links[candidate.stable_id] = OnchainEntityLink(
                stable_id=candidate.stable_id,
                entity_type=candidate.entity_type,
                display_name=candidate.display_name,
                matched_text=match,
                confidence=confidence,
                source="onchain_entity_linker_v1",
                asset_code=candidate.asset_code,
                project_id=candidate.project_id,
                contract_id=candidate.contract_id,
            )

        return sorted(links.values(), key=lambda link: link.stable_id)

    def link_article(self, article: Dict[str, Any]) -> List[OnchainEntityLink]:
        """Link an article dictionary using title, summary, content, and tags."""
        parts = [
            article.get("title"),
            article.get("summary"),
            article.get("content"),
            " ".join(article.get("keywords") or []),
            " ".join(article.get("categories") or []),
        ]
        text = "\n".join(str(part) for part in parts if part)
        return self.link_text(text, article.get("detected_entities") or [])

    def evaluate_precision(
        self,
        labeled_articles: Iterable[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Measure precision against a small labeled set of expected stable IDs."""
        true_positive = 0
        predicted = 0
        per_article: List[Dict[str, Any]] = []

        for item in labeled_articles:
            expected: Set[str] = set(item.get("expected_stable_ids") or [])
            links = self.link_article(item)
            actual = {link.stable_id for link in links}
            matches = expected & actual

            true_positive += len(matches)
            predicted += len(actual)
            per_article.append(
                {
                    "article_id": item.get("id"),
                    "expected_stable_ids": sorted(expected),
                    "predicted_stable_ids": sorted(actual),
                    "true_positive": len(matches),
                    "false_positive": len(actual - expected),
                }
            )

        precision = true_positive / predicted if predicted else 0.0
        return {
            "precision": precision,
            "true_positive": true_positive,
            "predicted": predicted,
            "article_count": len(per_article),
            "per_article": per_article,
        }

    def _first_alias_match(
        self,
        text: str,
        aliases: Sequence[str],
    ) -> Optional[str]:
        for alias in sorted(set(aliases), key=len, reverse=True):
            if not alias or len(alias.strip()) < 2:
                continue
            pattern = r"(?<![\w$])" + re.escape(alias.strip()) + r"(?![\w-])"
            match = re.search(pattern, text, flags=re.IGNORECASE)
            if match:
                return match.group(0)
        return None

    def _dedupe_candidates(
        self,
        candidates: Sequence[OnchainEntityCandidate],
    ) -> List[OnchainEntityCandidate]:
        seen: Set[str] = set()
        deduped: List[OnchainEntityCandidate] = []
        for candidate in candidates:
            if candidate.stable_id in seen:
                continue
            seen.add(candidate.stable_id)
            deduped.append(candidate)
        return deduped
