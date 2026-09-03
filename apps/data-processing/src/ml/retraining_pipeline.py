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
from typing import Any, Dict, Optional, Tuple

import pandas as pd
from sklearn.model_selection import train_test_split
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
from src.ml.sentiment_evaluation import classification_metrics, seed_sentiment_labels
from src.utils.logger import setup_logger
from src.utils.metrics import JOBS_RUN_TOTAL, MODEL_RETRAINING_TOTAL, MODEL_RETRAINING_DURATION

logger = setup_logger(__name__)

# Path to the custom crypto-slang lexicon file (JSON: {"word": score, ...})
_SLANG_LEXICON_PATH = Path(
    os.getenv("CRYPTO_SLANG_LEXICON", "./data/crypto_slang_lexicon.json")
)

# Quality gates: minimum acceptable metrics before promotion
_MIN_SENTIMENT_COVERAGE = float(os.getenv("MIN_SENTIMENT_COVERAGE", "0.0"))
_MIN_PRICE_R2 = float(os.getenv("MIN_PRICE_R2", "-1.0"))  # permissive default
_PROMOTION_MIN_DELTA = float(os.getenv("PROMOTION_MIN_DELTA", "0.0"))

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


def _evaluate_sentiment_model(analyzer: SentimentIntensityAnalyzer, db_session=None) -> Dict[str, Any]:
    """Evaluate sentiment against the persisted held-out human labels."""
    if db_session is None:
        return {"precision": 0.0, "recall": 0.0, "f1": 0.0, "accuracy": 0.0, "support": 0, "status": "no_store"}
    rows = db_session.get_sentiment_label_dicts(held_out=True)
    actual = [row["label"] for row in rows]
    predicted = []
    for row in rows:
        compound = analyzer.polarity_scores(row["text"])["compound"]
        predicted.append("positive" if compound >= 0.05 else "negative" if compound <= -0.05 else "neutral")
    return {**classification_metrics(actual, predicted), "status": "evaluated"}


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
) -> Tuple[
    PricePredictor,
    Dict[str, Any],
    Dict[str, Any],
    Tuple[pd.DataFrame, pd.Series],
]:
    """
    Retrain the PricePredictor on fresh data.

    Returns:
        (predictor, metrics_dict, model_metadata, evaluation_set)

    ``model_metadata`` is the JSON-serialisable sidecar persisted alongside the
    model: the feature schema version/fingerprint it was trained on plus the
    per-feature training distribution baseline used later for train-vs-serve
    drift detection (#1239).
    """
    df, query_bounds = _fetch_training_data(db_session, start_time, end_time, seed)
    predictor = PricePredictor(model_name="linear_regression")
    training_set, evaluation_set = train_test_split(
        df, test_size=0.2, random_state=42
    )
    metrics = predictor.fit(training_set, target_column="target")
    
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
    return (
        predictor,
        metrics,
        metadata,
        (
            evaluation_set.drop(columns=["target"]),
            evaluation_set["target"],
        ),
    )


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
        if db_session is not None:
            seed_sentiment_labels(db_session)
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
            sentiment_metrics["evaluation"] = _evaluate_sentiment_model(sentiment_model, db_session)

        passes_sentiment_gate = (
            force
            or sentiment_metrics["coverage_ratio"] >= _MIN_SENTIMENT_COVERAGE
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
            logger.info(f"Sentiment model promoted: {s_version}")
        else:
            MODEL_RETRAINING_TOTAL.labels(model_type="sentiment", status="failed").inc()
            result["models"]["sentiment"] = {
                "metrics": sentiment_metrics,
                "promoted": False,
                "reason": "quality_gate_failed",
            }
            logger.warning("Sentiment model did NOT pass quality gate — skipping promotion")

        # ── 2. Price predictor ──────────────────────────────────────────────
        logger.info("Step 2: Retraining price predictor …")
        with MODEL_RETRAINING_DURATION.labels(model_type="price_predictor").time():
            (
                price_model,
                price_metrics,
                price_metadata,
                price_evaluation_set,
            ) = _build_price_predictor(
                db_session, start_time=start_time, end_time=end_time, seed=run_seed
            )

        passes_price_gate = force or price_metrics.get("r2", -999) >= _MIN_PRICE_R2

        if passes_price_gate:
            p_version = save_model(
                "price_predictor", price_model, metadata=price_metadata
            )
            promoted = promote_model(
                "price_predictor",
                p_version,
                evaluation_set=price_evaluation_set,
                metric="r2",
                threshold=_MIN_PRICE_R2,
                min_delta=_PROMOTION_MIN_DELTA,
                force=force,
            )
            if promoted:
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
                    "version": p_version,
                    "metrics": price_metrics,
                    "promoted": False,
                    "reason": "promotion_evaluation_failed",
                    "schema_version": price_metadata.get("schema_version"),
                    "schema_fingerprint": price_metadata.get("schema_fingerprint"),
                }
                logger.warning("PricePredictor promotion refused: %s", p_version)
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
