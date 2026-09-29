import pytest
import pandas as pd
from datetime import datetime, timezone
import json
import numpy as np

from src.ml.retraining_pipeline import run_retraining, _build_price_predictor
from src.ml.model_registry import load_metadata, load_model

def test_reproducible_training():
    # Run once to get a manifest
    result1 = run_retraining(force=True, seed=42)
    
    assert result1["status"] == "completed"
    
    models1 = result1["models"]
    price_predictor1 = models1.get("price_predictor")
    assert price_predictor1 is not None
    assert price_predictor1["promoted"] is True
    
    version1 = price_predictor1["version"]
    metadata1 = load_metadata("price_predictor", version1)
    
    assert "seed" in metadata1
    assert metadata1["seed"] == 42
    assert "data_query_bounds" in metadata1
    assert "row_count" in metadata1
    
    # Extract the manifest which is just the metadata
    manifest = metadata1
    
    # Run again with the same manifest
    result2 = run_retraining(force=True, manifest=manifest)
    
    assert result2["status"] == "completed"
    
    models2 = result2["models"]
    price_predictor2 = models2.get("price_predictor")
    assert price_predictor2 is not None
    
    version2 = price_predictor2["version"]
    metadata2 = load_metadata("price_predictor", version2)
    
    # Verify the seeds and bounds are identical
    assert metadata1["seed"] == metadata2["seed"]
    assert metadata1["data_query_bounds"] == metadata2["data_query_bounds"]
    assert metadata1["row_count"] == metadata2["row_count"]
    
    # Assert models are identical by comparing metrics, feature_baseline
    assert metadata1["metrics"] == metadata2["metrics"]
    assert metadata1["feature_baseline"] == metadata2["feature_baseline"]
    
    # We can also compare model weights directly
    model1 = load_model("price_predictor", version1)
    model2 = load_model("price_predictor", version2)
    
    coef1 = model1.pipeline.named_steps["regressor"].coef_
    coef2 = model2.pipeline.named_steps["regressor"].coef_
    
    np.testing.assert_array_almost_equal(coef1, coef2)
