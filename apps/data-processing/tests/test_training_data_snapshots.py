"""Reproducible training via immutable data snapshots (Issue #1449)."""

import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from src.ml.retraining_pipeline import run_retraining, _fetch_training_data
from src.ml.model_registry import load_metadata, load_model, load_model_card
from src.ml.training_data_snapshot import (
    write_snapshot,
    load_snapshot,
    get_retention_policy,
    estimate_storage_cost,
    apply_retention,
    snapshot_root,
)


def test_snapshot_roundtrip_and_hash(tmp_path, monkeypatch):
    monkeypatch.setenv("TRAINING_SNAPSHOT_PATH", str(tmp_path / "snaps"))
    # re-import path binding is via module-level Path read at call time through snapshot_root
    from src.ml import training_data_snapshot as tds
    monkeypatch.setattr(tds, "_SNAPSHOT_ROOT", tmp_path / "snaps")

    df = pd.DataFrame(
        {
            "sentiment_score": [0.1, -0.2, 0.3],
            "volume": [1000.0, 2000.0, 1500.0],
            "volatility": [0.1, 0.2, 0.15],
            "target": [0.0, 0.1, -0.1],
        }
    )
    ref1 = write_snapshot(df, source="test", query_bounds={"start_time": "a"}, seed=7)
    ref2 = write_snapshot(df, source="test", query_bounds={"start_time": "a"}, seed=7)
    assert ref1["snapshot_id"] == ref2["snapshot_id"]
    assert ref1["content_hash"] == ref2["content_hash"]

    loaded, manifest = load_snapshot(ref1["snapshot_id"])
    pd.testing.assert_frame_equal(
        loaded.reindex(sorted(loaded.columns), axis=1).reset_index(drop=True),
        df.reindex(sorted(df.columns), axis=1).reset_index(drop=True),
    )
    assert manifest["content_hash"] == ref1["content_hash"]


def test_retention_policy_and_cost_estimate():
    policy = get_retention_policy()
    assert policy["retention_days"] >= 1
    assert policy["immutable"] is True
    assert "deletion_policy" in policy
    cost = estimate_storage_cost(bytes_used=5 * 1024 * 1024)
    assert "estimated_usd_per_month" in cost
    assert cost["bytes_used"] == 5 * 1024 * 1024


def test_fetch_writes_snapshot_and_replay_skips_live(tmp_path, monkeypatch):
    from src.ml import training_data_snapshot as tds

    monkeypatch.setattr(tds, "_SNAPSHOT_ROOT", tmp_path / "snaps")

    df1, bounds1, snap1 = _fetch_training_data(seed=42)
    assert snap1["snapshot_id"]
    assert snap1["content_hash"]
    assert (tmp_path / "snaps" / f"{snap1['snapshot_id']}.csv").exists()

    # Mutate "live" path by requesting a different seed without snapshot — different data.
    df_other, _, snap_other = _fetch_training_data(seed=99)
    assert snap_other["snapshot_id"] != snap1["snapshot_id"]

    # Replay original snapshot — must match df1 exactly even if seed differs.
    df2, bounds2, snap2 = _fetch_training_data(seed=999, snapshot_ref=snap1)
    pd.testing.assert_frame_equal(df1.reset_index(drop=True), df2.reset_index(drop=True))
    assert snap2["snapshot_id"] == snap1["snapshot_id"]


def test_reproducible_training_across_two_manifest_runs(tmp_path, monkeypatch):
    """Acceptance: two runs of the same manifest produce an identical artefact."""
    from src.ml import training_data_snapshot as tds
    from src.ml import model_registry as registry

    monkeypatch.setattr(tds, "_SNAPSHOT_ROOT", tmp_path / "snaps")
    monkeypatch.setattr(registry, "_MODELS_ROOT", tmp_path / "models")

    result1 = run_retraining(force=True, seed=42)
    assert result1["status"] == "completed"
    price1 = result1["models"]["price_predictor"]
    assert price1["promoted"] is True
    version1 = price1["version"]
    metadata1 = load_metadata("price_predictor", version1)

    assert metadata1["snapshot_id"]
    assert metadata1["snapshot_ref"]["snapshot_id"] == metadata1["snapshot_id"]
    assert metadata1["snapshot_ref"]["content_hash"]
    assert "training_data_retention" in metadata1

    card = load_model_card("price_predictor", version1)
    assert card is not None
    training = card.get("training_data") or {}
    assert training.get("snapshot_id") == metadata1["snapshot_id"]
    assert training.get("snapshot_hash") == metadata1["snapshot_hash"]
    assert training.get("snapshot_uri")

    # Second run from the recorded manifest (includes snapshot_ref).
    result2 = run_retraining(force=True, manifest=metadata1)
    assert result2["status"] == "completed"
    version2 = result2["models"]["price_predictor"]["version"]
    metadata2 = load_metadata("price_predictor", version2)

    assert metadata1["seed"] == metadata2["seed"]
    assert metadata1["snapshot_id"] == metadata2["snapshot_id"]
    assert metadata1["data_query_bounds"] == metadata2["data_query_bounds"]
    assert metadata1["row_count"] == metadata2["row_count"]
    assert metadata1["metrics"] == metadata2["metrics"]
    assert metadata1["feature_baseline"] == metadata2["feature_baseline"]

    model1 = load_model("price_predictor", version1)
    model2 = load_model("price_predictor", version2)
    coef1 = model1.pipeline.named_steps["regressor"].coef_
    coef2 = model2.pipeline.named_steps["regressor"].coef_
    np.testing.assert_array_almost_equal(coef1, coef2)
