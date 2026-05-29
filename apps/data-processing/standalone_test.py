#!/usr/bin/env python3
"""
Standalone test for Entity Linker core logic
"""

import logging
import re
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


# Copy of the relevant constants from keywords.py
CRYPTO_PROJECT_MAP: dict[str, List[str]] = {
    "stellar": ["XLM", "Stellar"],
    "xlm": ["XLM", "Stellar"],
    "soroban": ["XLM", "Soroban"],
    "stellar development foundation": ["SDF", "Stellar"],
    "bitcoin": ["BTC", "Bitcoin"],
    "btc": ["BTC", "Bitcoin"],
    "ethereum": ["ETH", "Ethereum"],
    "eth": ["ETH", "Ethereum"],
    "solana": ["SOL", "Solana"],
    "sol": ["SOL", "Solana"],
    "usdc": ["USDC", "USDC"],
    "usd coin": ["USDC", "USDC"],
    "ripple": ["XRP", "Ripple"],
    "xrp": ["XRP", "XRP"],
    "cardano": ["ADA", "Cardano"],
    "ada": ["ADA", "ADA"],
    "polkadot": ["DOT", "Polkadot"],
    "dot": ["DOT", "DOT"],
    "dogecoin": ["DOGE", "Dogecoin"],
    "doge": ["DOGE", "DOGE"],
    "litecoin": ["LTC", "Litecoin"],
    "ltc": ["LTC", "LTC"],
    "chainlink": ["LINK", "Chainlink"],
    "link": ["LINK", "LINK"],
    "avalanche": ["AVAX", "Avalanche"],
    "avax": ["AVAX", "AVAX"],
    "polygon": ["MATIC", "Polygon"],
    "matic": ["MATIC", "MATIC"],
    "algorand": ["ALGO", "Algorand"],
    "algo": ["ALGO", "ALGO"],
    "cosmos": ["ATOM", "Cosmos"],
    "atom": ["ATOM", "ATOM"],
    "uniswap": ["UNI", "Uniswap"],
    "defi": ["DeFi", "DeFi"],
    "nft": ["NFT", "NFT"],
    "nfts": ["NFT", "NFT"],
}

KNOWN_TICKERS = {
    "XLM", "BTC", "ETH", "SOL", "USDC", "XRP", "ADA", "DOT", "DOGE", "LTC",
    "LINK", "AVAX", "MATIC", "ALGO", "ATOM", "UNI", "USDT", "BUSD", "BNB", "SDF"
}

TICKER_TO_PROJECT: dict[str, List[str]] = {
    "XLM": ["Stellar"],
    "BTC": ["Bitcoin"],
    "ETH": ["Ethereum"],
    "SOL": ["Solana"],
    "XRP": ["Ripple"],
    "ADA": ["Cardano"],
    "DOT": ["Polkadot"],
    "DOGE": ["Dogecoin"],
    "LTC": ["Litecoin"],
    "LINK": ["Chainlink"],
    "AVAX": ["Avalanche"],
    "MATIC": ["Polygon"],
    "ALGO": ["Algorand"],
    "ATOM": ["Cosmos"],
    "UNI": ["Uniswap"],
    "USDC": ["USDC"],
    "USDT": ["Tether"],
}


@dataclass
class LinkedEntity:
    stable_id: str
    entity_type: str  # "project" or "asset"
    name: str
    ticker: Optional[str] = None
    confidence: float = 1.0


class EntityLinker:
    def __init__(self) -> None:
        self._project_patterns = self._compile_project_patterns()
        self._asset_tickers = {t for t in KNOWN_TICKERS if t not in ["SDF"]}

    def _compile_project_patterns(self) -> List[Tuple[str, re.Pattern]]:
        patterns = []
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
        normalized = identifier.strip().lower()
        return f"{entity_type}:{normalized}"

    def link_text(
        self,
        text: str,
        title: Optional[str] = None
    ) -> List[LinkedEntity]:
        entities: Dict[str, LinkedEntity] = {}
        
        full_text = f"{title or ''}\n{text or ''}"
        
        for project_name, pattern in self._project_patterns:
            if pattern.search(full_text):
                canonical_name = CRYPTO_PROJECT_MAP[project_name][-1] if CRYPTO_PROJECT_MAP[project_name] else project_name
                canonical_stable_id = self._generate_stable_id("project", canonical_name.lower())
                
                if canonical_stable_id not in entities:
                    entities[canonical_stable_id] = LinkedEntity(
                        stable_id=canonical_stable_id,
                        entity_type="project",
                        name=canonical_name,
                        confidence=0.95
                    )

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
                if ticker in TICKER_TO_PROJECT:
                    for project_name in TICKER_TO_PROJECT[ticker]:
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
        combined_text = "\n".join([
            title or "",
            summary or "",
            content or ""
        ])
        return self.link_text(combined_text, title)


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


def test_entity_linker():
    logger.info("=" * 60)
    logger.info("Testing Entity Linker")
    logger.info("=" * 60)
    
    entity_linker = EntityLinker()
    
    test_text = "Stellar Development Foundation (SDF) announces new Soroban upgrade. XLM price surges."
    linked_entities = entity_linker.link_text(test_text)
    
    logger.info(f"\nTest text: {test_text}")
    logger.info(f"Linked entities:")
    for entity in linked_entities:
        logger.info(f"  - {entity.name} ({entity.entity_type}), stable ID: {entity.stable_id}")
    
    logger.info("\n" + "=" * 60)
    logger.info("Measuring Entity Linker Precision")
    logger.info("=" * 60)
    
    metrics = measure_precision(entity_linker)
    logger.info(f"Precision: {metrics['precision']:.4f}")
    logger.info(f"Recall: {metrics['recall']:.4f}")
    logger.info(f"F1 Score: {metrics['f1']:.4f}")
    logger.info(f"True Positives: {metrics['true_positives']}")
    logger.info(f"False Positives: {metrics['false_positives']}")
    logger.info(f"Total Expected: {metrics['total_expected']}")


if __name__ == "__main__":
    test_entity_linker()
