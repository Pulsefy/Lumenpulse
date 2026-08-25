# -*- coding: utf-8 -*-
"""Tests for the model-registry metadata sidecar (#1239)."""

import importlib

import pytest


@pytest.fixture
def registry(tmp_path, monkeypatch):
    """Fresh model_registry bound to an isolated on-disk root per test."""
    monkeypatch.setenv("MODEL_REGISTRY_PATH", str(tmp_path / "models"))
    import src.ml.model_registry as reg

    importlib.reload(reg)
    return reg


def test_save_without_metadata_writes_no_sidecar(registry):
    version = registry.save_model("price_predictor", {"weights": [1, 2, 3]})
    assert registry.load_metadata("price_predictor", version) is None


def test_save_and_load_metadata_roundtrip(registry):
    meta = {
        "schema_version": "1.0",
        "schema_fingerprint": "859b0372d5c0",
        "feature_baseline": {"sentiment_score": {"mean": 0.1}},
    }
    version = registry.save_model("price_predictor", {"m": 1}, metadata=meta)

    loaded = registry.load_metadata("price_predictor", version)
    assert loaded["schema_version"] == "1.0"
    assert loaded["schema_fingerprint"] == "859b0372d5c0"
    assert loaded["feature_baseline"]["sentiment_score"]["mean"] == 0.1
    # auto-stamped fields
    assert loaded["model_type"] == "price_predictor"
    assert loaded["version"] == version
    assert "saved_at" in loaded


def test_load_metadata_current_follows_promotion(registry):
    v1 = registry.save_model("price_predictor", {"m": 1}, metadata={"schema_version": "1.0"})
    v2 = registry.save_model("price_predictor", {"m": 2}, metadata={"schema_version": "2.0"})
    registry.promote_model("price_predictor", v2)

    current = registry.load_metadata("price_predictor", "current")
    assert current["schema_version"] == "2.0"
    assert current["version"] == v2
    # the older version's metadata is still individually addressable
    assert registry.load_metadata("price_predictor", v1)["schema_version"] == "1.0"


def test_load_metadata_current_none_when_nothing_promoted(registry):
    registry.save_model("price_predictor", {"m": 1}, metadata={"schema_version": "1.0"})
    # no promote_model call -> no "current" symlink
    assert registry.load_metadata("price_predictor", "current") is None


def test_registry_status_includes_current_metadata(registry):
    v = registry.save_model("price_predictor", {"m": 1}, metadata={"schema_version": "1.0"})
    registry.promote_model("price_predictor", v)
    status = registry.get_registry_status()
    assert status["price_predictor"]["current_metadata"]["schema_version"] == "1.0"
