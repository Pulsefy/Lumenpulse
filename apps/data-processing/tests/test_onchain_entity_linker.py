"""Tests for deterministic on-chain entity linking."""

from src.analytics.onchain_entity_linker import (
    OnchainEntityCandidate,
    OnchainEntityLinker,
)


def test_links_assets_with_stable_ids() -> None:
    linker = OnchainEntityLinker()

    links = linker.link_text("Stellar developers shipped new XLM rails.")
    stable_ids = {link.stable_id for link in links}

    assert "asset:XLM" in stable_ids
    assert all(link.source == "onchain_entity_linker_v1" for link in links)


def test_links_project_catalog_candidate() -> None:
    linker = OnchainEntityLinker(
        [
            OnchainEntityCandidate(
                stable_id="project:42",
                entity_type="project",
                display_name="Solar Grants",
                aliases=("Solar Grants", "solar-grants"),
                project_id=42,
                contract_id="CBQTESTPROJECT",
            )
        ]
    )

    links = linker.link_text("Solar Grants crossed its testnet funding target.")

    assert links[0].stable_id == "project:42"
    assert links[0].project_id == 42
    assert links[0].contract_id == "CBQTESTPROJECT"


def test_measures_precision_against_labeled_articles() -> None:
    linker = OnchainEntityLinker(
        [
            OnchainEntityCandidate(
                stable_id="project:7",
                entity_type="project",
                display_name="Lumen Launch",
                aliases=("Lumen Launch",),
                project_id=7,
            )
        ]
    )

    result = linker.evaluate_precision(
        [
            {
                "id": "article-1",
                "title": "Lumen Launch adds Stellar rewards",
                "expected_stable_ids": ["project:7", "asset:XLM"],
            }
        ]
    )

    assert result["precision"] == 1.0
    assert result["true_positive"] == 2
    assert result["predicted"] == 2
