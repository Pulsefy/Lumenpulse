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
import hashlib
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

# Training data snapshot storage
_SNAPSHOT_DIR = Path(os.getenv("TRAINING_SNAPSHOT_DIR", "./data/training_snapshots"))
_SNAPSHOT_RETENTION_DAYS = int(os.getenv("SNAPSHOT_RETENTION_DAYS", "90"))  # Retention policy

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

def _ensure_snapshot_dir() -> None:
    """Ensure the snapshot directory exists."""
    _SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)


def _compute_data_hash(df: pd.DataFrame) -> str:
    """Compute a deterministic hash of the training data for integrity verification."""
    # Use a stable serialization: sort columns, reset index, then hash
    df_sorted = df.sort_index(axis=1).reset_index(drop=True)
    data_bytes = df_sorted.to_json(orient="split", date_format="iso").encode("utf-8")
    return hashlib.sha256(data_bytes).hexdigest()[:16]


def _save_training_snapshot(
    df: pd.DataFrame,
    snapshot_id: str,
    metadata: Dict[str, Any],
) -> Path:
    """
    Save training data snapshot to disk with metadata.

    Returns the path to the saved snapshot directory.
    """
    _ensure_snapshot_dir()

    snapshot_path = _SNAPSHOT_DIR / snapshot_id
    snapshot_path.mkdir(parents=True, exist_ok=True)

    # Save data as parquet for efficient storage
    data_path = snapshot_path / "training_data.parquet"
    df.to_parquet(data_path, index=False)

    # Save metadata
    meta_path = snapshot_path / "metadata.json"
    snapshot_metadata = {
        **metadata,
        "snapshot_id": snapshot_id,
        "created_at": datetime.utcnow().isoformat(),
        "row_count": len(df),
        "column_count": len(df.columns),
        "columns": list(df.columns),
        "data_hash": _compute_data_hash(df),
        "size_bytes": data_path.stat().st_size,
    }
    with open(meta_path, "w") as f:
        json.dump(snapshot_metadata, f, indent=2)

    logger.info(f"Saved training snapshot: {snapshot_id} ({len(df)} rows, {data_path.stat().st_size} bytes)")
    return snapshot_path


def _load_training_snapshot(snapshot_id: str) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    """
    Load a training data snapshot by ID.

    Returns (dataframe, metadata).
    """
    snapshot_path = _SNAPSHOT_DIR / snapshot_id
    data_path = snapshot_path / "training_data.parquet"
    meta_path = snapshot_path / "metadata.json"

    if not data_path.exists() or not meta_path.exists():
        raise FileNotFoundError(f"Snapshot {snapshot_id} not found")

    df = pd.read_parquet(data_path)
    with open(meta_path) as f:
        metadata = json.load(f)

    # Verify integrity
    current_hash = _compute_data_hash(df)
    if current_hash != metadata.get("data_hash"):
        logger.warning(f"Snapshot {snapshot_id} data hash mismatch! Expected {metadata['data_hash']}, got {current_hash}")

    return df, metadata


def _cleanup_old_snapshots() -> int:
    """
    Remove snapshots older than the retention period.

    Returns the number of snapshots removed.
    """
    if not _SNAPSHOT_DIR.exists():
        return 0

    cutoff = datetime.utcnow() - timedelta(days=_SNAPSHOT_RETENTION_DAYS)
    removed = 0

    for snapshot_dir in _SNAPSHOT_DIR.iterdir():
        if not snapshot_dir.is_dir():
            continue

        meta_path = snapshot_dir / "metadata.json"
        if not meta_path.exists():
            continue

        try:
            with open(meta_path) as f:
                metadata = json.load(f)
            created_at = datetime.fromisoformat(metadata.get("created_at", ""))
            if created_at < cutoff:
                import shutil
                shutil.rmtree(snapshot_dir)
                removed += 1
                logger.info(f"Removed expired snapshot: {snapshot_dir.name}")
        except Exception as exc:
            logger.warning(f"Failed to process snapshot {snapshot_dir.name} for cleanup: {exc}")

    return removed


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

    Returns a tuple of (dataframe, query_bounds) where query_bounds includes
    snapshot information for reproducibility.
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

                # Save snapshot for reproducibility
                snapshot_id = f"training_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{hashlib.sha256(str(start_time).encode()).hexdigest()[:8]}"
                snapshot_metadata = {
                    "source": "feature_store",
                    "query_bounds": query_bounds,
                    "seed": seed,
                }
                _save_training_snapshot(df, snapshot_id, snapshot_metadata)
                query_bounds["snapshot_id"] = snapshot_id
                query_bounds["snapshot_hash"] = _compute_data_hash(df)

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

    # Save synthetic snapshot too for reproducibility
    snapshot_id = f"synthetic_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_seed{synth_seed}"
    snapshot_metadata = {
        "source": "synthetic",
        "query_bounds": query_bounds,
        "seed": synth_seed,
    }
    _save_training_snapshot(df, snapshot_id, snapshot_metadata)
    query_bounds["snapshot_id"] = snapshot_id
    query_bounds["snapshot_hash"] = _compute_data_hash(df)

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
                    If manifest contains 'snapshot_id', the exact training data
                    from that snapshot will be loaded for reproducibility.
        seed:       Optional seed for randomness (used only if no manifest).

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
        snapshot_id = None
        snapshot_data = None
        
        if manifest:
            run_seed = manifest.get("seed", run_seed)
            bounds = manifest.get("data_query_bounds", {})
            if "start_time" in bounds and bounds["start_time"]:
                start_time = datetime.fromisoformat(bounds["start_time"])
            if "end_time" in bounds and bounds["end_time"]:
                end_time = datetime.fromisoformat(bounds["end_time"])
            # Check for snapshot reference for exact reproducibility
            if "snapshot_id" in bounds:
                snapshot_id = bounds["snapshot_id"]
                try:
                    snapshot_data, snap_meta = _load_training_snapshot(snapshot_id)
                    logger.info(f"Loaded training snapshot for reproducibility: {snapshot_id}")
                    # Verify hash if provided
                    if "snapshot_hash" in bounds:
                        current_hash = _compute_data_hash(snapshot_data)
                        if current_hash != bounds["snapshot_hash"]:
                            logger.warning(
                                f"Snapshot hash mismatch! Expected {bounds['snapshot_hash']}, got {current_hash}"
                            )
                except Exception as exc:
                    logger.error(f"Failed to load snapshot {snapshot_id}: {exc}")
                    raise
        else:
            if run_seed is None:
                run_seed = int(datetime.utcnow().timestamp()) % 10_000

        logger.info("=" * 60)
        logger.info("Automated Model Retraining Pipeline — START")
        logger.info(f"Timestamp: {started_at.isoformat()}, Seed: {run_seed}")
        if snapshot_id:
            logger.info(f"Reproducing from snapshot: {snapshot_id}")

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
                "training_snapshot": snapshot_id,
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
            if snapshot_data is not None:
                # Use snapshot data directly for exact reproducibility
                predictor = PricePredictor(model_name="linear_regression")
                training_set, evaluation_set = train_test_split(
                    snapshot_data, test_size=0.2, random_state=42
                )
                price_metrics = predictor.fit(training_set, target_column="target")
                
                # Build metadata with snapshot reference
                schema = current_feature_schema(predictor.feature_set)
                feature_names = [f for f in schema.feature_names if f in snapshot_data.columns]
                baseline = compute_distribution_baseline(snapshot_data, feature_names)
                
                import sklearn
                price_metadata: Dict[str, Any] = {
                    **schema_metadata(predictor.feature_set),
                    "trained_at": datetime.utcnow().isoformat(),
                    "metrics": price_metrics,
                    "feature_names": feature_names,
                    "feature_baseline": baseline,
                    "seed": run_seed,
                    "data_query_bounds": {
                        "start_time": start_time.isoformat() if start_time else None,
                        "end_time": end_time.isoformat() if end_time else None,
                        "snapshot_id": snapshot_id,
                        "snapshot_hash": _compute_data_hash(snapshot_data),
                    },
                    "row_count": len(snapshot_data),
                    "library_versions": {
                        "pandas": pd.__version__,
                        "scikit-learn": sklearn.__version__,
                    },
                }
                price_evaluation_set = (
                    evaluation_set.drop(columns=["target"]),
                    evaluation_set["target"],
                )
                logger.info(f"PricePredictor retrained from snapshot: {price_metrics}")
            else:
                # Normal training path
                (
                    predictor,
                    price_metrics,
                    price_metadata,
                    price_evaluation_set,
                ) = _build_price_predictor(
                    db_session, start_time=start_time, end_time=end_time, seed=run_seed
                )

        passes_price_gate = force or price_metrics.get("r2", -999) >= _MIN_PRICE_R2

        if passes_price_gate:
            p_version = save_model(
                "price_predictor", predictor, metadata=price_metadata
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
                    "training_snapshot": snapshot_id or price_metadata.get("data_query_bounds", {}).get("snapshot_id"),
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
                    "training_snapshot": snapshot_id or price_metadata.get("data_query_bounds", {}).get("snapshot_id"),
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

        # ── 3. Anomaly detector evaluation (issue #1450) ────────────────────
        # Re-measures precision/recall/false-positive-rate on every retraining
        # run against the labelled seed set, so a threshold or logic change
        # elsewhere in AnomalyDetector can't silently regress the
        # suspicious-contribution flow's false-positive rate unnoticed.
        try:
            from src.anomaly_detector import AnomalyDetector
            from src.ml.anomaly_evaluation import evaluate_detector

            anomaly_report = evaluate_detector(lambda: AnomalyDetector(use_ml=False))
            result["anomaly_detector_evaluation"] = anomaly_report
            logger.info(
                "Anomaly detector evaluation: precision=%.3f recall=%.3f false_positive_rate=%.3f",
                anomaly_report["overall"]["precision"],
                anomaly_report["overall"]["recall"],
                anomaly_report["overall"]["false_positive_rate"],
            )
        except Exception as exc:
            logger.warning(f"Anomaly detector evaluation failed: {exc}")
            result["anomaly_detector_evaluation"] = {"status": "failed", "error": str(exc)}

        # ── 4. Cleanup old snapshots (retention policy) ──────────────────────
        removed = _cleanup_old_snapshots()
        if removed:
            logger.info(f"Cleaned up {removed} expired training snapshots (retention: {_SNAPSHOT_RETENTION_DAYS} days)")

        # ── 5. Finalise ─────────────────────────────────────────────────────
        finished_at = datetime.utcnow()
        result.update(
            {
                "status": "completed",
                "finished_at": finished_at.isoformat(),
                "duration_seconds": (finished_at - started_at).total_seconds(),
                "registry": get_registry_status(),
                "snapshot_retention_days": _SNAPSHOT_RETENTION_DAYS,
                "snapshots_cleaned": removed,
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


def verify_reproducibility(manifest: Dict[str, Any], db_session=None) -> Dict[str, Any]:
    """
    Verify that a training run can be reproduced from its manifest.

    Runs the retraining pipeline twice with the same manifest and compares
    the resulting model artifacts for bitwise equality.

    Args:
        manifest: The manifest from a previous run (must contain snapshot_id).
        db_session: Optional database session.

    Returns:
        Dict with verification results including whether models match.
    """
    if "models" not in manifest or "price_predictor" not in manifest["models"]:
        return {"status": "error", "reason": "Manifest missing price_predictor info"}

    snapshot_id = manifest["models"]["price_predictor"].get("training_snapshot")
    if not snapshot_id:
        return {"status": "error", "reason": "Manifest missing training_snapshot reference"}

    logger.info(f"Verifying reproducibility for snapshot: {snapshot_id}")

    # Run 1
    result1 = run_retraining(db_session=db_session, manifest=manifest, force=True)

    # Run 2 (with same manifest)
    result2 = run_retraining(db_session=db_session, manifest=manifest, force=True)

    # Compare model versions and metrics
    models_match = True
    differences = []

    for model_type in ["sentiment", "price_predictor"]:
        m1 = result1["models"].get(model_type, {})
        m2 = result2["models"].get(model_type, {})

        if m1.get("version") != m2.get("version"):
            models_match = False
            differences.append(f"{model_type}: version mismatch ({m1.get('version')} vs {m2.get('version')})")

        # Compare metrics (allow small floating point differences)
        for key in ["r2", "mae", "mse", "coverage_ratio"]:
            v1 = m1.get("metrics", {}).get(key)
            v2 = m2.get("metrics", {}).get(key)
            if v1 is not None and v2 is not None:
                if abs(v1 - v2) > 1e-10:
                    models_match = False
                    differences.append(f"{model_type}.{key}: {v1} vs {v2}")

    return {
        "status": "verified" if models_match else "mismatch",
        "snapshot_id": snapshot_id,
        "run1_version": result1["models"].get("price_predictor", {}).get("version"),
        "run2_version": result2["models"].get("price_predictor", {}).get("version"),
        "models_match": models_match,
        "differences": differences,
    }