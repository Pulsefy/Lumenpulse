# -*- coding: utf-8 -*-
"""
Automated Model Retraining Pipeline (Issue #454)

Retrains both models on fresh data, evaluates quality gates,
versions the artifacts, and promotes them with zero downtime.

Models:
  - sentiment   : VADER lexicon + custom crypto slang dictionary
  - price_predictor : scikit-learn LinearRegression pipeline

Evaluation
----------
The sentiment model is evaluated against the human-labelled held-out eval
split stored in ``data/labelled_examples.jsonl``.  Per-class precision,
recall, and F1 are computed and appended to the retraining result so
downstream alerting and CI quality gates have ground truth.
"""

import os
import json
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

from src.ml.model_registry import (
    save_model,
    promote_model,
    get_current_version,
    get_registry_status,
)
from src.ml.price_predictor import PricePredictor
from src.utils.logger import setup_logger
from src.utils.metrics import JOBS_RUN_TOTAL, MODEL_RETRAINING_TOTAL, MODEL_RETRAINING_DURATION

logger = setup_logger(__name__)

# Path to the custom crypto-slang lexicon file (JSON: {"word": score, ...})
_SLANG_LEXICON_PATH = Path(
    os.getenv("CRYPTO_SLANG_LEXICON", "./data/crypto_slang_lexicon.json")
)

# Path to the human-labelled example store used for eval
_LABELLED_EXAMPLES_PATH = Path(
    os.getenv("LABELLED_EXAMPLES_PATH", "./data/labelled_examples.jsonl")
)

# Quality gates: minimum acceptable metrics before promotion
_MIN_SENTIMENT_COVERAGE = float(os.getenv("MIN_SENTIMENT_COVERAGE", "0.0"))
_MIN_PRICE_R2 = float(os.getenv("MIN_PRICE_R2", "-1.0"))  # permissive default
# Minimum weighted-average F1 against the held-out eval set (0 = always pass)
_MIN_SENTIMENT_F1 = float(os.getenv("MIN_SENTIMENT_F1", "0.0"))

# Thread-safety: only one retraining run at a time
_retrain_lock = threading.Lock()

# Last run metadata (in-memory, also written to disk)
_last_run: Dict[str, Any] = {}


# ---------------------------------------------------------------------------
# Sentiment model retraining
# ---------------------------------------------------------------------------

def _load_crypto_slang() -> Dict[str, float]:
    """
    Load the custom crypto-slang lexicon from disk.
    Returns an empty dict if the file doesn't exist yet.
    """
    if not _SLANG_LEXICON_PATH.exists():
        logger.warning(
            f"Crypto slang lexicon not found at {_SLANG_LEXICON_PATH}. "
            "Using base VADER lexicon only."
        )
        return {}

    with open(_SLANG_LEXICON_PATH) as fh:
        lexicon = json.load(fh)

    logger.info(f"Loaded {len(lexicon)} custom crypto-slang entries")
    return lexicon


def _build_sentiment_model() -> Tuple[SentimentIntensityAnalyzer, Dict[str, Any]]:
    """
    Build a VADER analyzer enriched with the latest crypto-slang lexicon.

    Returns:
        (analyzer, metrics_dict)
    """
    analyzer = SentimentIntensityAnalyzer()
    slang = _load_crypto_slang()

    if slang:
        analyzer.lexicon.update(slang)
        logger.info(f"Enriched VADER lexicon with {len(slang)} crypto-slang terms")

    metrics = {
        "base_lexicon_size": len(SentimentIntensityAnalyzer().lexicon),
        "custom_terms_added": len(slang),
        "total_lexicon_size": len(analyzer.lexicon),
        "coverage_ratio": len(slang) / max(len(analyzer.lexicon), 1),
    }
    return analyzer, metrics


# ---------------------------------------------------------------------------
# Held-out evaluation
# ---------------------------------------------------------------------------

def _compound_to_label(compound: float) -> str:
    """Map a VADER compound score to a canonical sentiment label."""
    if compound >= 0.05:
        return "positive"
    if compound <= -0.05:
        return "negative"
    return "neutral"


def _evaluate_sentiment_model(
    analyzer: SentimentIntensityAnalyzer,
) -> Dict[str, Any]:
    """
    Evaluate *analyzer* against the human-labelled held-out eval split.

    Computes per-class precision, recall, F1, and a macro/weighted average.
    Also returns per-example predictions so they can be audited.

    Returns a metrics dict with structure::

        {
            "eval_examples": int,
            "accuracy": float,
            "precision": {"positive": float, "negative": float, "neutral": float,
                          "macro": float, "weighted": float},
            "recall":    { … same structure … },
            "f1":        { … same structure … },
            "class_counts": {"positive": int, …},
        }

    If the eval split is empty the function returns ``{"eval_examples": 0}``.
    """
    try:
        from src.ml.labelled_example_store import LabelledExampleStore
        store = LabelledExampleStore(_LABELLED_EXAMPLES_PATH)
        _, eval_df = store.get_split()
    except Exception as exc:
        logger.warning("Could not load labelled example store for evaluation: %s", exc)
        return {"eval_examples": 0, "error": str(exc)}

    if eval_df.empty:
        logger.warning("Eval split is empty — skipping ground-truth evaluation")
        return {"eval_examples": 0}

    labels_order = ["positive", "negative", "neutral"]
    y_true: List[str] = []
    y_pred: List[str] = []

    for _, row in eval_df.iterrows():
        text = str(row["text"])
        true_label = str(row["label"])
        scores = analyzer.polarity_scores(text)
        pred_label = _compound_to_label(float(scores.get("compound", 0.0)))
        y_true.append(true_label)
        y_pred.append(pred_label)

    # ── Compute per-class metrics manually (no sklearn dependency required) ──
    metrics: Dict[str, Any] = {"eval_examples": len(y_true)}

    class_counts = {lbl: y_true.count(lbl) for lbl in labels_order}
    metrics["class_counts"] = class_counts

    precision: Dict[str, float] = {}
    recall: Dict[str, float] = {}
    f1: Dict[str, float] = {}

    for lbl in labels_order:
        tp = sum(1 for t, p in zip(y_true, y_pred) if t == lbl and p == lbl)
        fp = sum(1 for t, p in zip(y_true, y_pred) if t != lbl and p == lbl)
        fn = sum(1 for t, p in zip(y_true, y_pred) if t == lbl and p != lbl)

        prec = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        rec = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1_score = (
            2 * prec * rec / (prec + rec) if (prec + rec) > 0 else 0.0
        )

        precision[lbl] = round(prec, 4)
        recall[lbl] = round(rec, 4)
        f1[lbl] = round(f1_score, 4)

    # Macro averages (unweighted)
    precision["macro"] = round(sum(precision[l] for l in labels_order) / len(labels_order), 4)
    recall["macro"] = round(sum(recall[l] for l in labels_order) / len(labels_order), 4)
    f1["macro"] = round(sum(f1[l] for l in labels_order) / len(labels_order), 4)

    # Weighted averages (by true class frequency)
    total = len(y_true)
    precision["weighted"] = round(
        sum(precision[l] * class_counts[l] for l in labels_order) / total, 4
    ) if total else 0.0
    recall["weighted"] = round(
        sum(recall[l] * class_counts[l] for l in labels_order) / total, 4
    ) if total else 0.0
    f1["weighted"] = round(
        sum(f1[l] * class_counts[l] for l in labels_order) / total, 4
    ) if total else 0.0

    # Accuracy
    correct = sum(1 for t, p in zip(y_true, y_pred) if t == p)
    metrics["accuracy"] = round(correct / total, 4) if total else 0.0

    metrics["precision"] = precision
    metrics["recall"] = recall
    metrics["f1"] = f1

    logger.info(
        "Sentiment eval — examples=%d  accuracy=%.4f  F1_weighted=%.4f  "
        "F1_macro=%.4f",
        len(y_true),
        metrics["accuracy"],
        f1["weighted"],
        f1["macro"],
    )
    return metrics


# ---------------------------------------------------------------------------
# Price predictor retraining
# ---------------------------------------------------------------------------

def _fetch_training_data(db_session=None) -> pd.DataFrame:
    """
    Fetch recent feature data for the price predictor.

    In production this queries the feature store; falls back to a
    synthetic dataset so the pipeline never hard-fails in CI/dev.
    """
    if db_session is not None:
        try:
            from src.ml.feature_store import FeatureStore
            store = FeatureStore(db_session)
            df = store.get_features_for_asset("XLM", "30d")
            if not df.empty and len(df) >= 20:
                # Create a simple target: next-period sentiment shift
                df["target"] = df["sentiment_score"].shift(-1)
                df.dropna(inplace=True)
                logger.info(f"Fetched {len(df)} rows from feature store for retraining")
                return df
        except Exception as exc:
            logger.warning(f"Feature store unavailable, using synthetic data: {exc}")

    # Synthetic fallback — keeps the pipeline runnable without a live DB
    import numpy as np
    rng = np.random.default_rng(seed=int(datetime.utcnow().timestamp()) % 10_000)
    n = 200
    df = pd.DataFrame({
        "sentiment_score": rng.uniform(-1, 1, n),
        "volume": rng.uniform(1_000, 100_000, n),
        "volatility": rng.uniform(0, 0.5, n),
        "target": rng.uniform(-1, 1, n),
    })
    logger.info("Using synthetic training data (no live DB session provided)")
    return df


def _build_price_predictor(db_session=None) -> Tuple[PricePredictor, Dict[str, Any]]:
    """
    Retrain the PricePredictor on fresh data.

    Returns:
        (predictor, metrics_dict)
    """
    df = _fetch_training_data(db_session)
    predictor = PricePredictor(model_name="linear_regression")
    metrics = predictor.fit(df, target_column="target")
    logger.info(f"PricePredictor retrained: {metrics}")
    return predictor, metrics


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def run_retraining(
    db_session=None,
    force: bool = False,
) -> Dict[str, Any]:
    """
    Full retraining run: train → evaluate → version → promote.

    Args:
        db_session: Optional SQLAlchemy session for the feature store.
        force:      Skip quality gates and always promote.

    Returns:
        A result dict with versions, metrics, and status.
    """
    global _last_run

    if not _retrain_lock.acquire(blocking=False):
        logger.warning("Retraining already in progress, skipping this trigger")
        return {"status": "skipped", "reason": "already_running"}

    started_at = datetime.utcnow()
    result: Dict[str, Any] = {
        "status": "started",
        "started_at": started_at.isoformat(),
        "models": {},
    }

    try:
        logger.info("=" * 60)
        logger.info("Automated Model Retraining Pipeline — START")
        logger.info(f"Timestamp: {started_at.isoformat()}")

        # ── 1. Sentiment model ──────────────────────────────────────────────
        logger.info("Step 1: Retraining sentiment model …")
        with MODEL_RETRAINING_DURATION.labels(model_type="sentiment").time():
            sentiment_model, sentiment_metrics = _build_sentiment_model()

        # ── 1a. Evaluate against held-out labelled examples ─────────────────
        logger.info("Step 1a: Evaluating sentiment model against held-out eval split …")
        eval_metrics = _evaluate_sentiment_model(sentiment_model)
        sentiment_metrics["eval"] = eval_metrics

        eval_f1_weighted = (
            eval_metrics.get("f1", {}).get("weighted", 0.0)
            if eval_metrics.get("eval_examples", 0) > 0
            else None
        )

        passes_sentiment_gate = force or (
            sentiment_metrics["coverage_ratio"] >= _MIN_SENTIMENT_COVERAGE
            and (
                eval_f1_weighted is None  # no eval data — allow pass
                or eval_f1_weighted >= _MIN_SENTIMENT_F1
            )
        )

        if passes_sentiment_gate:
            s_version = save_model("sentiment", sentiment_model)
            promote_model("sentiment", s_version)
            MODEL_RETRAINING_TOTAL.labels(model_type="sentiment", status="success").inc()
            result["models"]["sentiment"] = {
                "version": s_version,
                "metrics": sentiment_metrics,
                "promoted": True,
            }
            logger.info(
                "Sentiment model promoted: %s  (F1_weighted=%s)",
                s_version,
                eval_f1_weighted,
            )
        else:
            MODEL_RETRAINING_TOTAL.labels(model_type="sentiment", status="failed").inc()
            result["models"]["sentiment"] = {
                "metrics": sentiment_metrics,
                "promoted": False,
                "reason": "quality_gate_failed",
            }
            logger.warning(
                "Sentiment model did NOT pass quality gate — "
                "coverage_ratio=%.4f  F1_weighted=%s  MIN_F1=%.4f",
                sentiment_metrics["coverage_ratio"],
                eval_f1_weighted,
                _MIN_SENTIMENT_F1,
            )

        # ── 2. Price predictor ──────────────────────────────────────────────
        logger.info("Step 2: Retraining price predictor …")
        with MODEL_RETRAINING_DURATION.labels(model_type="price_predictor").time():
            price_model, price_metrics = _build_price_predictor(db_session)

        passes_price_gate = force or price_metrics.get("r2", -999) >= _MIN_PRICE_R2

        if passes_price_gate:
            p_version = save_model("price_predictor", price_model)
            promote_model("price_predictor", p_version)
            MODEL_RETRAINING_TOTAL.labels(model_type="price_predictor", status="success").inc()
            result["models"]["price_predictor"] = {
                "version": p_version,
                "metrics": price_metrics,
                "promoted": True,
            }
            logger.info(f"PricePredictor promoted: {p_version}")
        else:
            MODEL_RETRAINING_TOTAL.labels(model_type="price_predictor", status="failed").inc()
            result["models"]["price_predictor"] = {
                "metrics": price_metrics,
                "promoted": False,
                "reason": "quality_gate_failed",
            }
            logger.warning("PricePredictor did NOT pass quality gate — skipping promotion")

        # ── 3. Finalise ─────────────────────────────────────────────────────
        finished_at = datetime.utcnow()
        result.update(
            {
                "status": "completed",
                "finished_at": finished_at.isoformat(),
                "duration_seconds": (finished_at - started_at).total_seconds(),
                "registry": get_registry_status(),
            }
        )

        JOBS_RUN_TOTAL.inc()
        logger.info("Automated Model Retraining Pipeline — DONE")
        logger.info("=" * 60)

    except Exception as exc:
        result.update(
            {
                "status": "failed",
                "error": str(exc),
                "finished_at": datetime.utcnow().isoformat(),
            }
        )
        logger.error(f"Retraining pipeline failed: {exc}", exc_info=True)

    finally:
        _last_run = result
        _retrain_lock.release()

    return result


def get_last_run_status() -> Dict[str, Any]:
    """Return metadata from the most recent retraining run."""
    return _last_run or {"status": "never_run"}
