"""
Ecosystem Registry Service for Entity Linking.
"""

import logging
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session
from sqlalchemy import select, or_

# Relative imports might fail depending on execution context, using absolute-ish path
try:
    from src.db.models import EcosystemRegistry
except ImportError:
    from db.models import EcosystemRegistry

logger = logging.getLogger(__name__)

class RegistryService:
    """
    Manages known ecosystem entities and links them to extracted mentions.
    """

    def __init__(self, db_session: Optional[Session] = None):
        self.db_session = db_session
        self._static_registry = self._get_default_registry()

    def _get_default_registry(self) -> List[Dict[str, Any]]:
        """
        Default entities to use if database is empty or unavailable.
        Based on known Stellar ecosystem projects.
        """
        return [
            {
                "entity_id": "stellar",
                "name": "Stellar",
                "type": "project",
                "asset_code": "XLM",
                "aliases": ["XLM", "Stellar Lumens", "SDF"],
                "website": "https://stellar.org",
                "twitter": "@StellarOrg"
            },
            {
                "entity_id": "soroban",
                "name": "Soroban",
                "type": "ecosystem_entry",
                "category": "Smart Contracts",
                "aliases": ["Soroban"],
                "website": "https://soroban.stellar.org",
                "description": "Smart contracts platform for Stellar"
            },
            {
                "entity_id": "usdc",
                "name": "USD Coin",
                "type": "asset",
                "asset_code": "USDC",
                "aliases": ["USDC", "USD Coin"],
                "website": "https://www.centre.io/usdc"
            },
            {
                "entity_id": "bitcoin",
                "name": "Bitcoin",
                "type": "project",
                "asset_code": "BTC",
                "aliases": ["BTC", "Bitcoin"],
                "website": "https://bitcoin.org"
            },
            {
                "entity_id": "ethereum",
                "name": "Ethereum",
                "type": "project",
                "asset_code": "ETH",
                "aliases": ["ETH", "Ethereum"],
                "website": "https://ethereum.org"
            }
        ]

    def link_entities(self, mentions: List[str]) -> List[Dict[str, Any]]:
        """
        Links a list of text mentions to known ecosystem entities.
        """
        if not mentions:
            return []

        linked = []
        seen_ids = set()

        for mention in mentions:
            entity = self.find_entity(mention)
            if entity and entity["entity_id"] not in seen_ids:
                linked.append(entity)
                seen_ids.add(entity["entity_id"])

        return linked

    def find_entity(self, mention: str) -> Optional[Dict[str, Any]]:
        """
        Finds a matching entity for a single mention string.
        """
        mention_lower = mention.lower().strip()
        
        # 1. Check database if available
        if self.db_session:
            try:
                # Search by name or aliases (aliased is JSON, so we use string matching for simplicity here)
                stmt = select(EcosystemRegistry).where(
                    or_(
                        EcosystemRegistry.name.ilike(mention_lower),
                        EcosystemRegistry.asset_code.ilike(mention_lower),
                        # Simple alias check - in production use JSON functions
                    )
                )
                db_entity = self.db_session.execute(stmt).scalar_one_or_none()
                if db_entity:
                    return {
                        "entity_id": db_entity.entity_id,
                        "name": db_entity.name,
                        "type": db_entity.type,
                        "asset_code": db_entity.asset_code,
                        "website": db_entity.website,
                        "description": db_entity.description
                    }
            except Exception as e:
                logger.warning(f"Database registry lookup failed: {e}")

        # 2. Check static registry
        for entity in self._static_registry:
            if mention_lower == entity["name"].lower() or mention_lower == entity.get("asset_code", "").lower():
                return entity
            
            for alias in entity.get("aliases", []):
                if mention_lower == alias.lower():
                    return entity

        return None
