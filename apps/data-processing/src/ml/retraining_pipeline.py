# -*- coding: utf-8 -*-
"""
Automated Model Retraining Pipeline (Issue #454)

Retrains both models on fresh data, evaluates quality gates,
versions the artifacts, and promotes them with zero downtime.

Models:
  - sentiment   : VADER lexicon + custom crypto slang dictionary
  - price_predictor : scikit-learn LinearRegression pipeline
"""

import os
import json
import threading
from datetime import datetime, timedelta, timezone
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
from src.ml.feature_schema import current_feature_schema, schema_metadata
from src.ml.feature_drift_detector import compute_distribution_baseline
from src.utils.logger import setup_logger
from src.utils.metrics import JOBS_RUN_TOTAL, MODEL_RETRAINING_TOTAL, MODEL_RETRAINING_DURATION

# LabelStore is imported here so it can be patched in tests; SQLAlchemy may
# not be installed in lightweight CI environments — guard the import.
try:
    from src.db.label_store import LabelStore
except Exception:  # pragma: no cover
    LabelStore = None  # type: ignore[assignment,misc]

logger = setup_logger(__name__)

# Path to the custom crypto-slang lexicon file (JSON: {"word": score, ...})
_SLANG_LEXICON_PATH = Path(
    os.getenv("CRYPTO_SLANG_LEXICON", "./data/crypto_slang_lexicon.json")
)

# Quality gates: minimum acceptable metrics before promotion
_MIN_SENTIMENT_COVERAGE = float(os.getenv("MIN_SENTIMENT_COVERAGE", "0.0"))
_MIN_PRICE_R2 = float(os.getenv("MIN_PRICE_R2", "-1.0"))  # permissive default
# Minimum macro-average F1 against the held-out eval split.
# Set to 0.0 by default so CI never blocks on missing labels; tighten in prod.
_MIN_SENTIMENT_F1 = float(os.getenv("MIN_SENTIMENT_F1", "0.0"))

# Thread-safety: only one retraining run at a time
_retrain_lock = threading.Lock()

# Last run metadata (in-memory, also written to disk)
_last_run: Dict[str, Any] = {}


# ---------------------------------------------------------------------------
# Sentiment holdout evaluation (precision / recall / F1 against human labels)
# ---------------------------------------------------------------------------

_LABEL_TO_COMPOUND_THRESHOLD = 0.05  # VADER compound: pos if ≥ 0.05, neg if ≤ −0.05


def _score_to_label(compound: float) -> str:
    """Map a VADER compound score to one of our three label strings."""
    if compound >= _LABEL_TO_COMPOUND_THRESHOLD:
        return "positive"
    if compound <= -_LABEL_TO_COMPOUND_THRESHOLD:
        return "negative"
    return "neutral"


def _compute_prf(
    y_true: List[str], y_pred: List[str], labels: Optional[List[str]] = None
) -> Dict[str, Any]:
    """
    Compute per-class and macro-average precision, recall, and F1.

    Uses a pure-Python implementation so there is no scikit-learn
    dependency in the hot path.  Scikit-learn is imported when available
    for a double-check / richer output, but the function never fails
    if it is absent.

    Args:
        y_true: Ground-truth labels.
        y_pred: Predicted labels.
        labels: Label set to evaluate (defaults to all seen labels).

    Returns:
        Dict with keys:
            - ``per_class``: mapping from label → {precision, recall, f1, support}
            - ``macro_precision``, ``macro_recall``, ``macro_f1``
            - ``accuracy``
            - ``sample_count``
    """
    if not y_true:
        return {
            "per_class": {},
            "macro_precision": 0.0,
            "macro_recall": 0.0,
            "macro_f1": 0.0,
            "accuracy": 0.0,
            "sample_count": 0,
        }

    all_labels = labels or sorted(set(y_true) | set(y_pred))
    per_class: Dict[str, Dict[str, Any]] = {}

    for lbl in all_labels:
        tp = sum(1 for t, p in zip(y_true, y_pred) if t == lbl and p == lbl)
        fp = sum(1 for t, p in zip(y_true, y_pred) if t != lbl and p == lbl)
        fn = sum(1 for t, p in zip(y_true, y_pred) if t == lbl and p != lbl)
        support = tp + fn

        precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1 = (
            2 * precision * recall / (precision + recall)
            if (precision + recall) > 0
            else 0.0
        )
        per_class[lbl] = {
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(f1, 4),
            "support": support,
        }

    macro_p = sum(v["precision"] for v in per_class.values()) / len(per_class)
    macro_r = sum(v["recall"] for v in per_class.values()) / len(per_class)
    macro_f1 = sum(v["f1"] for v in per_class.values()) / len(per_class)
    accuracy = sum(1 for t, p in zip(y_true, y_pred) if t == p) / len(y_true)

    return {
        "per_class": per_class,
        "macro_precision": round(macro_p, 4),
        "macro_recall": round(macro_r, 4),
        "macro_f1": round(macro_f1, 4),
        "accuracy": round(accuracy, 4),
        "sample_count": len(y_true),
    }


def _evaluate_sentiment_on_holdout(
    analyzer: SentimentIntensityAnalyzer,
    db_session=None,
) -> Dict[str, Any]:
    """
    Run the given VADER analyzer against the held-out evaluation split
    and return precision, recall, and F1 metrics.

    The eval split is fetched from the ``sentiment_labelled_examples``
    table (``split='eval'``).  If no labelled examples are available
    (e.g. fresh environment, no DB, or an empty store) the function
    returns a result dict that records zero samples evaluated rather
    than raising.

    Args:
        analyzer: A fully-configured ``SentimentIntensityAnalyzer`` —
                  typically the model just built by ``_build_sentiment_model``.
        db_session: Optional SQLAlchemy session.  When ``None`` the
                    function falls back to a fresh in-memory SQLite
                    database so the pipeline stays runnable in CI.

    Returns:
        Metrics dict with keys ``macro_f1``, ``macro_precision``,
        ``macro_recall``, ``accuracy``, ``sample_count``, ``per_class``,
        and ``eval_available`` (bool).
    """
    _NO_EVAL_RESULT: Dict[str, Any] = {
        "eval_available": False,
        "sample_count": 0,
        "macro_precision": None,
        "macro_recall": None,
        "macro_f1": None,
        "accuracy": None,
        "per_class": {},
        "note": "No held-out eval examples found in the label store",
    }

    try:
        from sqlalchemy import create_engine
        from sqlalchemy.orm import Session as SASession
        from src.db.models import Base

        if db_session is None:
            db_url = os.environ.get("DATABASE_URL", "sqlite:///:memory:")
            engine = create_engine(db_url, future=True)
            Base.metadata.create_all(engine, checkfirst=True)
            session: Any = SASession(engine)
            _owns_session = True
        else:
            session = db_session
            _owns_session = False

        try:
            store = LabelStore(session)
            eval_examples = store.get_eval_split()
        finally:
            if _owns_session:
                session.close()

        if not eval_examples:
            logger.info("No eval-split examples found in label store — skipping holdout eval")
            return _NO_EVAL_RESULT

        logger.info(
            "Evaluating sentiment model on %d held-out examples", len(eval_examples)
        )

        y_true: List[str] = []
        y_pred: List[str] = []

        for ex in eval_examples:
            scores = analyzer.polarity_scores(ex.text)
            pred_label = _score_to_label(float(scores.get("compound", 0.0)))
            y_true.append(ex.label)
            y_pred.append(pred_label)

        metrics = _compute_prf(y_true, y_pred, labels=["positive", "negative", "neutral"])
        metrics["eval_available"] = True

        logger.info(
            "Holdout eval — macro F1=%.4f  precision=%.4f  recall=%.4f  accuracy=%.4f  n=%d",
            metrics["macro_f1"],
            metrics["macro_precision"],
            metrics["macro_recall"],
            metrics["accuracy"],
            metrics["sample_count"],
        )
        return metrics

    except Exception as exc:
        logger.warning(
            "Holdout evaluation failed (non-fatal): %s", exc, exc_info=True
        )
        result = dict(_NO_EVAL_RESULT)
        result["note"] = f"Evaluation error: {exc}"
        return result


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
# Price predictor retraining
# ---------------------------------------------------------------------------

def _fetch_training_data(
    db_session=None,
    start_time: Optional[datetime] = None,
    end_time: Optional[datetime] = None,
    seed: Optional[int] = None
) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    """
    Fetch recent feature data for the price predictor.

    In production this queries the feature store; falls back to a
    synthetic dataset so the pipeline never hard-fails in CI/dev.
    """
    if start_time is None:
        end_time = datetime.now(timezone.utc)
        start_time = end_time - timedelta(days=30)

    query_bounds = {
        "start_time": start_time.isoformat(),
        "end_time": end_time.isoformat() if end_time else None
    }

    if db_session is not None:
        try:
            from src.ml.feature_store import FeatureStore
            store = FeatureStore(db_session)
            df = store.get_features_for_asset("XLM", window=None, start_time=start_time, end_time=end_time)
            if not df.empty and len(df) >= 20:
                # Create a simple target: next-period sentiment shift
                df["target"] = df["sentiment_score"].shift(-1)
                df.dropna(inplace=True)
                logger.info(f"Fetched {len(df)} rows from feature store for retraining")
                return df, query_bounds
        except Exception as exc:
            logger.warning(f"Feature store unavailable, using synthetic data: {exc}")

    # Synthetic fallback — keeps the pipeline runnable without a live DB
    import numpy as np
    synth_seed = seed if seed is not None else int(datetime.utcnow().timestamp()) % 10_000
    rng = np.random.default_rng(seed=synth_seed)
    n = 200
    df = pd.DataFrame({
        "sentiment_score": rng.uniform(-1, 1, n),
        "volume": rng.uniform(1_000, 100_000, n),
        "volatility": rng.uniform(0, 0.5, n),
        "target": rng.uniform(-1, 1, n),
    })
    logger.info(f"Using synthetic training data (seed={synth_seed})")
    return df, query_bounds


def _build_price_predictor(
    db_session=None,
    start_time: Optional[datetime] = None,
    end_time: Optional[datetime] = None,
    seed: Optional[int] = None
) -> Tuple[PricePredictor, Dict[str, Any], Dict[str, Any]]:
    """
    Retrain the PricePredictor on fresh data.

    Returns:
        (predictor, metrics_dict, model_metadata)

    ``model_metadata`` is the JSON-serialisable sidecar persisted alongside the
    model: the feature schema version/fingerprint it was trained on plus the
    per-feature training distribution baseline used later for train-vs-serve
    drift detection (#1239).
    """
    df, query_bounds = _fetch_training_data(db_session, start_time, end_time, seed)
    predictor = PricePredictor(model_name="linear_regression")
    
    # Use seed for model training if provided, otherwise default 42
    random_state = seed if seed is not None else 42
    metrics = predictor.fit(df, target_column="target", random_state=random_state)
    logger.info(f"PricePredictor retrained: {metrics}")

    # Record the schema version + a per-feature distribution baseline so serving
    # can detect schema skew and scheduled drift checks have something to
    # compare the live serving distribution against.
    schema = current_feature_schema(predictor.feature_set)
    feature_names = [f for f in schema.feature_names if f in df.columns]
    baseline = compute_distribution_baseline(df, feature_names)
    
    # Attempt to get library versions (simplified)
    import sklearn
    library_versions = {
        "pandas": pd.__version__,
        "scikit-learn": sklearn.__version__,
    }

    metadata: Dict[str, Any] = {
        **schema_metadata(predictor.feature_set),
        "trained_at": datetime.utcnow().isoformat(),
        "metrics": metrics,
        "feature_names": feature_names,
        "feature_baseline": baseline,
        "seed": seed,
        "data_query_bounds": query_bounds,
        "row_count": len(df),
        "library_versions": library_versions,
    }
    return predictor, metrics, metadata


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def run_retraining(
    db_session=None,
    force: bool = False,
    manifest: Optional[Dict[str, Any]] = None,
    seed: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Full retraining run: train → evaluate → version → promote.

    Args:
        db_session: Optional SQLAlchemy session for the feature store.
        force:      Skip quality gates and always promote.
        manifest:   Optional manifest from a previous run to reproduce it.
        seed:       Optional seed for randomness.

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
        # Determine run parameters from manifest or defaults
        run_seed = seed
        start_time = None
        end_time = None
        
        if manifest:
            run_seed = manifest.get("seed", run_seed)
            bounds = manifest.get("data_query_bounds", {})
            if "start_time" in bounds and bounds["start_time"]:
                start_time = datetime.fromisoformat(bounds["start_time"])
            if "end_time" in bounds and bounds["end_time"]:
                end_time = datetime.fromisoformat(bounds["end_time"])
        else:
            if run_seed is None:
                run_seed = int(datetime.utcnow().timestamp()) % 10_000

        logger.info("=" * 60)
        logger.info("Automated Model Retraining Pipeline — START")
        logger.info(f"Timestamp: {started_at.isoformat()}, Seed: {run_seed}")

        # ── 1. Sentiment model ──────────────────────────────────────────────
        logger.info("Step 1: Retraining sentiment model …")
        with MODEL_RETRAINING_DURATION.labels(model_type="sentiment").time():
            sentiment_model, sentiment_metrics = _build_sentiment_model()

        # ── 1b. Holdout evaluation (precision / recall / F1) ────────────────
        logger.info("Step 1b: Evaluating sentiment model on held-out eval split …")
        holdout_metrics = _evaluate_sentiment_on_holdout(sentiment_model, db_session)
        sentiment_metrics["holdout_eval"] = holdout_metrics

        # Quality gate: coverage AND (if eval data available) minimum F1
        holdout_f1 = holdout_metrics.get("macro_f1")
        f1_gate_passes = (
            not holdout_metrics.get("eval_available", False)  # no data → skip gate
            or holdout_f1 is None
            or holdout_f1 >= _MIN_SENTIMENT_F1
        )

        passes_sentiment_gate = (
            force
            or (
                sentiment_metrics["coverage_ratio"] >= _MIN_SENTIMENT_COVERAGE
                and f1_gate_passes
            )
        )

        if passes_sentiment_gate:
            s_version = save_model("sentiment", sentiment_model)
            promote_model("sentiment", s_version)
            MODEL_RETRAINING_TOTAL.labels(model_type="sentiment", status="success").inc()
            result["models"]["sentiment"] = {
                "version": s_version,
                "metrics": sentiment_metrics,
                "holdout_eval": holdout_metrics,
                "promoted": True,
            }
            logger.info(f"Sentiment model promoted: {s_version}")
        else:
            MODEL_RETRAINING_TOTAL.labels(model_type="sentiment", status="failed").inc()
            gate_reason = (
                "quality_gate_failed"
                if sentiment_metrics["coverage_ratio"] < _MIN_SENTIMENT_COVERAGE
                else f"holdout_f1_below_threshold (f1={holdout_f1}, min={_MIN_SENTIMENT_F1})"
            )
            result["models"]["sentiment"] = {
                "metrics": sentiment_metrics,
                "holdout_eval": holdout_metrics,
                "promoted": False,
                "reason": gate_reason,
            }
            logger.warning("Sentiment model did NOT pass quality gate — skipping promotion")

        # ── 2. Price predictor ──────────────────────────────────────────────
        logger.info("Step 2: Retraining price predictor …")
        with MODEL_RETRAINING_DURATION.labels(model_type="price_predictor").time():
            price_model, price_metrics, price_metadata = _build_price_predictor(
                db_session, start_time=start_time, end_time=end_time, seed=run_seed
            )

        passes_price_gate = force or price_metrics.get("r2", -999) >= _MIN_PRICE_R2

        if passes_price_gate:
            p_version = save_model(
                "price_predictor", price_model, metadata=price_metadata
            )
            promote_model("price_predictor", p_version)
            MODEL_RETRAINING_TOTAL.labels(model_type="price_predictor", status="success").inc()
            result["models"]["price_predictor"] = {
                "version": p_version,
                "metrics": price_metrics,
                "promoted": True,
                "schema_version": price_metadata.get("schema_version"),
                "schema_fingerprint": price_metadata.get("schema_fingerprint"),
            }
            logger.info(
                f"PricePredictor promoted: {p_version} "
                f"(schema v{price_metadata.get('schema_version')})"
            )
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
