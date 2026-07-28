"""
alias_registry.py

Maintainable alias registry for projects, assets, and ecosystem terms.

This module is the single authoritative source for canonical entity names
used throughout ingestion and analytics.  The registry is driven by a
human-editable YAML file (``data/alias_registry.yaml``) so contributors can
add or update aliases **without modifying any pipeline code**.

Public API
----------
``RegistryEntry``
    Immutable dataclass representing one canonical entity and all its aliases.

``AliasRegistry``
    Loaded registry with O(1) alias-to-canonical lookups and helpers that
    integrate with ``stellar_asset_id``, ``keywords``, and
    ``onchain_entity_linker``.

``get_registry(path=None)``
    Module-level singleton accessor.  Returns the default registry (loaded
    from ``data/alias_registry.yaml``) on first call; subsequent calls return
    the cached instance.  Pass an explicit *path* to load a different file
    (useful in tests).

Usage example
-------------
>>> from src.normalization import get_registry
>>> reg = get_registry()
>>> reg.normalize("USD Coin")
'USDC'
>>> reg.normalize("soroban")
'soroban'
>>> entry = reg.get("XLM")
>>> entry.display_name
'Stellar Lumens'
>>> reg.to_ticker_to_project()
{'XLM': ['Stellar Lumens', 'Lumens', ...], ...}
"""

from __future__ import annotations

import logging
import os
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

#: Entity type labels that the registry understands.
ENTITY_TYPE_ASSET = "asset"
ENTITY_TYPE_PROJECT = "project"
ENTITY_TYPE_ECOSYSTEM_TERM = "ecosystem_term"

VALID_ENTITY_TYPES = frozenset(
    [ENTITY_TYPE_ASSET, ENTITY_TYPE_PROJECT, ENTITY_TYPE_ECOSYSTEM_TERM]
)

#: Default path to the YAML registry file relative to the repo root.
_DEFAULT_REGISTRY_PATH = Path(__file__).parent.parent.parent / "data" / "alias_registry.yaml"


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RegistryEntry:
    """
    Immutable representation of one canonical entity in the registry.

    Attributes
    ----------
    canonical:
        The stable, unique identifier used in DB and API responses.
        e.g. ``"USDC"``, ``"stellar"``, ``"defi"``
    entity_type:
        One of ``"asset"``, ``"project"``, ``"ecosystem_term"``.
    display_name:
        Short human-readable label suitable for UI and legacy DB columns.
    aliases:
        Tuple of all alternative names / spellings for this entity
        (case-insensitive at lookup time).
    stable_id:
        Stable entity ID in the ``"<entity_type>:<canonical>"`` format.
        Used by ``OnchainEntityLinker``.
    asset_code:
        Upper-cased Stellar asset code.  ``None`` for non-asset entries.
    asset_issuer:
        Stellar issuer account ID.  ``None`` for native XLM or non-assets.
    """

    canonical: str
    entity_type: str
    display_name: str
    aliases: tuple  # tuple[str, ...]
    stable_id: str = ""
    asset_code: Optional[str] = None
    asset_issuer: Optional[str] = None

    def __post_init__(self) -> None:
        if self.entity_type not in VALID_ENTITY_TYPES:
            raise ValueError(
                f"Invalid entity_type '{self.entity_type}' for '{self.canonical}'. "
                f"Must be one of {sorted(VALID_ENTITY_TYPES)}"
            )
        if not self.canonical:
            raise ValueError("canonical must not be empty")
        if not self.display_name:
            raise ValueError(f"display_name must not be empty for '{self.canonical}'")

    def all_names(self) -> List[str]:
        """Return the canonical name plus all aliases as a single deduplicated list."""
        seen: set = set()
        result: List[str] = []
        for name in (self.canonical, *self.aliases):
            key = name.lower()
            if key not in seen:
                seen.add(key)
                result.append(name)
        return result

    @property
    def is_asset(self) -> bool:
        return self.entity_type == ENTITY_TYPE_ASSET

    @property
    def is_project(self) -> bool:
        return self.entity_type == ENTITY_TYPE_PROJECT

    @property
    def is_ecosystem_term(self) -> bool:
        return self.entity_type == ENTITY_TYPE_ECOSYSTEM_TERM


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------


class AliasRegistry:
    """
    In-memory alias registry loaded from a YAML configuration file.

    The registry is immutable after loading.  To incorporate changes to
    ``alias_registry.yaml``, instantiate a new ``AliasRegistry`` or call
    ``get_registry(force_reload=True)`` to refresh the module singleton.

    Thread safety
    -------------
    Lookups are read-only and therefore fully thread-safe.  The only mutable
    state lives in the module-level ``_registry_lock`` / ``_registry_instance``
    variables used by ``get_registry()``.
    """

    def __init__(self, entries: Iterable[RegistryEntry]) -> None:
        self._entries: Dict[str, RegistryEntry] = {}      # canonical → entry
        self._alias_index: Dict[str, str] = {}             # lower(alias) → canonical

        for entry in entries:
            if entry.canonical in self._entries:
                raise ValueError(
                    f"Duplicate canonical value '{entry.canonical}' in alias registry"
                )
            self._entries[entry.canonical] = entry

            # Index every alias (and the canonical itself) for lookup
            for name in entry.all_names():
                key = name.lower().strip()
                if not key:
                    continue
                existing = self._alias_index.get(key)
                if existing and existing != entry.canonical:
                    logger.warning(
                        "Alias '%s' is mapped to both '%s' and '%s' in the registry; "
                        "keeping first mapping ('%s')",
                        name,
                        existing,
                        entry.canonical,
                        existing,
                    )
                else:
                    self._alias_index[key] = entry.canonical

        logger.debug(
            "AliasRegistry loaded: %d entries, %d alias keys",
            len(self._entries),
            len(self._alias_index),
        )

    # ------------------------------------------------------------------
    # Core lookup API
    # ------------------------------------------------------------------

    def normalize(self, name: str) -> Optional[str]:
        """
        Resolve an alias or canonical name to its canonical form.

        Parameters
        ----------
        name:
            Any known alias or canonical value (case-insensitive).

        Returns
        -------
        str | None
            The canonical value if *name* is found, ``None`` otherwise.
        """
        if not name:
            return None
        return self._alias_index.get(name.lower().strip())

    def normalize_or_passthrough(self, name: str) -> str:
        """
        Like :meth:`normalize` but returns *name* unchanged when not found.

        Useful in contexts where unknown values should pass through as-is
        rather than being silently dropped.
        """
        canonical = self.normalize(name)
        return canonical if canonical is not None else name

    def get(self, canonical: str) -> Optional[RegistryEntry]:
        """Return the :class:`RegistryEntry` for a canonical value, or ``None``."""
        return self._entries.get(canonical)

    def get_by_alias(self, name: str) -> Optional[RegistryEntry]:
        """
        Return the :class:`RegistryEntry` that owns *name* as an alias.

        Parameters
        ----------
        name:
            Any known alias or canonical value (case-insensitive).

        Returns
        -------
        RegistryEntry | None
        """
        canonical = self.normalize(name)
        if canonical is None:
            return None
        return self._entries.get(canonical)

    def is_known(self, name: str) -> bool:
        """Return ``True`` if *name* (any case) appears in the registry."""
        return self.normalize(name) is not None

    # ------------------------------------------------------------------
    # Filtered views
    # ------------------------------------------------------------------

    def entries_by_type(self, entity_type: str) -> List[RegistryEntry]:
        """Return all entries of the given entity type."""
        return [e for e in self._entries.values() if e.entity_type == entity_type]

    @property
    def assets(self) -> List[RegistryEntry]:
        """All asset entries."""
        return self.entries_by_type(ENTITY_TYPE_ASSET)

    @property
    def projects(self) -> List[RegistryEntry]:
        """All project entries."""
        return self.entries_by_type(ENTITY_TYPE_PROJECT)

    @property
    def ecosystem_terms(self) -> List[RegistryEntry]:
        """All ecosystem-term entries."""
        return self.entries_by_type(ENTITY_TYPE_ECOSYSTEM_TERM)

    # ------------------------------------------------------------------
    # Integration helpers
    # ------------------------------------------------------------------

    def to_ticker_to_project(self) -> Dict[str, List[str]]:
        """
        Build a ``TICKER_TO_PROJECT``-compatible dict for use in
        ``keywords.py`` and ``ner_service.py``.

        Returns
        -------
        dict[str, list[str]]
            ``{ "XLM": ["Stellar Lumens", "Stellar", ...], ... }``
        """
        result: Dict[str, List[str]] = {}
        for entry in self.assets:
            if not entry.asset_code:
                continue
            # Build a deduplicated names list: display_name first, then aliases
            names: List[str] = [entry.display_name]
            for alias in entry.aliases:
                if alias not in names:
                    names.append(alias)
            result[entry.asset_code] = names
        return result

    def to_crypto_project_map(self) -> Dict[str, List[str]]:
        """
        Build a ``CRYPTO_PROJECT_MAP``-compatible dict for ``keywords.py``.

        Returns
        -------
        dict[str, list[str]]
            Keys are lower-cased alias strings; values are lists of tickers
            and project names associated with that alias.
        """
        result: Dict[str, List[str]] = {}
        for entry in self._entries.values():
            # Determine what tokens to emit for this entry
            tokens: List[str] = []
            if entry.asset_code:
                tokens.append(entry.asset_code)
            tokens.append(entry.display_name)

            for name in entry.all_names():
                key = name.lower().strip()
                if key:
                    if key not in result:
                        result[key] = list(tokens)
                    else:
                        # Merge without duplicates
                        for t in tokens:
                            if t not in result[key]:
                                result[key].append(t)
        return result

    def to_onchain_entity_candidates(self) -> List[Any]:
        """
        Build ``OnchainEntityCandidate`` instances for every asset and project
        entry, suitable for passing to ``OnchainEntityLinker``.

        This method imports ``OnchainEntityCandidate`` lazily to avoid circular
        imports.

        Returns
        -------
        list[OnchainEntityCandidate]
        """
        from src.analytics.onchain_entity_linker import OnchainEntityCandidate  # noqa: PLC0415

        candidates: List[OnchainEntityCandidate] = []
        for entry in self._entries.values():
            if entry.entity_type == ENTITY_TYPE_ECOSYSTEM_TERM:
                continue  # ecosystem terms are not entity-linked

            candidates.append(
                OnchainEntityCandidate(
                    stable_id=entry.stable_id,
                    entity_type=entry.entity_type,
                    display_name=entry.display_name,
                    aliases=tuple(entry.all_names()),
                    asset_code=entry.asset_code,
                )
            )
        return candidates

    def normalize_asset_codes(self, codes: Sequence[str]) -> List[str]:
        """
        Normalize a list of asset code strings to their canonical forms.

        Unknown codes are returned as-is (upper-cased) so downstream
        consumers are never silently empty.

        Parameters
        ----------
        codes:
            Raw asset code strings from ingestion.

        Returns
        -------
        list[str]
            Canonical asset code for each input.
        """
        result: List[str] = []
        for code in codes:
            if not code:
                continue
            canonical = self.normalize(code)
            if canonical:
                entry = self._entries.get(canonical)
                if entry and entry.asset_code:
                    result.append(entry.asset_code)
                    continue
            # Unknown code: upper-case and pass through
            result.append(code.strip().upper())
        return result

    # ------------------------------------------------------------------
    # Introspection helpers
    # ------------------------------------------------------------------

    def __len__(self) -> int:
        return len(self._entries)

    def __contains__(self, name: object) -> bool:
        if not isinstance(name, str):
            return False
        return self.is_known(name)

    def __repr__(self) -> str:
        return f"AliasRegistry(entries={len(self._entries)}, alias_keys={len(self._alias_index)})"


# ---------------------------------------------------------------------------
# YAML loader
# ---------------------------------------------------------------------------


def _load_yaml(path: Path) -> List[dict]:
    """Load and parse the YAML file, returning raw entry dicts."""
    try:
        import yaml  # type: ignore[import-untyped]
    except ImportError as exc:
        raise ImportError(
            "PyYAML is required for the alias registry. "
            "Install it with: pip install pyyaml"
        ) from exc

    with open(path, encoding="utf-8") as fh:
        data = yaml.safe_load(fh)

    if not isinstance(data, dict):
        raise ValueError(f"alias_registry.yaml must be a YAML mapping, got {type(data)}")

    schema_version = data.get("schema_version")
    if schema_version != 1:
        raise ValueError(
            f"Unsupported alias_registry.yaml schema_version: {schema_version!r}. "
            "Expected 1."
        )

    entries = data.get("entries")
    if not isinstance(entries, list):
        raise ValueError("alias_registry.yaml must contain an 'entries' list")

    return entries


def _build_entry(raw: dict) -> RegistryEntry:
    """Convert a raw YAML dict to a :class:`RegistryEntry`."""
    canonical: str = str(raw.get("canonical", "")).strip()
    entity_type: str = str(raw.get("entity_type", "")).strip()
    display_name: str = str(raw.get("display_name", "")).strip()
    aliases_raw = raw.get("aliases") or []
    aliases: tuple = tuple(str(a) for a in aliases_raw if a is not None)

    asset_code_raw = raw.get("asset_code")
    asset_code: Optional[str] = (
        asset_code_raw.strip().upper() if asset_code_raw else None
    )
    asset_issuer_raw = raw.get("asset_issuer")
    asset_issuer: Optional[str] = (
        asset_issuer_raw.strip() if asset_issuer_raw else None
    )

    # Use explicit stable_id if provided; otherwise auto-generate
    stable_id_raw = raw.get("stable_id")
    if stable_id_raw:
        stable_id = str(stable_id_raw).strip()
    elif entity_type == ENTITY_TYPE_ASSET:
        stable_id = f"asset:{canonical}"
    elif entity_type == ENTITY_TYPE_PROJECT:
        stable_id = f"project:{canonical}"
    else:
        stable_id = f"{entity_type}:{canonical}"

    return RegistryEntry(
        canonical=canonical,
        entity_type=entity_type,
        display_name=display_name,
        aliases=aliases,
        stable_id=stable_id,
        asset_code=asset_code,
        asset_issuer=asset_issuer,
    )


def load_registry(path: Optional[Path] = None) -> AliasRegistry:
    """
    Load and return a new :class:`AliasRegistry` from *path*.

    Parameters
    ----------
    path:
        Filesystem path to the YAML registry file.  Defaults to
        ``data/alias_registry.yaml`` relative to the repo root.
    """
    resolved = Path(path) if path else _DEFAULT_REGISTRY_PATH
    logger.info("Loading alias registry from %s", resolved)
    raw_entries = _load_yaml(resolved)
    entries = [_build_entry(raw) for raw in raw_entries]
    return AliasRegistry(entries)


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_registry_instance: Optional[AliasRegistry] = None
_registry_lock = threading.Lock()


def get_registry(
    path: Optional[Path] = None,
    *,
    force_reload: bool = False,
) -> AliasRegistry:
    """
    Return the shared :class:`AliasRegistry` singleton.

    The registry is loaded once from ``data/alias_registry.yaml`` and cached
    for the lifetime of the process.  Call with ``force_reload=True`` to
    reload from disk (e.g. after a hot-swap of the YAML file in tests or
    long-running services).

    Parameters
    ----------
    path:
        Optional override path to the YAML file.  If given, the singleton is
        replaced by a new registry loaded from this path.
    force_reload:
        If ``True``, discard the cached instance and reload from disk.
    """
    global _registry_instance

    if _registry_instance is None or force_reload or path is not None:
        with _registry_lock:
            # Double-checked locking pattern
            if _registry_instance is None or force_reload or path is not None:
                _registry_instance = load_registry(path)

    return _registry_instance
