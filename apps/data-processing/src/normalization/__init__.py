"""
normalization package

Provides the alias registry and normalization utilities for consistent
entity resolution across ingestion and analytics.
"""
from .alias_registry import AliasRegistry, RegistryEntry, get_registry

__all__ = ["AliasRegistry", "RegistryEntry", "get_registry"]
