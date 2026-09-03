"""
Tests for the feature/KPI lineage graph engine (issue #1254).

These exercise `src/lineage/manifest.py` and `src/lineage/graph.py` directly
against the real manifest and against small synthetic manifests — no FastAPI
app or database is needed, since lineage reads a YAML file and nothing else.
"""

import pytest

from src.lineage.graph import LineageNotFoundError, get_lineage
from src.lineage.manifest import ManifestRef, entry_feature_names, parse_ref, resolve_ref


# ---------------------------------------------------------------------------
# manifest.py — reference parsing
# ---------------------------------------------------------------------------


def test_parse_ref_two_part():
    ref = parse_ref("kpi_datasets.sentiment_compound")
    assert ref == ManifestRef("kpi_datasets", "sentiment_compound", None)


def test_parse_ref_three_part():
    ref = parse_ref("ml_feature_sets.price_predictor_features.sentiment_score")
    assert ref == ManifestRef("ml_feature_sets", "price_predictor_features", "sentiment_score")


@pytest.mark.parametrize(
    "value",
    [
        "src/analytics/sentiment.py::SentimentAnalyzer.analyze_text",
        "src/api/server.py (GET /api/market-analysis)",
        "vaderSentiment (third-party library)",
        None,
        42,
    ],
)
def test_parse_ref_rejects_free_text_and_non_strings(value):
    assert parse_ref(value) is None


def test_resolve_ref_against_real_manifest():
    from src.lineage.manifest import load_manifest

    manifest = load_manifest()
    ref = parse_ref("kpi_datasets.sentiment_compound")
    assert resolve_ref(manifest, ref) is True

    dangling = ManifestRef("kpi_datasets", "totally_made_up_id", None)
    assert resolve_ref(manifest, dangling) is False

    # Real feature that exists on price_predictor_features.
    ok_feature = ManifestRef("ml_feature_sets", "price_predictor_features", "sentiment_score")
    assert resolve_ref(manifest, ok_feature) is True

    bad_feature = ManifestRef("ml_feature_sets", "price_predictor_features", "not_a_real_feature")
    assert resolve_ref(manifest, bad_feature) is False


def test_entry_feature_names():
    entry = {"features": [{"name": "a"}, {"name": "b"}]}
    assert entry_feature_names(entry) == ["a", "b"]

    entry2 = {"inputs": [{"name": "x"}]}
    assert entry_feature_names(entry2) == ["x"]


# ---------------------------------------------------------------------------
# graph.py — lineage traversal against a synthetic manifest
# ---------------------------------------------------------------------------


@pytest.fixture
def synthetic_manifest():
    return {
        "manifest_version": "1.0",
        "project": "lumenpulse",
        "module": "data-processing",
        "ml_feature_sets": [
            {
                "id": "raw_features",
                "display_name": "Raw Features",
                "description": "Base features.",
                "owner": "team@lumenpulse.io",
                "source_file": "src/ml/raw.py",
                "features": [
                    {
                        "name": "score",
                        "source_table": "score_view",
                        "upstream": ["src/ingestion/fetcher.py::fetch"],
                    }
                ],
            }
        ],
        "kpi_datasets": [
            {
                "id": "derived_kpi",
                "display_name": "Derived KPI",
                "description": "A KPI derived from raw_features.",
                "owner": "team@lumenpulse.io",
                "source_file": "src/analytics/derive.py",
                "formula": "derived_kpi = score * 2",
                "inputs": [
                    {
                        "name": "score",
                        "upstream": "ml_feature_sets.raw_features.score",
                    }
                ],
                "downstream": ["src/api/server.py (GET /api/derived)"],
            },
            {
                "id": "second_order_kpi",
                "display_name": "Second Order KPI",
                "description": "Depends on derived_kpi only via downstream declaration.",
                "owner": "team@lumenpulse.io",
                "source_file": "src/analytics/second_order.py",
            },
        ],
    }


def test_get_lineage_upstream_and_downstream(synthetic_manifest):
    # Manually wire second_order_kpi as downstream of derived_kpi to prove
    # cross-entry edges resolve regardless of which side declares them.
    synthetic_manifest["kpi_datasets"][0]["downstream"].append("kpi_datasets.second_order_kpi")

    result = get_lineage("derived_kpi", manifest=synthetic_manifest)

    assert result["feature_id"] == "derived_kpi"
    assert result["node"]["kind"] == "kpi_dataset"
    assert result["node"]["transformation"] == "derived_kpi = score * 2"
    assert result["node"]["owning_module"] == "data-processing"

    upstream_ids = {n["id"] for n in result["upstream"]}
    assert "raw_features" in upstream_ids
    # Transitive: the raw feature's own file-level upstream shows up too.
    assert "src/ingestion/fetcher.py::fetch" in upstream_ids

    downstream_ids = {n["id"] for n in result["downstream"]}
    assert "second_order_kpi" in downstream_ids
    assert "src/api/server.py (GET /api/derived)" in downstream_ids


def test_get_lineage_node_metadata_includes_source_and_owner(synthetic_manifest):
    result = get_lineage("raw_features", manifest=synthetic_manifest)
    node = result["node"]
    assert node["source_system"] == ["score_view"]
    assert node["owner"] == "team@lumenpulse.io"
    assert node["owning_module"] == "data-processing"


def test_get_lineage_unknown_id_raises(synthetic_manifest):
    with pytest.raises(LineageNotFoundError):
        get_lineage("nope", manifest=synthetic_manifest)


def test_get_lineage_external_source_whitespace_normalized(synthetic_manifest):
    synthetic_manifest["kpi_datasets"][0]["downstream"][0] = (
        "src/api/server.py            (GET /api/derived)"
    )
    result = get_lineage("derived_kpi", manifest=synthetic_manifest)
    downstream_ids = {n["id"] for n in result["downstream"]}
    assert "src/api/server.py (GET /api/derived)" in downstream_ids
    assert "src/api/server.py            (GET /api/derived)" not in downstream_ids


def test_get_lineage_against_real_manifest_smoke():
    """End-to-end sanity check against the actual feature_lineage.yaml."""
    result = get_lineage("market_health_score")
    assert result["node"]["id"] == "market_health_score"
    upstream_ids = {n["id"] for n in result["upstream"]}
    assert "price_predictor_features" in upstream_ids
    assert "sentiment_compound" in upstream_ids
