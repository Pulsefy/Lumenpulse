"""
Tests for scripts/validate_lineage.py, in particular Rule 8 (issue #1254):
a dotted cross-reference in `upstream`/`downstream` must resolve to a
feature/dataset that still exists in the manifest.
"""

import copy

import pytest

from scripts.validate_lineage import _collect_errors, load_manifest, validate, _MANIFEST


@pytest.fixture
def real_manifest():
    return load_manifest(_MANIFEST)


def test_real_manifest_is_valid(real_manifest):
    """The committed manifest must always pass validation, dangling refs included."""
    ok, _, errors = validate()
    assert ok, f"feature_lineage.yaml has validation errors: {errors}"


def test_dangling_downstream_ref_is_caught(real_manifest):
    manifest = copy.deepcopy(real_manifest)
    for entry in manifest["kpi_datasets"]:
        if entry["id"] == "sentiment_compound":
            entry["downstream"] = ["kpi_datasets.this_id_was_removed"]
            break
    else:
        pytest.fail("fixture assumption broken: sentiment_compound not found")

    errors = _collect_errors(manifest)
    assert any("this_id_was_removed" in e for e in errors)


def test_dangling_upstream_ref_is_caught(real_manifest):
    manifest = copy.deepcopy(real_manifest)
    for entry in manifest["kpi_datasets"]:
        if entry["id"] == "market_health_score":
            entry["inputs"][0]["upstream"] = "ml_feature_sets.this_feature_set_was_removed"
            break
    else:
        pytest.fail("fixture assumption broken: market_health_score not found")

    errors = _collect_errors(manifest)
    assert any("this_feature_set_was_removed" in e for e in errors)


def test_dangling_feature_level_ref_is_caught(real_manifest):
    """A ref to a real entry but a renamed/removed feature within it must also fail."""
    manifest = copy.deepcopy(real_manifest)
    for entry in manifest["kpi_datasets"]:
        if entry["id"] == "market_health_score":
            entry["inputs"][0][
                "upstream"
            ] = "ml_feature_sets.price_predictor_features.no_longer_a_real_feature"
            break
    else:
        pytest.fail("fixture assumption broken: market_health_score not found")

    errors = _collect_errors(manifest)
    assert any("no_longer_a_real_feature" in e for e in errors)


def test_free_text_refs_are_not_flagged(real_manifest):
    """File paths / API routes / module refs must never trigger Rule 8."""
    errors = _collect_errors(real_manifest)
    assert not any("references" in e and "no longer exists" in e for e in errors)
