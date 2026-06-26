"""Unit tests for NERService entity extraction."""

from src.analytics.ner_service import NERService


def test_extracts_project_asset_and_person_entities() -> None:
    service = NERService()

    text = (
        "Soroban on Stellar gains traction after Jed McCaleb highlighted "
        "new XLM utility for payments."
    )
    entities = service.extract_entities(text)

    assert "Soroban" in entities
    assert "Stellar" in entities
    assert "XLM" in entities
    assert "Jed McCaleb" in entities


def test_extract_entities_from_article_fields() -> None:
    service = NERService()

    entities = service.extract_entities_from_article(
        title="Stellar expands Soroban support",
        summary="Developers are shipping new contracts",
        content="The XLM ecosystem sees strong participation.",
    )

    assert "Stellar" in entities
    assert "Soroban" in entities
    assert "XLM" in entities


def test_returns_empty_list_for_blank_text() -> None:
    service = NERService()

    assert service.extract_entities("   ") == []
