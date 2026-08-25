# -*- coding: utf-8 -*-
"""
Tests for the holdout evaluation integration in
src/ml/retraining_pipeline.py (Issue Wave 8).

Verifies that:
  - _score_to_label() maps compound scores to the correct label string
  - _compute_prf() produces correct precision, recall, and F1 values
  - _evaluate_sentiment_on_holdout() returns the expected metric keys
  - run_retraining() output includes a "holdout_eval" dict with
    precision, recall, and F1 fields
  - The pipeline still completes (status == "completed") when no eval
    labels are present (graceful degradation)
"""

from __future__ import annotations

from typing import Any, Dict, List
from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Import the pipeline module; skip tests if deps are missing
# ---------------------------------------------------------------------------
_PIPELINE_AVAILABLE = False
try:
    from src.ml.retraining_pipeline import (
        _compute_prf,
        _evaluate_sentiment_on_holdout,
        _score_to_label,
        run_retraining,
    )

    _PIPELINE_AVAILABLE = True
except (ImportError, Exception):
    pass

skip_without_pipeline = pytest.mark.skipif(
    not _PIPELINE_AVAILABLE, reason="retraining_pipeline module or its deps not available"
)

# ---------------------------------------------------------------------------
# _score_to_label
# ---------------------------------------------------------------------------


@skip_without_pipeline
def test_score_to_label_positive():
    assert _score_to_label(0.5) == "positive"
    assert _score_to_label(0.05) == "positive"


@skip_without_pipeline
def test_score_to_label_negative():
    assert _score_to_label(-0.5) == "negative"
    assert _score_to_label(-0.05) == "negative"


@skip_without_pipeline
def test_score_to_label_neutral():
    assert _score_to_label(0.0) == "neutral"
    assert _score_to_label(0.04) == "neutral"
    assert _score_to_label(-0.04) == "neutral"


# ---------------------------------------------------------------------------
# _compute_prf  (pure-Python, no DB needed)
# ---------------------------------------------------------------------------


@skip_without_pipeline
def test_compute_prf_perfect_predictions():
    y_true = ["positive", "negative", "neutral"]
    y_pred = ["positive", "negative", "neutral"]
    result = _compute_prf(y_true, y_pred)

    assert result["macro_f1"] == 1.0
    assert result["macro_precision"] == 1.0
    assert result["macro_recall"] == 1.0
    assert result["accuracy"] == 1.0
    assert result["sample_count"] == 3


@skip_without_pipeline
def test_compute_prf_all_wrong():
    y_true = ["positive", "positive", "positive"]
    y_pred = ["negative", "negative", "negative"]
    result = _compute_prf(y_true, y_pred, labels=["positive", "negative"])

    # Zero precision/recall/F1 for positive; varying for negative
    assert result["per_class"]["positive"]["recall"] == 0.0
    assert result["per_class"]["positive"]["precision"] == 0.0
    assert result["sample_count"] == 3


@skip_without_pipeline
def test_compute_prf_empty_inputs():
    result = _compute_prf([], [])
    assert result["sample_count"] == 0
    assert result["macro_f1"] == 0.0
    assert result["accuracy"] == 0.0


@skip_without_pipeline
def test_compute_prf_per_class_keys():
    y_true = ["positive", "negative", "neutral", "positive"]
    y_pred = ["positive", "negative", "negative", "positive"]
    result = _compute_prf(y_true, y_pred)

    for cls in ["positive", "negative", "neutral"]:
        assert cls in result["per_class"]
        per = result["per_class"][cls]
        assert "precision" in per
        assert "recall" in per
        assert "f1" in per
        assert "support" in per


@skip_without_pipeline
def test_compute_prf_f1_formula():
    """F1 = 2 * P * R / (P + R) for each class."""
    # 2 TP, 0 FP, 0 FN for positive  →  P=1, R=1, F1=1
    y_true = ["positive", "positive", "negative"]
    y_pred = ["positive", "positive", "negative"]
    result = _compute_prf(y_true, y_pred)
    assert result["per_class"]["positive"]["f1"] == 1.0
    assert result["per_class"]["negative"]["f1"] == 1.0


@skip_without_pipeline
def test_compute_prf_accuracy():
    y_true = ["positive", "positive", "negative", "negative"]
    y_pred = ["positive", "negative", "negative", "negative"]  # 3 correct / 4
    result = _compute_prf(y_true, y_pred)
    assert result["accuracy"] == pytest.approx(0.75, abs=1e-4)


# ---------------------------------------------------------------------------
# _evaluate_sentiment_on_holdout
# ---------------------------------------------------------------------------


@skip_without_pipeline
def test_evaluate_returns_no_eval_when_store_empty():
    """When the label store has no eval rows, the function returns eval_available=False."""
    mock_store = MagicMock()
    mock_store.get_eval_split.return_value = []

    # The function does local imports; patch at the source modules
    with patch("src.db.label_store.LabelStore", return_value=mock_store), \
         patch("sqlalchemy.create_engine", MagicMock(return_value=MagicMock())), \
         patch("sqlalchemy.orm.Session", MagicMock(return_value=MagicMock())):
        # Provide a db_session so the internal engine path is skipped
        fake_session = MagicMock()
        with patch("src.ml.retraining_pipeline.LabelStore", return_value=mock_store):
            mock_analyzer = MagicMock()
            result = _evaluate_sentiment_on_holdout(mock_analyzer, db_session=fake_session)

    assert result["eval_available"] is False
    assert result["sample_count"] == 0


@skip_without_pipeline
def test_evaluate_returns_metrics_keys():
    """When eval rows are present the result contains all required metric keys."""
    fake_row = MagicMock()
    fake_row.text = "Bitcoin is crashing"
    fake_row.label = "negative"

    mock_store = MagicMock()
    mock_store.get_eval_split.return_value = [fake_row]

    mock_analyzer = MagicMock()
    # Simulate VADER returning a negative compound
    mock_analyzer.polarity_scores.return_value = {"compound": -0.6}

    fake_session = MagicMock()
    with patch("src.ml.retraining_pipeline.LabelStore", return_value=mock_store):
        result = _evaluate_sentiment_on_holdout(mock_analyzer, db_session=fake_session)

    required_keys = {
        "eval_available",
        "macro_f1",
        "macro_precision",
        "macro_recall",
        "accuracy",
        "sample_count",
        "per_class",
    }
    assert required_keys.issubset(result.keys()), (
        f"Missing keys: {required_keys - result.keys()}"
    )
    assert result["eval_available"] is True
    assert result["sample_count"] == 1


@skip_without_pipeline
def test_evaluate_with_provided_session():
    """Passing a db_session skips the internal engine creation."""
    fake_row = MagicMock()
    fake_row.text = "Stellar rallies"
    fake_row.label = "positive"

    mock_store = MagicMock()
    mock_store.get_eval_split.return_value = [fake_row]

    mock_analyzer = MagicMock()
    mock_analyzer.polarity_scores.return_value = {"compound": 0.8}

    mock_session = MagicMock()

    with patch("src.ml.retraining_pipeline.LabelStore", return_value=mock_store):
        result = _evaluate_sentiment_on_holdout(mock_analyzer, db_session=mock_session)

    assert result["eval_available"] is True
    assert result["sample_count"] == 1
    # Correct prediction: positive predicted → positive true
    assert result["accuracy"] == 1.0


@skip_without_pipeline
def test_evaluate_handles_exception_gracefully():
    """If something goes wrong, the function returns eval_available=False rather than raising."""
    mock_analyzer = MagicMock()

    # Pass a session that raises when LabelStore is instantiated
    with patch("src.ml.retraining_pipeline.LabelStore", side_effect=RuntimeError("DB down")):
        fake_session = MagicMock()
        result = _evaluate_sentiment_on_holdout(mock_analyzer, db_session=fake_session)

    assert result["eval_available"] is False


# ---------------------------------------------------------------------------
# run_retraining — integration-level checks (all heavy deps mocked)
# ---------------------------------------------------------------------------


def _make_retrain_mocks():
    """Return a dict of patches needed to run run_retraining() in isolation."""
    return {
        "src.ml.retraining_pipeline.save_model": MagicMock(return_value="v1"),
        "src.ml.retraining_pipeline.promote_model": MagicMock(),
        "src.ml.retraining_pipeline.get_registry_status": MagicMock(return_value={}),
        "src.ml.retraining_pipeline.get_current_version": MagicMock(return_value="v0"),
        "src.ml.retraining_pipeline.MODEL_RETRAINING_DURATION": MagicMock(
            __enter__=MagicMock(), __exit__=MagicMock()
        ),
        "src.ml.retraining_pipeline.MODEL_RETRAINING_TOTAL": MagicMock(),
        "src.ml.retraining_pipeline.JOBS_RUN_TOTAL": MagicMock(),
        "src.ml.retraining_pipeline._build_price_predictor": MagicMock(
            return_value=(MagicMock(), {"r2": 0.9}, {"schema_version": 1, "schema_fingerprint": "abc"})
        ),
        "src.ml.retraining_pipeline._build_sentiment_model": MagicMock(
            return_value=(MagicMock(), {"coverage_ratio": 0.1, "custom_terms_added": 5, "total_lexicon_size": 1000, "base_lexicon_size": 995})
        ),
        "src.ml.retraining_pipeline._evaluate_sentiment_on_holdout": MagicMock(
            return_value={
                "eval_available": True,
                "macro_precision": 0.75,
                "macro_recall": 0.70,
                "macro_f1": 0.72,
                "accuracy": 0.73,
                "sample_count": 10,
                "per_class": {
                    "positive": {"precision": 0.8, "recall": 0.75, "f1": 0.77, "support": 3},
                    "negative": {"precision": 0.7, "recall": 0.65, "f1": 0.67, "support": 4},
                    "neutral":  {"precision": 0.75, "recall": 0.70, "f1": 0.72, "support": 3},
                },
            }
        ),
    }


@skip_without_pipeline
def test_run_retraining_completes_successfully():
    """run_retraining() should return status='completed' with all mocks in place."""
    mocks = _make_retrain_mocks()
    # Patch the duration context manager properly
    cm = MagicMock()
    cm.__enter__ = MagicMock(return_value=cm)
    cm.__exit__ = MagicMock(return_value=False)
    mocks["src.ml.retraining_pipeline.MODEL_RETRAINING_DURATION"] = MagicMock(
        labels=MagicMock(return_value=cm)
    )

    with patch.multiple("src.ml.retraining_pipeline", **{
        k.split(".")[-1]: v for k, v in mocks.items()
    }):
        result = run_retraining(force=True)

    assert result["status"] == "completed"


@skip_without_pipeline
def test_run_retraining_output_has_holdout_eval():
    """
    The 'sentiment' section of the run_retraining output must include a
    'holdout_eval' dict containing macro_f1, macro_precision, and macro_recall.
    """
    mocks = _make_retrain_mocks()
    cm = MagicMock()
    cm.__enter__ = MagicMock(return_value=cm)
    cm.__exit__ = MagicMock(return_value=False)
    mocks["src.ml.retraining_pipeline.MODEL_RETRAINING_DURATION"] = MagicMock(
        labels=MagicMock(return_value=cm)
    )

    with patch.multiple("src.ml.retraining_pipeline", **{
        k.split(".")[-1]: v for k, v in mocks.items()
    }):
        result = run_retraining(force=True)

    sentiment_result = result["models"]["sentiment"]
    assert "holdout_eval" in sentiment_result, (
        f"'holdout_eval' key missing from sentiment result: {list(sentiment_result.keys())}"
    )

    holdout = sentiment_result["holdout_eval"]
    for key in ("macro_f1", "macro_precision", "macro_recall"):
        assert key in holdout, f"'{key}' missing from holdout_eval: {list(holdout.keys())}"


@skip_without_pipeline
def test_run_retraining_holdout_f1_gate_blocks_promotion():
    """
    When MIN_SENTIMENT_F1 is set high and eval F1 is low,
    the model should NOT be promoted.
    """
    mocks = _make_retrain_mocks()
    # Override F1 to be very low
    mocks["src.ml.retraining_pipeline._evaluate_sentiment_on_holdout"] = MagicMock(
        return_value={
            "eval_available": True,
            "macro_f1": 0.10,
            "macro_precision": 0.15,
            "macro_recall": 0.10,
            "accuracy": 0.12,
            "sample_count": 10,
            "per_class": {},
        }
    )

    cm = MagicMock()
    cm.__enter__ = MagicMock(return_value=cm)
    cm.__exit__ = MagicMock(return_value=False)
    mocks["src.ml.retraining_pipeline.MODEL_RETRAINING_DURATION"] = MagicMock(
        labels=MagicMock(return_value=cm)
    )

    with patch.multiple("src.ml.retraining_pipeline", **{
        k.split(".")[-1]: v for k, v in mocks.items()
    }), patch.dict("os.environ", {"MIN_SENTIMENT_F1": "0.99"}):
        # Re-import to pick up new env var (or override module constant)
        import src.ml.retraining_pipeline as pipeline_mod
        original = pipeline_mod._MIN_SENTIMENT_F1
        pipeline_mod._MIN_SENTIMENT_F1 = 0.99
        try:
            result = run_retraining(force=False)
        finally:
            pipeline_mod._MIN_SENTIMENT_F1 = original

    sentiment_result = result["models"]["sentiment"]
    assert sentiment_result["promoted"] is False
    assert "f1" in sentiment_result.get("reason", "").lower() or \
           "gate" in sentiment_result.get("reason", "").lower()


@skip_without_pipeline
def test_run_retraining_no_eval_data_still_promotes():
    """
    When the label store has no eval examples (eval_available=False),
    the F1 gate is skipped and the model is promoted if coverage passes.
    """
    mocks = _make_retrain_mocks()
    mocks["src.ml.retraining_pipeline._evaluate_sentiment_on_holdout"] = MagicMock(
        return_value={
            "eval_available": False,
            "macro_f1": None,
            "macro_precision": None,
            "macro_recall": None,
            "accuracy": None,
            "sample_count": 0,
            "per_class": {},
            "note": "No held-out eval examples found in the label store",
        }
    )

    cm = MagicMock()
    cm.__enter__ = MagicMock(return_value=cm)
    cm.__exit__ = MagicMock(return_value=False)
    mocks["src.ml.retraining_pipeline.MODEL_RETRAINING_DURATION"] = MagicMock(
        labels=MagicMock(return_value=cm)
    )

    with patch.multiple("src.ml.retraining_pipeline", **{
        k.split(".")[-1]: v for k, v in mocks.items()
    }):
        result = run_retraining(force=False)

    # Coverage gate is 0.0 by default → should promote
    assert result["models"]["sentiment"]["promoted"] is True
    # But holdout_eval should still be present in the output
    assert "holdout_eval" in result["models"]["sentiment"]


@skip_without_pipeline
def test_run_retraining_holdout_eval_values_match_mock():
    """The holdout_eval values in the output exactly mirror what _evaluate returns."""
    expected_holdout = {
        "eval_available": True,
        "macro_precision": 0.80,
        "macro_recall": 0.78,
        "macro_f1": 0.79,
        "accuracy": 0.81,
        "sample_count": 15,
        "per_class": {
            "positive": {"precision": 0.85, "recall": 0.80, "f1": 0.82, "support": 5},
            "negative": {"precision": 0.75, "recall": 0.73, "f1": 0.74, "support": 5},
            "neutral":  {"precision": 0.80, "recall": 0.81, "f1": 0.80, "support": 5},
        },
    }

    mocks = _make_retrain_mocks()
    mocks["src.ml.retraining_pipeline._evaluate_sentiment_on_holdout"] = MagicMock(
        return_value=expected_holdout
    )

    cm = MagicMock()
    cm.__enter__ = MagicMock(return_value=cm)
    cm.__exit__ = MagicMock(return_value=False)
    mocks["src.ml.retraining_pipeline.MODEL_RETRAINING_DURATION"] = MagicMock(
        labels=MagicMock(return_value=cm)
    )

    with patch.multiple("src.ml.retraining_pipeline", **{
        k.split(".")[-1]: v for k, v in mocks.items()
    }):
        result = run_retraining(force=True)

    actual_holdout = result["models"]["sentiment"]["holdout_eval"]
    assert actual_holdout["macro_f1"] == expected_holdout["macro_f1"]
    assert actual_holdout["macro_precision"] == expected_holdout["macro_precision"]
    assert actual_holdout["macro_recall"] == expected_holdout["macro_recall"]
    assert actual_holdout["sample_count"] == expected_holdout["sample_count"]
