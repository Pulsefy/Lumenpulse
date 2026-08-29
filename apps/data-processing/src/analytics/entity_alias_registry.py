"""
Entity alias registry (#1063).

Projects, assets and ecosystem terms show up in ingested text under many
spellings -- ``XLM``, ``$XLM``, ``lumens``, ``Stellar Lumens`` -- and the
pipeline previously carried a separate hand-written mapping in every module
that needed one.  This module centralises those mappings so a contributor can
teach the whole pipeline a new alias by editing one YAML file.

Data source
-----------
``config/entity_aliases.yaml`` (override with ``ENTITY_ALIAS_REGISTRY_PATH``).
If the file or PyYAML is unavailable the registry falls back to a built-in seed
derived from :mod:`src.analytics.keywords`, so importing this module never
breaks a minimal environment.

Concepts
--------
canonical entity
    One real-world thing, identified by a stable ``canonical_id`` such as
    ``asset:XLM``.  This is the join key downstream datasets should group on.
alias
    Any spelling that resolves to a canonical entity.  Matching is
    case-insensitive, ignores a leading ``$`` and tolerates
    punctuation/whitespace differences.
surface form
    The label used when *tagging text*.  For assets this is the asset code
    (``XLM``) when the matched alias was the code itself, otherwise the
    canonical ``display_name`` (``Stellar``).  Keeping both means tagging stays
    readable while identity resolution stays exact.

Usage
-----
>>> registry = get_registry()
>>> registry.resolve("$xlm").canonical_id
'asset:XLM'
>>> registry.resolve("Stellar Lumens").canonical_id
'asset:XLM'
>>> registry.canonical_id_for("lumens")
'asset:XLM'
>>> registry.surface_form("stellar lumens")
'Stellar'
"""

from __future__ import annotations

import logging
import os
import re
import threading
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)

REGISTRY_PATH_ENV_VAR = "ENTITY_ALIAS_REGISTRY_PATH"

DEFAULT_REGISTRY_PATH = os.path.normpath(
    os.path.join(
        os.path.dirname(__file__), "..", "..", "config", "entity_aliases.yaml"
    )
)

VALID_ENTITY_TYPES = frozenset(
    {"asset", "project", "organization", "ecosystem", "contributor"}
)

#: Aliases shorter than this are not searched for in free text; they still
#: resolve through the explicit lookup helpers.
MIN_TEXT_MATCH_ALIAS_LENGTH = 3

_CANONICAL_ID_PATTERN = re.compile(r"^[a-z][a-z0-9_]*:[A-Za-z0-9][A-Za-z0-9._\-]*$")
_WHITESPACE_PATTERN = re.compile(r"\s+")
_NON_ALNUM_PATTERN = re.compile(r"[^a-z0-9]+")
_STRIP_CHARS = " \n\t\r.,:;!?()[]{}\"'`"


class EntityAliasRegistryError(ValueError):
    """Raised when the alias registry definition is structurally invalid."""


class AliasConflictError(EntityAliasRegistryError):
    """Raised when two canonical entities claim the same alias."""


def normalize_alias(value: str) -> str:
    """
    Reduce an alias or a raw mention to its lookup key.

    Lowercases, drops surrounding punctuation, drops a leading ``$`` ticker
    sigil and collapses internal whitespace.

    >>> normalize_alias("  $XLM. ")
    'xlm'
    >>> normalize_alias("Stellar   Development  Foundation")
    'stellar development foundation'
    """
    if not value:
        return ""
    cleaned = str(value).strip(_STRIP_CHARS).lstrip("$").strip(_STRIP_CHARS)
    cleaned = _WHITESPACE_PATTERN.sub(" ", cleaned)
    return cleaned.lower()


def _loose_key(value: str) -> str:
    """
    Punctuation-insensitive lookup key.

    Lets ``pulse-project-1``, ``pulse project 1`` and ``PulseProject1`` share
    one entry without every variant being spelled out in the YAML.

    >>> _loose_key("non-fungible token")
    'nonfungibletoken'
    """
    return _NON_ALNUM_PATTERN.sub("", normalize_alias(value))


@dataclass(frozen=True)
class CanonicalEntity:
    """One canonical entity and every alias that resolves to it."""

    canonical_id: str
    entity_type: str
    display_name: str
    aliases: Tuple[str, ...] = ()
    asset_code: Optional[str] = None
    tags: Tuple[str, ...] = ()
    notes: Optional[str] = None

    @property
    def terms(self) -> Tuple[str, ...]:
        """
        Every spelling of this entity, display name first, deduplicated.

        ``asset_code`` counts as a spelling only for ``entity_type: asset``.
        On other types it records the *related* asset (Soroban settles in XLM)
        and must not make the pipeline read "XLM" as "Soroban".
        """
        ordered: List[str] = [self.display_name]
        if self.asset_code and self.entity_type == "asset":
            ordered.append(self.asset_code)
        ordered.extend(self.aliases)

        seen: set[str] = set()
        unique: List[str] = []
        for term in ordered:
            key = normalize_alias(term)
            if not key or key in seen:
                continue
            seen.add(key)
            unique.append(term)
        return tuple(unique)

    def surface_form_for(self, matched_term: str) -> str:
        """
        Label to use when tagging ``matched_term`` in text.

        Assets keep their ticker when the ticker itself was matched, so
        ``"$XLM"`` tags as ``"XLM"`` while ``"lumens"`` tags as ``"Stellar"``.
        """
        if (
            self.asset_code
            and self.entity_type == "asset"
            and normalize_alias(matched_term) == normalize_alias(self.asset_code)
        ):
            return self.asset_code
        return self.display_name

    def to_dict(self) -> Dict[str, Any]:
        """Serialize for API responses and dataset metadata."""
        return {
            "canonical_id": self.canonical_id,
            "entity_type": self.entity_type,
            "display_name": self.display_name,
            "asset_code": self.asset_code,
            "aliases": list(self.aliases),
            "tags": list(self.tags),
        }


@dataclass(frozen=True)
class EntityMention:
    """An alias occurrence found in text, resolved to its canonical entity."""

    entity: CanonicalEntity
    matched_text: str
    matched_alias: str

    @property
    def canonical_id(self) -> str:
        return self.entity.canonical_id

    @property
    def surface_form(self) -> str:
        return self.entity.surface_form_for(self.matched_alias)


@dataclass
class EntityAliasRegistry:
    """
    Immutable, in-memory view of the alias registry.

    Build one with :meth:`from_mapping`, :meth:`from_yaml` or :func:`get_registry`.
    """

    entities: Tuple[CanonicalEntity, ...]
    version: int = 1
    source: str = "<memory>"

    _by_id: Dict[str, CanonicalEntity] = field(
        init=False, repr=False, default_factory=dict
    )
    _by_alias: Dict[str, CanonicalEntity] = field(
        init=False, repr=False, default_factory=dict
    )
    _alias_terms: Dict[str, str] = field(
        init=False, repr=False, default_factory=dict
    )
    _by_loose_alias: Dict[str, CanonicalEntity] = field(
        init=False, repr=False, default_factory=dict
    )

    def __post_init__(self) -> None:
        self.entities = tuple(self.entities)
        self._build_indexes()

    # ------------------------------------------------------------------
    # Construction
    # ------------------------------------------------------------------
    @classmethod
    def from_mapping(cls, data: Mapping[str, Any], source: str = "<mapping>") -> "EntityAliasRegistry":
        """Build a registry from an already-parsed registry document."""
        if not isinstance(data, Mapping):
            raise EntityAliasRegistryError(
                f"Registry document must be a mapping, got {type(data).__name__}"
            )

        raw_entities = data.get("entities")
        if not isinstance(raw_entities, Sequence) or isinstance(raw_entities, (str, bytes)):
            raise EntityAliasRegistryError(
                "Registry document must contain an 'entities' list"
            )

        entities = [_parse_entity(item, index) for index, item in enumerate(raw_entities)]

        try:
            version = int(data.get("version", 1))
        except (TypeError, ValueError):
            raise EntityAliasRegistryError(
                f"Registry 'version' must be an integer, got {data.get('version')!r}"
            ) from None

        return cls(entities=tuple(entities), version=version, source=source)

    @classmethod
    def from_yaml(cls, path: str) -> "EntityAliasRegistry":
        """Load a registry from a YAML file. Raises if it cannot be read."""
        import yaml  # imported lazily so the module works without PyYAML

        with open(path, "r", encoding="utf-8") as handle:
            data = yaml.safe_load(handle) or {}
        return cls.from_mapping(data, source=path)

    @classmethod
    def builtin(cls) -> "EntityAliasRegistry":
        """Fallback registry seeded from the legacy static keyword maps."""
        return cls(entities=tuple(_builtin_seed_entities()), source="<builtin>")

    @classmethod
    def load(cls, path: Optional[str] = None) -> "EntityAliasRegistry":
        """
        Load the registry, preferring YAML and degrading gracefully.

        Resolution order: explicit ``path`` →
        ``$ENTITY_ALIAS_REGISTRY_PATH`` → ``config/entity_aliases.yaml`` →
        built-in seed.  An *explicit* path that fails to load raises; the
        implicit paths only warn, so a missing config file never takes the
        pipeline down.
        """
        if path:
            return cls.from_yaml(path)

        candidate = os.getenv(REGISTRY_PATH_ENV_VAR) or DEFAULT_REGISTRY_PATH
        if not os.path.isfile(candidate):
            logger.warning(
                "Entity alias registry not found at %s; using built-in seed aliases. "
                "Set %s to point at a registry file.",
                candidate,
                REGISTRY_PATH_ENV_VAR,
            )
            return cls.builtin()

        try:
            registry = cls.from_yaml(candidate)
        except ImportError:
            logger.warning(
                "PyYAML is not installed; using built-in seed aliases instead of %s.",
                candidate,
            )
            return cls.builtin()
        except (OSError, EntityAliasRegistryError) as exc:
            logger.error(
                "Failed to load entity alias registry from %s (%s); using built-in "
                "seed aliases.",
                candidate,
                exc,
            )
            return cls.builtin()

        logger.info(
            "Loaded entity alias registry v%s from %s (%d entities, %d aliases)",
            registry.version,
            candidate,
            len(registry.entities),
            len(registry._by_alias),
        )
        return registry

    # ------------------------------------------------------------------
    # Indexing / validation
    # ------------------------------------------------------------------
    def _build_indexes(self) -> None:
        by_id: Dict[str, CanonicalEntity] = {}
        by_alias: Dict[str, CanonicalEntity] = {}
        alias_terms: Dict[str, str] = {}
        by_loose: Dict[str, CanonicalEntity] = {}

        for entity in self.entities:
            if entity.canonical_id in by_id:
                raise EntityAliasRegistryError(
                    f"Duplicate canonical_id {entity.canonical_id!r} in {self.source}"
                )
            by_id[entity.canonical_id] = entity

            for term in entity.terms:
                key = normalize_alias(term)
                existing = by_alias.get(key)
                if existing is not None and existing.canonical_id != entity.canonical_id:
                    raise AliasConflictError(
                        f"Alias {term!r} is claimed by both "
                        f"{existing.canonical_id!r} and {entity.canonical_id!r} "
                        f"in {self.source}"
                    )
                by_alias[key] = entity
                alias_terms.setdefault(key, term)

                loose = _loose_key(term)
                # Loose keys are a convenience index: first writer wins and we
                # never let them shadow an exact alias.
                if loose and loose not in by_loose:
                    by_loose[loose] = entity

        self._by_id = by_id
        self._by_alias = by_alias
        self._alias_terms = alias_terms
        self._by_loose_alias = by_loose

    def validate(self) -> List[str]:
        """
        Return human-readable warnings about questionable registry content.

        Hard errors (duplicate IDs, alias conflicts) already raise at
        construction time; this reports the softer problems a reviewer wants to
        know about.  Used by ``scripts/validate_entity_aliases.py``.
        """
        warnings: List[str] = []

        for entity in self.entities:
            if not _CANONICAL_ID_PATTERN.match(entity.canonical_id):
                warnings.append(
                    f"{entity.canonical_id}: canonical_id should look like "
                    "'<type>:<slug>' (lowercase type, e.g. 'asset:XLM')"
                )
            if entity.entity_type not in VALID_ENTITY_TYPES:
                warnings.append(
                    f"{entity.canonical_id}: unknown entity_type "
                    f"{entity.entity_type!r} (expected one of "
                    f"{sorted(VALID_ENTITY_TYPES)})"
                )
            if entity.entity_type == "asset" and not entity.asset_code:
                warnings.append(
                    f"{entity.canonical_id}: entity_type 'asset' should define "
                    "an asset_code"
                )
            if len(entity.terms) < 2:
                warnings.append(
                    f"{entity.canonical_id}: only one spelling registered; an "
                    "entity with no aliases adds nothing to the registry"
                )
            for term in entity.terms:
                if len(normalize_alias(term)) < MIN_TEXT_MATCH_ALIAS_LENGTH:
                    warnings.append(
                        f"{entity.canonical_id}: alias {term!r} is shorter than "
                        f"{MIN_TEXT_MATCH_ALIAS_LENGTH} characters and will not "
                        "be matched in free text"
                    )

        return warnings

    # ------------------------------------------------------------------
    # Lookups
    # ------------------------------------------------------------------
    def __len__(self) -> int:
        return len(self.entities)

    def __iter__(self):
        return iter(self.entities)

    @property
    def alias_count(self) -> int:
        """Number of distinct alias keys indexed."""
        return len(self._by_alias)

    def get(self, canonical_id: str) -> Optional[CanonicalEntity]:
        """Look up an entity by its exact canonical_id."""
        return self._by_id.get(canonical_id)

    def resolve(self, term: Optional[str]) -> Optional[CanonicalEntity]:
        """
        Resolve any spelling to its canonical entity, or ``None``.

        Tries the exact normalized alias first, then the punctuation-insensitive
        index.
        """
        key = normalize_alias(term or "")
        if not key:
            return None
        entity = self._by_alias.get(key)
        if entity is not None:
            return entity
        return self._by_loose_alias.get(_loose_key(key))

    def canonical_id_for(self, term: Optional[str]) -> Optional[str]:
        """Canonical join key for ``term``, or ``None`` if unregistered."""
        entity = self.resolve(term)
        return entity.canonical_id if entity else None

    def surface_form(self, term: str) -> str:
        """
        Canonical label for ``term``, or ``term`` unchanged if unregistered.

        Unregistered terms are returned as-is so normalization is always safe
        to apply to a whole list of extracted entities.
        """
        entity = self.resolve(term)
        return entity.surface_form_for(term) if entity else term

    def aliases_for(self, canonical_id: str) -> Tuple[str, ...]:
        """Every registered spelling for one canonical entity."""
        entity = self._by_id.get(canonical_id)
        return entity.terms if entity else ()

    def entities_by_type(self, entity_type: str) -> Tuple[CanonicalEntity, ...]:
        """All entities of one ``entity_type``, in registry order."""
        return tuple(e for e in self.entities if e.entity_type == entity_type)

    def entities_by_tag(self, tag: str) -> Tuple[CanonicalEntity, ...]:
        """All entities carrying ``tag``, in registry order."""
        wanted = tag.strip().lower()
        return tuple(
            e for e in self.entities if wanted in {t.strip().lower() for t in e.tags}
        )

    def surface_form_map(self) -> Dict[str, str]:
        """
        ``{normalized alias: surface form}`` for every registered spelling.

        A drop-in replacement for the hand-built canonical-name dictionaries
        the pipeline used to carry.
        """
        return {
            key: entity.surface_form_for(self._alias_terms[key])
            for key, entity in self._by_alias.items()
        }

    def normalize_terms(self, terms: Iterable[str]) -> List[str]:
        """
        Canonicalize a list of extracted terms, deduplicating by identity.

        Registered terms collapse onto one surface form per canonical entity;
        unregistered terms are kept (first spelling wins).  Input order is
        preserved so downstream ranking stays stable.

        >>> get_registry().normalize_terms(["$XLM", "lumens", "Acme"])
        ['XLM', 'Acme']
        """
        normalized: List[str] = []
        seen: set[str] = set()

        for term in terms:
            if not term or not str(term).strip():
                continue
            entity = self.resolve(term)
            if entity is not None:
                key = entity.canonical_id
                value = entity.surface_form_for(term)
            else:
                key = normalize_alias(term)
                value = str(term).strip()
                if not key:
                    continue
            if key in seen:
                continue
            seen.add(key)
            normalized.append(value)

        return normalized

    def find_in_text(self, text: Optional[str]) -> List[EntityMention]:
        """
        Find registered aliases in free text.

        Longest alias first, so ``"Stellar Development Foundation"`` wins over
        ``"Stellar"``, and at most one mention per canonical entity.
        """
        if not text or not text.strip():
            return []

        mentions: Dict[str, EntityMention] = {}
        claimed_spans: List[Tuple[int, int]] = []

        for key in sorted(self._by_alias, key=len, reverse=True):
            if len(key) < MIN_TEXT_MATCH_ALIAS_LENGTH:
                continue
            entity = self._by_alias[key]
            if entity.canonical_id in mentions:
                continue
            alias = self._alias_terms[key]
            # Optional "$" sigil so "$XLM" matches the alias "XLM".
            pattern = (
                r"(?<![\w$])\$?" + re.escape(alias.strip()) + r"(?![\w-])"
            )

            for match in re.finditer(pattern, text, flags=re.IGNORECASE):
                span = match.span()
                # A shorter alias inside an already-matched longer one is the
                # same mention, not a second entity: "Stellar" inside
                # "Stellar Development Foundation" must not tag asset:XLM.
                if any(
                    span[0] < claimed[1] and claimed[0] < span[1]
                    for claimed in claimed_spans
                ):
                    continue
                claimed_spans.append(span)
                mentions[entity.canonical_id] = EntityMention(
                    entity=entity,
                    matched_text=match.group(0),
                    matched_alias=alias,
                )
                break

        return sorted(mentions.values(), key=lambda m: m.canonical_id)

    def to_dict(self) -> Dict[str, Any]:
        """Serialize the whole registry (for API exposure / snapshots)."""
        return {
            "version": self.version,
            "source": self.source,
            "entity_count": len(self.entities),
            "alias_count": self.alias_count,
            "entities": [entity.to_dict() for entity in self.entities],
        }


def _parse_entity(item: Any, index: int) -> CanonicalEntity:
    """Validate and coerce one raw registry entry."""
    where = f"entities[{index}]"
    if not isinstance(item, Mapping):
        raise EntityAliasRegistryError(
            f"{where} must be a mapping, got {type(item).__name__}"
        )

    canonical_id = str(item.get("canonical_id") or "").strip()
    if not canonical_id:
        raise EntityAliasRegistryError(f"{where} is missing 'canonical_id'")

    entity_type = str(item.get("entity_type") or "").strip()
    if not entity_type:
        raise EntityAliasRegistryError(
            f"{where} ({canonical_id}) is missing 'entity_type'"
        )

    display_name = str(item.get("display_name") or "").strip()
    if not display_name:
        raise EntityAliasRegistryError(
            f"{where} ({canonical_id}) is missing 'display_name'"
        )

    raw_aliases = item.get("aliases") or []
    if isinstance(raw_aliases, (str, bytes)):
        raise EntityAliasRegistryError(
            f"{where} ({canonical_id}): 'aliases' must be a list, not a string"
        )
    aliases = tuple(
        str(alias).strip() for alias in raw_aliases if str(alias or "").strip()
    )

    raw_tags = item.get("tags") or []
    if isinstance(raw_tags, (str, bytes)):
        raw_tags = [raw_tags]
    tags = tuple(str(tag).strip() for tag in raw_tags if str(tag or "").strip())

    asset_code = item.get("asset_code")
    notes = item.get("notes")

    return CanonicalEntity(
        canonical_id=canonical_id,
        entity_type=entity_type,
        display_name=display_name,
        aliases=aliases,
        asset_code=str(asset_code).strip() if asset_code else None,
        tags=tags,
        notes=str(notes).strip() if notes else None,
    )


def _builtin_seed_entities() -> List[CanonicalEntity]:
    """
    Seed entities derived from the legacy static keyword maps.

    Only used when ``config/entity_aliases.yaml`` cannot be read, so the
    pipeline keeps its pre-registry behaviour instead of losing all aliases.
    :mod:`keywords` is imported locally to avoid a circular import.

    The legacy maps contain genuine collisions -- ``"Stellar"`` is listed under
    both ``XLM`` and ``SDF`` -- so names are assigned deterministically:
    ``TICKER_TO_PROJECT`` wins the display name (it states ``XLM -> Stellar``
    explicitly), a name already taken falls back to the asset code, and a
    contested alias goes to whichever entity the name identifies outright.
    """
    from .keywords import CRYPTO_PROJECT_MAP, TICKER_TO_PROJECT

    aliases_by_code: Dict[str, set] = {}
    for code, names in TICKER_TO_PROJECT.items():
        aliases_by_code.setdefault(code, set()).update(names)
    for key, values in CRYPTO_PROJECT_MAP.items():
        if values:
            aliases_by_code.setdefault(values[0], set()).update([key, *values])

    display_by_code: Dict[str, str] = {}
    display_owner: Dict[str, str] = {}

    def claim_display(code: str, candidate: str) -> None:
        if code in display_by_code:
            return
        key = normalize_alias(candidate)
        if not key or display_owner.get(key, code) != code:
            candidate = code
            key = normalize_alias(code)
        display_by_code[code] = candidate
        display_owner.setdefault(key, code)

    # TICKER_TO_PROJECT is the authoritative code -> canonical name mapping.
    for code in sorted(TICKER_TO_PROJECT):
        names = TICKER_TO_PROJECT[code]
        claim_display(code, names[0] if names else code)
    for key in sorted(CRYPTO_PROJECT_MAP):
        values = CRYPTO_PROJECT_MAP[key]
        if values:
            claim_display(values[0], values[-1])

    codes = sorted(aliases_by_code)

    # An alias that names an entity outright (its code or display name) is
    # reserved to that entity and stripped from every other entity.
    reserved: Dict[str, str] = {normalize_alias(code): code for code in codes}
    for code in codes:
        reserved.setdefault(normalize_alias(display_by_code[code]), code)

    entities: List[CanonicalEntity] = []
    claimed: Dict[str, str] = {}

    for code in codes:
        display_name = display_by_code[code]
        own_names = {normalize_alias(code), normalize_alias(display_name)}
        aliases: List[str] = []

        for alias in sorted(aliases_by_code[code]):
            key = normalize_alias(alias)
            if not key or key in own_names:
                continue
            if reserved.get(key, claimed.get(key, code)) != code:
                continue
            claimed[key] = code
            aliases.append(alias)

        entities.append(
            CanonicalEntity(
                canonical_id=f"asset:{code}",
                entity_type="asset",
                display_name=display_name,
                aliases=tuple(aliases),
                asset_code=code,
            )
        )

    return entities


_registry_lock = threading.Lock()
_registry: Optional[EntityAliasRegistry] = None


def get_registry() -> EntityAliasRegistry:
    """
    Process-wide registry singleton, loaded on first use.

    Call :func:`reload_registry` after editing the YAML in a long-running
    process (or in tests) to pick up changes.
    """
    global _registry
    if _registry is None:
        with _registry_lock:
            if _registry is None:
                _registry = EntityAliasRegistry.load()
    return _registry


def reload_registry(path: Optional[str] = None) -> EntityAliasRegistry:
    """Reload the singleton from ``path`` (or the default resolution order)."""
    global _registry
    with _registry_lock:
        _registry = EntityAliasRegistry.load(path)
    return _registry


def set_registry(registry: Optional[EntityAliasRegistry]) -> None:
    """Install a registry (or ``None`` to reset) -- intended for tests."""
    global _registry
    with _registry_lock:
        _registry = registry
