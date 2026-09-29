# -*- coding: utf-8 -*-
"""Tests for the versioned feature-set schema (#1239)."""

import pytest

from src.ml.feature_schema import (
    PRICE_PREDICTOR_FEATURE_SET,
    FeatureSchema,
    FeatureSpec,
    SchemaVersionMismatch,
    check_serving_schema,
    current_feature_schema,
    get_enforcement_mode,
    schema_metadata,
    validate_frame_columns,
)


def test_price_predictor_schema_is_registered():
    schema = current_feature_schema(PRICE_PREDICTOR_FEATURE_SET)
    assert schema.version == "1.0"
    assert schema.feature_names == ["sentiment_score", "volume", "volatility"]


def test_unknown_feature_set_raises():
    with pytest.raises(KeyError, match="No registered feature schema"):
        current_feature_schema("does_not_exist")


def test_fingerprint_is_deterministic_and_short():
    s1 = current_feature_schema()
    s2 = current_feature_schema()
    assert s1.fingerprint == s2.fingerprint
    assert len(s1.fingerprint) == 12


def test_fingerprint_changes_when_columns_change():
    base = current_feature_schema()
    # Same version, but an added column -> different fingerprint (catches
    # accidental structural drift even when the version is not bumped).
    mutated = FeatureSchema(
        feature_set=base.feature_set,
        version=base.version,
        features=tuple(base.features) + (FeatureSpec("new_feature", "float64"),),
    )
    assert mutated.version == base.version
    assert mutated.fingerprint != base.fingerprint


def test_fingerprint_changes_when_dtype_changes():
    base = current_feature_schema()
    retyped = FeatureSchema(
        feature_set=base.feature_set,
        version=base.version,
        features=tuple(
            FeatureSpec(f.name, "int64" if f.name == "volume" else f.dtype)
            for f in base.features
        ),
    )
    assert retyped.fingerprint != base.fingerprint


def test_schema_metadata_shape():
    meta = schema_metadata()
    assert meta["feature_set"] == PRICE_PREDICTOR_FEATURE_SET
    assert meta["schema_version"] == "1.0"
    assert meta["schema_fingerprint"] == current_feature_schema().fingerprint


def test_validate_frame_columns_reports_missing():
    missing = validate_frame_columns(["sentiment_score", "volume"])
    assert missing == ["volatility"]
    assert validate_frame_columns(["timestamp", "sentiment_score", "volume", "volatility", "target"]) == []


# ── serving-vs-training enforcement ────────────────────────────────────────

def test_matching_versions_pass(monkeypatch):
    monkeypatch.setenv("FEATURE_SCHEMA_ENFORCEMENT", "strict")
    assert check_serving_schema("1.0", "1.0") is True


def test_none_serving_defaults_to_current(monkeypatch):
    monkeypatch.setenv("FEATURE_SCHEMA_ENFORCEMENT", "strict")
    # serving_version None -> falls back to current schema version ("1.0")
    assert check_serving_schema("1.0", None) is True


def test_legacy_model_without_training_version_is_allowed(monkeypatch):
    monkeypatch.setenv("FEATURE_SCHEMA_ENFORCEMENT", "strict")
    assert check_serving_schema(None, "1.0") is True


def test_mismatch_strict_raises(monkeypatch):
    monkeypatch.setenv("FEATURE_SCHEMA_ENFORCEMENT", "strict")
    with pytest.raises(SchemaVersionMismatch) as exc:
        check_serving_schema("1.0", "2.0")
    assert exc.value.training_version == "1.0"
    assert exc.value.serving_version == "2.0"


def test_mismatch_warn_returns_false(monkeypatch):
    monkeypatch.setenv("FEATURE_SCHEMA_ENFORCEMENT", "warn")
    assert check_serving_schema("1.0", "2.0") is False


def test_default_enforcement_is_warn(monkeypatch):
    monkeypatch.delenv("FEATURE_SCHEMA_ENFORCEMENT", raising=False)
    assert get_enforcement_mode() == "warn"
    # default (warn) must not raise on a mismatch
    assert check_serving_schema("1.0", "9.9") is False


def test_unknown_enforcement_falls_back_to_warn(monkeypatch):
    monkeypatch.setenv("FEATURE_SCHEMA_ENFORCEMENT", "banana")
    assert get_enforcement_mode() == "warn"
