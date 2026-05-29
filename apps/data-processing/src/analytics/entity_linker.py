"""
On-chain Entity Linker for news articles.
Links news content to on-chain projects and assets, producing stable IDs
and storing links in the database.
"""

import logging
import re
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass

from .keywords import CRYPTO_PROJECT_MAP, KNOWN_TICKERS, TICKER_TO_PROJECT

logger = logging.getLogger(__name__)


@dataclass
class LinkedEntity:
    stable_id: str
    entity_type: str  # "project" or "asset"
    name: str
    ticker: Optional[str] = None
    confidence: float = 1.0


class EntityLinker:
    """
    Links text content to known on-chain entities (projects and assets)
    with stable, deterministic IDs.
    """

    def __init__(self) -> None:
        self._project_patterns = self._compile_project_patterns()
        # Filter out SDF from asset tickers since it's a project
        self._asset_tickers = {t for t in KNOWN_TICKERS if t not in ["SDF"]}

    def _compile_project_patterns(self) -> List[Tuple[str, re.Pattern]]:
        """Compile regex patterns for project name matching, sorted by length descending."""
        patterns = []
        # Sort project names by length descending to prefer longer matches
        sorted_projects = sorted(
            CRYPTO_PROJECT_MAP.keys(),
            key=lambda x: len(x),
            reverse=True
        )
        for project_name in sorted_projects:
            pattern = re.compile(r"\b" + re.escape(project_name) + r"\b", re.IGNORECASE)
            patterns.append((project_name, pattern))
        return patterns

    def _generate_stable_id(self, entity_type: str, identifier: str) -> str:
        """Generate a stable, deterministic ID for an entity."""
        normalized = identifier.strip().lower()
        return f"{entity_type}:{normalized}"

    def link_text(
        self,
        text: str,
        title: Optional[str] = None
    ) -> List[LinkedEntity]:
        """
        Link the given text to known on-chain entities.
        
        Args:
            text: Main text content to analyze
            title: Optional article title (higher weight for entities found here)
        
        Returns:
            List of LinkedEntity objects with stable IDs
        """
        entities: Dict[str, LinkedEntity] = {}
        
        # Combine title and text for analysis, title first for priority
        full_text = f"{title or ''}\n{text or ''}"
        
        # Match project names
        for project_name, pattern in self._project_patterns:
            if pattern.search(full_text):
                # Get canonical project name (the last one in the list)
                canonical_name = CRYPTO_PROJECT_MAP[project_name][-1] if CRYPTO_PROJECT_MAP[project_name] else project_name
                canonical_stable_id = self._generate_stable_id("project", canonical_name.lower())
                
                if canonical_stable_id not in entities:
                    entities[canonical_stable_id] = LinkedEntity(
                        stable_id=canonical_stable_id,
                        entity_type="project",
                        name=canonical_name,
                        confidence=0.95
                    )

        # Match tickers
        ticker_pattern = re.compile(r"\b([A-Z]{2,6})\b")
        for ticker in ticker_pattern.findall(full_text):
            ticker = ticker.upper()
            if ticker in self._asset_tickers:
                stable_id = self._generate_stable_id("asset", ticker)
                if stable_id not in entities:
                    entities[stable_id] = LinkedEntity(
                        stable_id=stable_id,
                        entity_type="asset",
                        name=ticker,
                        ticker=ticker,
                        confidence=0.9
                    )
                # Also link the associated project if available, using canonical ID
                if ticker in TICKER_TO_PROJECT:
                    for project_name in TICKER_TO_PROJECT[ticker]:
                        # Get canonical project name
                        canonical_name = CRYPTO_PROJECT_MAP.get(project_name.lower(), [project_name])[-1]
                        canonical_stable_id = self._generate_stable_id("project", canonical_name.lower())
                        if canonical_stable_id not in entities:
                            entities[canonical_stable_id] = LinkedEntity(
                                stable_id=canonical_stable_id,
                                entity_type="project",
                                name=canonical_name,
                                confidence=0.85
                            )

        return list(entities.values())

    def link_article(
        self,
        title: Optional[str],
        summary: Optional[str],
        content: Optional[str]
    ) -> List[LinkedEntity]:
        """Link an article's content to on-chain entities."""
        combined_text = "\n".join([
            title or "",
            summary or "",
            content or ""
        ])
        return self.link_text(combined_text, title)


# Small labeled test set for precision measurement
LABELED_TEST_SET = [
    {
        "text": "Stellar Development Foundation (SDF) announces new Soroban upgrade. XLM price surges.",
        "expected_entities": [
            {"stable_id": "project:stellar", "type": "project"},
            {"stable_id": "project:soroban", "type": "project"},
            {"stable_id": "asset:xlm", "type": "asset"}
        ]
    },
    {
        "text": "Bitcoin (BTC) reaches new all-time high. Ethereum (ETH) follows closely.",
        "expected_entities": [
            {"stable_id": "asset:btc", "type": "asset"},
            {"stable_id": "asset:eth", "type": "asset"}
        ]
    },
    {
        "text": "DeFi protocol Uniswap launches new liquidity pool on Solana.",
        "expected_entities": [
            {"stable_id": "project:uniswap", "type": "project"},
            {"stable_id": "asset:sol", "type": "asset"}
        ]
    },
    {
        "text": "Cardano (ADA) releases new roadmap for governance.",
        "expected_entities": [
            {"stable_id": "asset:ada", "type": "asset"}
        ]
    },
    {
        "text": "Tech stocks rally on positive earnings. Apple and Microsoft lead gains.",
        "expected_entities": []  # No crypto entities
    }
]


def measure_precision(entity_linker: EntityLinker) -> Dict[str, float]:
    """
    Measure precision of the entity linker using the labeled test set.
    
    Returns:
        Dictionary with precision metrics
    """
    true_positives = 0
    false_positives = 0
    total_expected = 0

    for test_case in LABELED_TEST_SET:
        text = test_case["text"]
        expected = test_case["expected_entities"]
        total_expected += len(expected)

        actual = entity_linker.link_text(text)
        actual_stable_ids = {e.stable_id for e in actual}
        expected_stable_ids = {e["stable_id"] for e in expected}

        # Calculate true positives and false positives
        for entity in actual:
            if entity.stable_id in expected_stable_ids:
                true_positives += 1
            else:
                false_positives += 1

    precision = true_positives / (true_positives + false_positives) if (true_positives + false_positives) > 0 else 1.0
    recall = true_positives / total_expected if total_expected > 0 else 1.0
    f1 = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0

    return {
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "true_positives": true_positives,
        "false_positives": false_positives,
        "total_expected": total_expected,
        "test_cases": len(LABELED_TEST_SET)
    }
