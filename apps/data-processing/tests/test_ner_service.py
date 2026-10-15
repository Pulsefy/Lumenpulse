"""Unit tests for NERService entity extraction."""

import json

import pytest

from src.analytics.ner_service import (
    MissingNERModelError,
    NERService,
    check_model_available,
)
from src.config.ner_config import NERConfig


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


def _write_meta(model_dir, name) -> None:
    model_dir.mkdir(parents=True, exist_ok=True)
    (model_dir / "meta.json").write_text(json.dumps({"name": name}), encoding="utf-8")


def test_check_model_available_passes_when_pinned_version_present(tmp_path) -> None:
    cfg = NERConfig(
        model_dir=str(tmp_path),
        model_name="en_core_web_sm",
        model_version="3.7.1",
    )
    _write_meta(tmp_path, cfg.shipped_version_tag)

    check_model_available(cfg)


def test_check_model_available_fails_fast_when_missing(tmp_path) -> None:
    cfg = NERConfig(
        model_dir=str(tmp_path),
        model_name="en_core_web_sm",
        model_version="3.7.1",
    )

    with pytest.raises(MissingNERModelError):
        check_model_available(cfg)


def test_check_model_available_fails_fast_on_version_mismatch(tmp_path) -> None:
    cfg = NERConfig(
        model_dir=str(tmp_path),
        model_name="en_core_web_sm",
        model_version="3.7.1",
    )
    _write_meta(tmp_path, "en_core_web_md-3.7.1")

    with pytest.raises(MissingNERModelError):
        check_model_available(cfg)


def test_model_version_property_reports_pinned_version() -> None:
    cfg = NERConfig(model_name="en_core_web_sm", model_version="3.7.1")
    assert cfg.shipped_version_tag == "en_core_web_sm-3.7.1"


def test_service_falls_back_to_regex_when_model_missing(tmp_path) -> None:
    cfg = NERConfig(
        model_dir=str(tmp_path),
        model_name="en_core_web_sm",
        model_version="3.7.1",
    )
    service = NERService(cfg=cfg)

    entities = service.extract_entities(
        "Soroban on Stellar gains traction after XLM utility grew."
    )

    assert "Soroban" in entities
    assert "Stellar" in entities
    assert "XLM" in entities

