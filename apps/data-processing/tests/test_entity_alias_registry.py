"""Tests for the entity alias registry and the normalization it drives."""

import os

import pytest

from src.analytics.entity_alias_registry import (
    DEFAULT_REGISTRY_PATH,
    AliasConflictError,
    CanonicalEntity,
    EntityAliasRegistry,
    EntityAliasRegistryError,
    normalize_alias,
    reload_registry,
    set_registry,
)

SAMPLE_REGISTRY = {
    "version": 3,
    "entities": [
        {
            "canonical_id": "asset:XLM",
            "entity_type": "asset",
            "display_name": "Stellar",
            "asset_code": "XLM",
            "aliases": ["Stellar Lumens", "lumens", "lumen"],
            "tags": ["stellar", "native-asset"],
        },
        {
            "canonical_id": "project:soroban",
            "entity_type": "project",
            "display_name": "Soroban",
            "asset_code": "XLM",
            "aliases": ["Soroban smart contracts"],
            "tags": ["stellar"],
        },
        {
            "canonical_id": "organization:sdf",
            "entity_type": "organization",
            "display_name": "Stellar Development Foundation",
            "aliases": ["SDF"],
        },
    ],
}


@pytest.fixture
def registry() -> EntityAliasRegistry:
    return EntityAliasRegistry.from_mapping(SAMPLE_REGISTRY, source="<test>")


@pytest.fixture(autouse=True)
def _reset_shared_registry():
    """Keep the module-level singleton out of other tests' way."""
    yield
    set_registry(None)


# ---------------------------------------------------------------------------
# Alias normalization
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("  $XLM. ", "xlm"),
        ("XLM", "xlm"),
        ("Stellar   Development  Foundation", "stellar development foundation"),
        ("(Soroban)", "soroban"),
        ("", ""),
        ("   ", ""),
    ],
)
def test_normalize_alias_reduces_spellings_to_one_key(raw, expected) -> None:
    assert normalize_alias(raw) == expected


# ---------------------------------------------------------------------------
# Acceptance: multiple names for one canonical entity
# ---------------------------------------------------------------------------


def test_multiple_aliases_resolve_to_one_canonical_entity(registry) -> None:
    canonical_ids = {
        registry.canonical_id_for(term)
        for term in ["Stellar", "stellar lumens", "LUMENS", "$xlm", "xlm", "lumen"]
    }

    assert canonical_ids == {"asset:XLM"}


def test_resolve_returns_none_for_unregistered_term(registry) -> None:
    assert registry.resolve("Acme Holdings") is None
    assert registry.canonical_id_for("Acme Holdings") is None


def test_resolve_tolerates_punctuation_and_spacing(registry) -> None:
    entity = registry.resolve("soroban-smart-contracts")

    assert entity is not None
    assert entity.canonical_id == "project:soroban"


def test_asset_keeps_its_ticker_as_the_tagging_label(registry) -> None:
    # Identity is shared, but the label used when tagging text is not: an
    # article saying "$XLM" should still be tagged "XLM", not "Stellar".
    assert registry.surface_form("$XLM") == "XLM"
    assert registry.surface_form("lumens") == "Stellar"


def test_surface_form_passes_through_unregistered_terms(registry) -> None:
    assert registry.surface_form("Acme Holdings") == "Acme Holdings"


def test_related_asset_code_is_not_an_alias_of_a_project(registry) -> None:
    # project:soroban records XLM as its settlement asset; that must not make
    # the pipeline read "XLM" as "Soroban".
    assert registry.canonical_id_for("XLM") == "asset:XLM"
    assert registry.get("project:soroban").asset_code == "XLM"


def test_aliases_for_lists_every_spelling(registry) -> None:
    terms = {term.lower() for term in registry.aliases_for("asset:XLM")}

    assert {"stellar", "xlm", "lumens", "stellar lumens"} <= terms
    assert registry.aliases_for("asset:NOPE") == ()


def test_lookup_helpers_expose_types_and_tags(registry) -> None:
    assert [e.canonical_id for e in registry.entities_by_type("asset")] == ["asset:XLM"]
    assert {e.canonical_id for e in registry.entities_by_tag("stellar")} == {
        "asset:XLM",
        "project:soroban",
    }
    assert registry.version == 3
    assert len(registry) == 3


# ---------------------------------------------------------------------------
# Text matching
# ---------------------------------------------------------------------------


def test_find_in_text_matches_alias_and_reports_canonical_entity(registry) -> None:
    mentions = registry.find_in_text("Daily lumens volume hit a new high.")

    assert [m.canonical_id for m in mentions] == ["asset:XLM"]
    assert mentions[0].matched_text == "lumens"
    assert mentions[0].surface_form == "Stellar"


def test_find_in_text_prefers_the_longest_alias(registry) -> None:
    # "Stellar" is an alias of asset:XLM but here it is part of a longer
    # organization name, so only the organization should be reported.
    mentions = registry.find_in_text(
        "The Stellar Development Foundation announced a grant round."
    )

    assert [m.canonical_id for m in mentions] == ["organization:sdf"]


def test_find_in_text_matches_ticker_with_dollar_sigil(registry) -> None:
    mentions = registry.find_in_text("Traders rotated into $XLM overnight.")

    assert [m.canonical_id for m in mentions] == ["asset:XLM"]
    assert mentions[0].matched_text == "$XLM"
    assert mentions[0].surface_form == "XLM"


def test_find_in_text_ignores_substrings_and_blank_input(registry) -> None:
    assert registry.find_in_text("XLMANIA is not an asset") == []
    assert registry.find_in_text("") == []
    assert registry.find_in_text(None) == []


def test_normalize_terms_collapses_aliases_and_keeps_unknowns(registry) -> None:
    normalized = registry.normalize_terms(
        ["$XLM", "lumens", "Stellar", "Acme Holdings", "", "  "]
    )

    assert normalized == ["XLM", "Acme Holdings"]


def test_surface_form_map_covers_every_alias(registry) -> None:
    mapping = registry.surface_form_map()

    assert mapping["lumens"] == "Stellar"
    assert mapping["xlm"] == "XLM"
    assert mapping["sdf"] == "Stellar Development Foundation"


# ---------------------------------------------------------------------------
# Validation — the guard rails contributors rely on
# ---------------------------------------------------------------------------


def test_conflicting_alias_is_rejected_not_silently_resolved() -> None:
    data = {
        "version": 1,
        "entities": [
            {
                "canonical_id": "asset:AAA",
                "entity_type": "asset",
                "display_name": "Alpha",
                "asset_code": "AAA",
                "aliases": ["shared name"],
            },
            {
                "canonical_id": "asset:BBB",
                "entity_type": "asset",
                "display_name": "Beta",
                "asset_code": "BBB",
                "aliases": ["Shared Name"],
            },
        ],
    }

    with pytest.raises(AliasConflictError) as excinfo:
        EntityAliasRegistry.from_mapping(data)

    assert "asset:AAA" in str(excinfo.value)
    assert "asset:BBB" in str(excinfo.value)


def test_duplicate_canonical_id_is_rejected() -> None:
    entity = {
        "canonical_id": "asset:AAA",
        "entity_type": "asset",
        "display_name": "Alpha",
        "asset_code": "AAA",
    }

    with pytest.raises(EntityAliasRegistryError):
        EntityAliasRegistry.from_mapping({"version": 1, "entities": [entity, entity]})


@pytest.mark.parametrize(
    "entity,missing",
    [
        ({"entity_type": "asset", "display_name": "Alpha"}, "canonical_id"),
        ({"canonical_id": "asset:AAA", "display_name": "Alpha"}, "entity_type"),
        ({"canonical_id": "asset:AAA", "entity_type": "asset"}, "display_name"),
    ],
)
def test_missing_required_field_is_reported_by_name(entity, missing) -> None:
    with pytest.raises(EntityAliasRegistryError) as excinfo:
        EntityAliasRegistry.from_mapping({"version": 1, "entities": [entity]})

    assert missing in str(excinfo.value)


def test_malformed_documents_are_rejected() -> None:
    with pytest.raises(EntityAliasRegistryError):
        EntityAliasRegistry.from_mapping({"version": 1})

    with pytest.raises(EntityAliasRegistryError):
        EntityAliasRegistry.from_mapping(
            {
                "version": 1,
                "entities": [
                    {
                        "canonical_id": "asset:AAA",
                        "entity_type": "asset",
                        "display_name": "Alpha",
                        "aliases": "not-a-list",
                    }
                ],
            }
        )


def test_validate_flags_style_problems() -> None:
    data = {
        "version": 1,
        "entities": [
            {
                "canonical_id": "Weird_ID",
                "entity_type": "coin",
                "display_name": "Solo",
            }
        ],
    }

    warnings = EntityAliasRegistry.from_mapping(data).validate()
    joined = " | ".join(warnings)

    assert "canonical_id" in joined
    assert "entity_type" in joined
    assert "only one spelling" in joined


def test_validate_is_clean_for_a_well_formed_registry(registry) -> None:
    assert registry.validate() == []


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------


def test_committed_registry_file_is_valid() -> None:
    pytest.importorskip("yaml")

    registry = EntityAliasRegistry.from_yaml(DEFAULT_REGISTRY_PATH)

    assert registry.validate() == []
    assert registry.canonical_id_for("lumens") == "asset:XLM"
    assert registry.canonical_id_for("$xlm") == "asset:XLM"
    assert registry.canonical_id_for("USD Coin") == "asset:USDC"


def test_load_honours_the_env_var_override(tmp_path, monkeypatch) -> None:
    pytest.importorskip("yaml")

    path = tmp_path / "aliases.yaml"
    path.write_text(
        "version: 9\n"
        "entities:\n"
        "  - canonical_id: project:widget\n"
        "    entity_type: project\n"
        "    display_name: Widget\n"
        "    aliases: [widgets, the-widget]\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("ENTITY_ALIAS_REGISTRY_PATH", str(path))

    registry = reload_registry()

    assert registry.version == 9
    assert registry.canonical_id_for("Widgets") == "project:widget"


def test_load_falls_back_to_builtin_seed_when_file_is_missing(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv(
        "ENTITY_ALIAS_REGISTRY_PATH", str(tmp_path / "does-not-exist.yaml")
    )

    registry = EntityAliasRegistry.load()

    # The seed comes from the legacy keyword maps, so the pipeline keeps
    # working with its pre-registry aliases rather than losing all of them.
    assert registry.source == "<builtin>"
    assert registry.canonical_id_for("Stellar") == "asset:XLM"
    assert registry.canonical_id_for("Bitcoin") == "asset:BTC"


def test_load_falls_back_when_the_file_is_unparseable(tmp_path, monkeypatch) -> None:
    pytest.importorskip("yaml")

    path = tmp_path / "broken.yaml"
    path.write_text("version: 1\nentities: 'not a list'\n", encoding="utf-8")
    monkeypatch.setenv("ENTITY_ALIAS_REGISTRY_PATH", str(path))

    assert EntityAliasRegistry.load().source == "<builtin>"


def test_explicit_path_load_raises_instead_of_falling_back(tmp_path) -> None:
    pytest.importorskip("yaml")

    path = tmp_path / "broken.yaml"
    path.write_text("version: 1\nentities: 'not a list'\n", encoding="utf-8")

    with pytest.raises(EntityAliasRegistryError):
        EntityAliasRegistry.load(str(path))


def test_builtin_seed_has_no_alias_conflicts() -> None:
    # The legacy maps list "Stellar" under both XLM and SDF; the seed builder
    # has to resolve that deterministically or the registry cannot be built.
    registry = EntityAliasRegistry.builtin()

    assert registry.canonical_id_for("Stellar") == "asset:XLM"
    assert registry.canonical_id_for("stellar development foundation") == "asset:SDF"


def test_to_dict_round_trips_through_from_mapping(registry) -> None:
    rebuilt = EntityAliasRegistry.from_mapping(registry.to_dict())

    assert len(rebuilt) == len(registry)
    assert rebuilt.canonical_id_for("lumens") == "asset:XLM"


def test_canonical_entity_serializes_for_downstream_metadata(registry) -> None:
    payload = registry.get("asset:XLM").to_dict()

    assert payload["canonical_id"] == "asset:XLM"
    assert payload["asset_code"] == "XLM"
    assert "lumens" in payload["aliases"]
    assert payload["tags"] == ["stellar", "native-asset"]


def test_default_registry_path_points_at_the_committed_file() -> None:
    assert DEFAULT_REGISTRY_PATH.endswith(
        os.path.join("config", "entity_aliases.yaml")
    )


def test_canonical_entity_is_hashable_and_immutable() -> None:
    entity = CanonicalEntity(
        canonical_id="asset:AAA",
        entity_type="asset",
        display_name="Alpha",
        asset_code="AAA",
    )

    assert {entity, entity} == {entity}
    with pytest.raises(Exception):
        entity.display_name = "Beta"  # type: ignore[misc]
