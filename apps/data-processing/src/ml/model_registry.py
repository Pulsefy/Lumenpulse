"""
Model Registry - versioned model storage with atomic zero-downtime swap.

Versions follow semver-lite: v<major>.<minor>  (e.g. v1.0, v1.1, v2.0)
Each model type (sentiment, price_predictor) is stored independently.

Directory layout:
  models/
    sentiment/
      v1.0.pkl
      v1.1.pkl
    current.json          ({"version": "v1.1"}, updated atomically)
      shadow/               (shadow-mode directory)
        v1.2.pkl
        shadow_current -> v1.2.pkl (shadow-mode symlink)
        comparison_log.jsonl
    price_predictor/
      v1.0.pkl
    current.json          ({"version": "v1.0"})

Shadow-mode deployment (Issue #1256):
  A candidate version can run alongside the live model. Both predictions
  are logged for comparison. Promoting from shadow to live is a single
  atomic operation, and rollback (unregistering the shadow) is equally simple.
"""

import dataclasses
import json
import os
import pickle
import shutil
import tempfile
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from src.utils.logger import setup_logger

logger = setup_logger(__name__)

_MODELS_ROOT = Path(os.getenv("MODEL_REGISTRY_PATH", "./models"))

# In-memory hot-swap: the live model is held here so the API never reads disk
# during inference. A reentrant read-write lock guards concurrent access.
_live_models: dict[str, Any] = {}
_live_versions: dict[str, str] = {}
_lock = threading.RLock()

# ── Shadow-mode state ─────────────────────────────────────────────────────
# Shadow models run alongside the live model without affecting responses.
_shadow_models: dict[str, Any] = {}
_shadow_versions: dict[str, str] = {}

# In-memory ring buffer for comparison entries (reduces disk I/O).
_comparison_buffer: dict[str, list[Any]] = {}

# Maximum comparisons kept in memory before flushing to disk.
_MAX_IN_MEMORY_COMPARISONS = 1000

# Lock for shadow state (separate from _lock to avoid contention with live ops).
_shadow_lock = threading.RLock()


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _model_dir(model_type: str) -> Path:
    d = _MODELS_ROOT / model_type
    d.mkdir(parents=True, exist_ok=True)
    return d


def _current_pointer_path(model_type: str) -> Path:
    return _model_dir(model_type) / "current.json"


def _legacy_symlink_path(model_type: str) -> Path:
    return _model_dir(model_type) / "current"


def _version_path(model_type: str, version: str) -> Path:
    return _model_dir(model_type) / f"{version}.pkl"


def _shadow_dir(model_type: str) -> Path:
    """Return the shadow sub-directory for a model type."""
    d = _model_dir(model_type) / "shadow"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _shadow_symlink_path(model_type: str) -> Path:
    return _shadow_dir(model_type) / "shadow_current"


def _shadow_version_path(model_type: str, version: str) -> Path:
    return _shadow_dir(model_type) / f"{version}.pkl"


def _comparison_log_path(model_type: str) -> Path:
    return _shadow_dir(model_type) / "comparison_log.jsonl"


def _promotion_log_path(model_type: str) -> Path:
    return _model_dir(model_type) / "promotion_log.jsonl"


def _metadata_path(model_type: str, version: str) -> Path:
    """Sidecar JSON holding non-pickled metadata for a saved model version."""
    return _model_dir(model_type) / f"{version}.meta.json"


def _read_current_version(model_type: str) -> Optional[str]:
    """Read the live pointer, migrating a legacy ``current`` symlink."""
    pointer = _current_pointer_path(model_type)
    if pointer.exists():
        try:
            data = json.loads(pointer.read_text(encoding="utf-8"))
            version = data.get("version")
            if isinstance(version, str) and version:
                return version
        except (OSError, json.JSONDecodeError):
            logger.warning("Invalid model registry pointer: %s", pointer)
        return None

    with _lock:
        if pointer.exists():
            return _read_current_version(model_type)
        legacy = _legacy_symlink_path(model_type)
        if not legacy.is_symlink():
            return None
        try:
            version = legacy.resolve(strict=True).stem
        except OSError:
            return None

        _write_current_version(model_type, version)
        legacy.unlink()
        logger.info(
            "Migrated legacy model symlink: type=%s version=%s", model_type, version
        )
        return version


def _write_current_version(model_type: str, version: str) -> None:
    """Atomically persist the live model version in a JSON pointer."""
    pointer = _current_pointer_path(model_type)
    temporary_name = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=pointer.parent,
            prefix=f".{pointer.name}.",
            suffix=".tmp",
            delete=False,
        ) as fh:
            temporary_name = fh.name
            json.dump({"version": version}, fh, separators=(",", ":"))
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(temporary_name, pointer)
    finally:
        if temporary_name:
            try:
                os.unlink(temporary_name)
            except FileNotFoundError:
                pass


def _next_version(model_type: str) -> str:
    """Increment the minor version of the latest saved model."""
    existing = list_versions(model_type)
    if not existing:
        return "v1.0"
    # Parse the highest version
    def _parse(v: str) -> tuple[int, int]:
        parts = v.lstrip("v").split(".")
        return int(parts[0]), int(parts[1])

    major, minor = max(_parse(v) for v in existing)
    return f"v{major}.{minor + 1}"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def save_model(
    model_type: str,
    model_obj: Any,
    version: Optional[str] = None,
    metadata: Optional[dict[str, Any]] = None,
) -> str:
    """
    Persist a trained model to disk and return the version string.

    Args:
        model_type: e.g. "sentiment" or "price_predictor"
        model_obj:  The object to pickle (sklearn pipeline, VADER lexicon dict, …)
        version:    Explicit version string; auto-incremented if omitted.
        metadata:   Optional JSON-serialisable dict written to a sidecar
                    ``<version>.meta.json`` file. Used to record the feature
                    schema version and training-time feature statistics
                    alongside each model (#1239) without touching the pickle
                    format, so older readers keep working.

    Returns:
        The version string that was saved (e.g. "v1.2").
    """
    if version is None:
        version = _next_version(model_type)

    path = _version_path(model_type, version)
    with open(path, "wb") as fh:
        pickle.dump(model_obj, fh, protocol=pickle.HIGHEST_PROTOCOL)

    if metadata is not None:
        meta = dict(metadata)
        meta.setdefault("model_type", model_type)
        meta.setdefault("version", version)
        meta.setdefault("saved_at", datetime.utcnow().isoformat())
        meta_path = _metadata_path(model_type, version)
        with open(meta_path, "w", encoding="utf-8") as fh:
            json.dump(meta, fh, indent=2, sort_keys=True, default=str)
        logger.info(
            f"Model metadata saved: type={model_type} version={version} "
            f"path={meta_path} keys={sorted(meta)}"
        )

    logger.info(f"Model saved: type={model_type} version={version} path={path}")
    return version


def load_metadata(
    model_type: str, version: str = "current"
) -> Optional[dict[str, Any]]:
    """
    Load the metadata sidecar for a saved model version.

    Returns ``None`` when no metadata was recorded (e.g. a legacy model saved
    before metadata support, or the sentiment model which records none).

    ``version="current"`` resolves the promoted pointer first so callers can
    ask for "whatever is live right now".
    """
    if version == "current":
        version = _read_current_version(model_type)
        if version is None:
            return None

    meta_path = _metadata_path(model_type, version)
    if not meta_path.exists():
        return None

    with open(meta_path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def load_model(model_type: str, version: str = "current") -> Any:
    """
    Load a model from disk.

    Args:
        model_type: e.g. "sentiment" or "price_predictor"
        version:    Specific version string or "current" (follows the pointer).

    Returns:
        The unpickled model object.
    """
    if version == "current":
        version = _read_current_version(model_type)
        if version is None:
            raise FileNotFoundError(
                f"No current model for '{model_type}'. Run retraining first."
            )
        path = _version_path(model_type, version)
    else:
        path = _version_path(model_type, version)

    if not path.exists():
        raise FileNotFoundError(f"Model not found: {path}")

    with open(path, "rb") as fh:
        obj = pickle.load(fh)

    logger.info(f"Model loaded from disk: type={model_type} version={version}")
    return obj


def _score_model(model: Any, evaluation_set: Any, metric: str) -> float:
    """Score a model on ``(features, target)`` or a frame with ``target``."""
    if isinstance(evaluation_set, tuple):
        features, target = evaluation_set
    else:
        if "target" not in evaluation_set.columns:
            raise ValueError("Evaluation set must contain a 'target' column")
        features = evaluation_set.drop(columns=["target"])
        target = evaluation_set["target"]

    predictions = model.predict(features)
    actual = list(target)
    predicted = list(predictions)
    if not actual:
        raise ValueError("Evaluation set is empty")
    if len(actual) != len(predicted):
        raise ValueError("Model predictions do not match evaluation targets")

    if metric == "mse":
        return sum((float(y) - float(pred)) ** 2 for y, pred in zip(actual, predicted)) / len(actual)
    if metric == "accuracy":
        return sum(y == pred for y, pred in zip(actual, predicted)) / len(actual)
    if metric != "r2":
        raise ValueError(f"Unsupported promotion metric: {metric}")

    mean_target = sum(float(value) for value in actual) / len(actual)
    total = sum((float(value) - mean_target) ** 2 for value in actual)
    residual = sum((float(value) - float(pred)) ** 2 for value, pred in zip(actual, predicted))
    return 0.0 if total == 0 else 1.0 - residual / total


def _record_promotion_event(model_type: str, event: dict[str, Any]) -> None:
    event = {"timestamp": datetime.now(timezone.utc).isoformat(), **event}
    with open(_promotion_log_path(model_type), "a", encoding="utf-8") as fh:
        fh.write(json.dumps(event, default=str) + "\n")


def promote_model(
    model_type: str,
    version: str,
    evaluation_set: Any = None,
    metric: str = "r2",
    threshold: Optional[float] = None,
    min_delta: Optional[float] = None,
    force: bool = False,
) -> bool:
    """
    Atomically promote a saved version to 'current' (zero-downtime swap).

    The on-disk JSON pointer is updated atomically via a rename, and the
    in-memory hot model is swapped under the RLock so in-flight requests
    finish with the old model while new requests immediately use the new one.

    Args:
        model_type: e.g. "sentiment" or "price_predictor"
        version:    The version to promote (must already be saved).
        evaluation_set: Held-out ``(features, target)`` or a DataFrame with a
            ``target`` column. When supplied, both candidate and incumbent are
            scored before promotion.
        metric:      Metric to score (``r2``, ``mse``, or ``accuracy``).
        threshold:   Minimum candidate score. Defaults to ``PROMOTION_THRESHOLD``.
        min_delta:   Required candidate improvement over incumbent. Defaults to
            ``PROMOTION_MIN_DELTA``.
        force:       Bypass evaluation gates and record an operator override.

    Returns:
        ``True`` when promoted, ``False`` when refused by an evaluation gate.
    """
    target = _version_path(model_type, version)
    if not target.exists():
        raise FileNotFoundError(
            f"Cannot promote {model_type}@{version}: file not found at {target}"
        )

    if evaluation_set is not None:
        candidate_metrics = None
        incumbent_metrics = None
        evaluation_error = None
        try:
            candidate = load_model(model_type, version)
            candidate_score = _score_model(candidate, evaluation_set, metric)
            candidate_metrics = {metric: candidate_score}
            current_version = get_current_version(model_type)
            if current_version and current_version != version:
                incumbent_score = _score_model(
                    get_live_model(model_type), evaluation_set, metric
                )
                incumbent_metrics = {metric: incumbent_score}
        except Exception as exc:
            if not force:
                raise
            evaluation_error = str(exc)
            logger.warning(
                "Forced promotion continuing after evaluation error: "
                "type=%s version=%s error=%s",
                model_type,
                version,
                exc,
            )

        configured_threshold = (
            float(os.getenv("PROMOTION_THRESHOLD", "-inf"))
            if threshold is None else threshold
        )
        configured_delta = (
            float(os.getenv("PROMOTION_MIN_DELTA", "0.0"))
            if min_delta is None else min_delta
        )
        higher_is_better = metric != "mse"
        reasons = []
        if not force and (
            (higher_is_better and candidate_score < configured_threshold)
            or (not higher_is_better and candidate_score > configured_threshold)
        ):
            reasons.append("threshold_failed")
        if not force and incumbent_metrics:
            incumbent_score = incumbent_metrics[metric]
            regressed = (
                candidate_score < incumbent_score + configured_delta
                if higher_is_better
                else candidate_score > incumbent_score - configured_delta
            )
            if regressed:
                reasons.append("regressed_against_incumbent")
        event = {
            "model_type": model_type,
            "version": version,
            "metric": metric,
            "candidate_metrics": candidate_metrics,
            "incumbent_metrics": incumbent_metrics,
        }
        if evaluation_error:
            event["evaluation_error"] = evaluation_error
        if reasons and not force:
            _record_promotion_event(
                model_type, {**event, "status": "refused", "reasons": reasons}
            )
            logger.warning(
                "Model promotion refused: type=%s version=%s reasons=%s metrics=%s",
                model_type, version, reasons, event,
            )
            return False
        if force:
            _record_promotion_event(model_type, {**event, "status": "forced"})
            logger.warning(
                "Forced model promotion: type=%s version=%s metrics=%s",
                model_type, version, event,
            )

    with _lock:
        _write_current_version(model_type, version)

    # Hot-swap in memory
    new_model = load_model(model_type, version)
    with _lock:
        _live_models[model_type] = new_model
        _live_versions[model_type] = version

    logger.info(
        f"Model promoted: type={model_type} version={version} "
        f"(zero-downtime swap complete)"
    )

    # Cached inference results from the previous model version must not be
    # served after promotion, so evict every entry for this model type.
    _invalidate_cached_inference(model_type)
    return True


def _invalidate_cached_inference(model_type: str) -> None:
    """
    Best-effort invalidation of cached inference results for a model type.

    Called after a model promotion so that entries produced by the previous
    model version are never served again. Runs in a worker/API process where
    Redis may be unavailable, so failures are logged and swallowed.
    """
    try:
        from cache_manager import CacheManager

        cache = CacheManager(namespace=model_type)
        cleared = cache.clear_namespace()
        logger.info(
            "Invalidated %d cached entries for model type=%s", cleared, model_type
        )
    except Exception as exc:
        logger.warning(
            "Cache invalidation skipped for model type=%s: %s", model_type, exc
        )


def get_live_model(model_type: str) -> Any:
    """
    Return the currently active in-memory model.
    Falls back to loading from disk if not yet warm.

    Args:
        model_type: e.g. "sentiment" or "price_predictor"

    Returns:
        The live model object.
    """
    with _lock:
        if model_type in _live_models:
            return _live_models[model_type]

    # Cold start: load from disk and cache
    model = load_model(model_type, "current")
    with _lock:
        _live_models[model_type] = model
        current_version = _read_current_version(model_type)
        if current_version is not None:
            _live_versions[model_type] = current_version
    return model


def list_versions(model_type: str) -> list:
    """Return sorted list of saved version strings for a model type."""
    d = _model_dir(model_type)
    versions = [
        p.stem for p in d.glob("v*.pkl")
    ]
    return sorted(versions)


def get_current_version(model_type: str) -> Optional[str]:
    """Return the currently promoted version string, or None."""
    with _lock:
        if model_type in _live_versions:
            return _live_versions[model_type]

    return _read_current_version(model_type)


def get_registry_status() -> dict[str, Any]:
    """Return a status snapshot of all registered model types."""
    status = {}
    if _MODELS_ROOT.exists():
        for model_dir in _MODELS_ROOT.iterdir():
            if model_dir.is_dir():
                mtype = model_dir.name
                status[mtype] = {
                    "current_version": get_current_version(mtype),
                    "available_versions": list_versions(mtype),
                    "live_in_memory": mtype in _live_models,
                    "shadow": get_shadow_status(mtype),
                    "current_metadata": load_metadata(mtype, "current"),
                }
    return status


# ---------------------------------------------------------------------------
# Shadow-mode deployment (Issue #1256)
# ---------------------------------------------------------------------------


def register_shadow(model_type: str, version: str) -> None:
    """
    Register a candidate model version to run in shadow mode.

    The shadow model runs alongside the live model: its predictions are
    logged for comparison but never returned to callers.

    Shadow model files are stored in the ``shadow/`` sub-directory to
    keep them separate from the promoted (live) model files.

    Args:
        model_type: e.g. "sentiment" or "price_predictor"
        version:    The version to shadow (must already be saved).
    """
    source_path = _version_path(model_type, version)
    if not source_path.exists():
        raise FileNotFoundError(
            f"Cannot shadow {model_type}@{version}: file not found at {source_path}"
        )

    # Copy the model file into the shadow directory so it is isolated
    # from the main versioned files.
    shadow_path = _shadow_version_path(model_type, version)
    if not shadow_path.exists():
        shutil.copy2(source_path, shadow_path)

    sym = _shadow_symlink_path(model_type)
    tmp_sym = sym.with_suffix(".tmp")

    if tmp_sym.exists() or tmp_sym.is_symlink():
        tmp_sym.unlink()
    tmp_sym.symlink_to(shadow_path.name)
    tmp_sym.rename(sym)

    # Load into memory for fast access
    shadow_model = load_model(model_type, version)
    with _shadow_lock:
        _shadow_models[model_type] = shadow_model
        _shadow_versions[model_type] = version

    logger.info(
        "Shadow model registered: type=%s version=%s (running alongside %s)",
        model_type,
        version,
        get_current_version(model_type),
    )


def unregister_shadow(model_type: str) -> None:
    """
    Remove a shadow model registration without promoting it.

    This is the rollback operation: the shadow model is discarded
    and the live model remains unchanged.
    """
    removed_version: Optional[str] = None
    with _shadow_lock:
        removed_version = _shadow_versions.pop(model_type, None)
        _shadow_models.pop(model_type, None)

    sym = _shadow_symlink_path(model_type)
    if sym.exists() or sym.is_symlink():
        sym.unlink()

    if removed_version:
        shadow_file = _shadow_version_path(model_type, removed_version)
        if shadow_file.exists():
            shadow_file.unlink()

    logger.info(
        "Shadow model unregistered: type=%s was=%s (live model unchanged)",
        model_type,
        removed_version,
    )


def promote_shadow(model_type: str) -> None:
    """
    Promote the shadow model to live with zero downtime.

    The shadow model becomes the current live model via an atomic symlink
    swap. After promotion the shadow registration is cleared.

    If no shadow model is registered this is a no-op.
    """
    with _shadow_lock:
        shadow_version = _shadow_versions.get(model_type)
        if shadow_version is None:
            logger.warning(
                "No shadow model registered for '%s'; promote_shadow is a no-op",
                model_type,
            )
            return

    # Promote the shadow version using the standard mechanism
    promote_model(model_type, shadow_version)
    unregister_shadow(model_type)

    logger.info(
        "Shadow model promoted to live: type=%s version=%s",
        model_type,
        shadow_version,
    )


def get_shadow_model(model_type: str) -> Optional[Any]:
    """Return the shadow model if registered, or None."""
    with _shadow_lock:
        return _shadow_models.get(model_type)


def get_shadow_version(model_type: str) -> Optional[str]:
    """Return the shadow model version string, or None."""
    with _shadow_lock:
        return _shadow_versions.get(model_type)


def get_shadow_status(model_type: str) -> Optional[dict[str, Any]]:
    """Return shadow deployment status for a model type, or None."""
    shadow_version = get_shadow_version(model_type)
    if shadow_version is None:
        # Check on-disk too (cold-start resilience)
        sym = _shadow_symlink_path(model_type)
        if sym.exists():
            try:
                shadow_version = sym.resolve().stem
            except Exception:
                return None
        else:
            return None

    return {
        "shadow_version": shadow_version,
        "live_version": get_current_version(model_type),
        "shadow_loaded": model_type in _shadow_models,
    }


def get_all_shadow_status() -> dict[str, Any]:
    """Return shadow status for all model types that have a shadow deployment."""
    result: dict[str, Any] = {}
    if _MODELS_ROOT.exists():
        for model_dir in _MODELS_ROOT.iterdir():
            if model_dir.is_dir():
                mtype = model_dir.name
                shadow = get_shadow_status(mtype)
                if shadow is not None:
                    result[mtype] = shadow
    return result


# ---------------------------------------------------------------------------
# Shadow comparison logging (Issue #1256, leverages Issue #9 logging)
# ---------------------------------------------------------------------------


@dataclasses.dataclass
class ComparisonEntry:
    """A single prediction comparison between live and shadow models."""

    timestamp: str
    model_type: str
    live_version: str
    shadow_version: str
    input_hash: str  # hash of input for traceability (not raw input for privacy)
    live_prediction: Any
    shadow_prediction: Any
    agreement: bool
    divergence_type: str
    # One of: exact_match, direction_same, direction_opposite, magnitude_diff
    latency_live_ms: float
    latency_shadow_ms: float
    shadow_timed_out: bool = False


# In-memory ring buffer to reduce disk I/O
_comparison_buffer: dict[str, list[ComparisonEntry]] = {}


def log_comparison(entry: ComparisonEntry) -> None:
    """
    Record a prediction comparison between live and shadow models.

    Comparisons are buffered in-memory and periodically flushed to disk
    as JSONL in ``models/<type>/shadow/comparison_log.jsonl``.
    """
    model_type = entry.model_type
    with _shadow_lock:
        if model_type not in _comparison_buffer:
            _comparison_buffer[model_type] = []
        buf = _comparison_buffer[model_type]
        buf.append(entry)

        # Flush when buffer exceeds threshold
        if len(buf) >= _MAX_IN_MEMORY_COMPARISONS:
            _flush_comparisons(model_type)


def _flush_comparisons(model_type: str) -> None:
    """Write buffered comparisons to disk."""
    buf = _comparison_buffer.get(model_type, [])
    if not buf:
        return

    path = _comparison_log_path(model_type)
    with open(path, "a") as fh:
        for entry in buf:
            fh.write(json.dumps(dataclasses.asdict(entry), default=str) + "\n")

    logger.debug(
        "Flushed %d comparison entries for '%s' to %s",
        len(buf),
        model_type,
        path,
    )
    _comparison_buffer[model_type] = []


def flush_all_comparisons() -> None:
    """Flush all buffered comparisons to disk (call on shutdown)."""
    with _shadow_lock:
        for mtype in list(_comparison_buffer.keys()):
            _flush_comparisons(mtype)


def read_comparison_log(
    model_type: str,
    window_hours: int = 24,
    limit: int = 10000,
) -> list[dict[str, Any]]:
    """
    Read comparison log entries for a model type within a time window.

    Args:
        model_type:    e.g. "sentiment" or "price_predictor"
        window_hours:  Only include entries within this many hours from now.
        limit:         Maximum number of entries to return.

    Returns:
        List of comparison entry dicts, most recent first.
    """
    path = _comparison_log_path(model_type)
    if not path.exists():
        return []

    cutoff = datetime.now(timezone.utc) - timedelta(hours=window_hours)
    entries: list[dict[str, Any]] = []

    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                ts = entry.get("timestamp", "")
                if ts:
                    try:
                        entry_time = datetime.fromisoformat(ts)
                        if entry_time < cutoff:
                            continue
                    except ValueError:
                        pass  # accept entry if we can't parse its timestamp
                entries.append(entry)
            except json.JSONDecodeError:
                continue

    # Most recent first and apply limit
    entries.reverse()
    return entries[:limit]


def generate_comparison_report(
    model_type: str,
    window_hours: int = 24,
) -> Optional[dict[str, Any]]:
    """
    Generate a comparison report between live and shadow model predictions.

    The report summarizes:
      - Agreement rate (exact match and directional agreement)
      - Divergence patterns
      - Latency overhead statistics
      - Timeout occurrences

    Args:
        model_type:    e.g. "sentiment" or "price_predictor"
        window_hours:  Time window for the report.

    Returns:
        Report dict or None if no comparison data is available.
    """
    entries = read_comparison_log(model_type, window_hours)
    if not entries:
        return None

    total = len(entries)
    agreements = sum(1 for e in entries if e.get("agreement"))
    timeouts = sum(1 for e in entries if e.get("shadow_timed_out"))

    # Divergence type breakdown
    divergence_counts: dict[str, int] = {}
    for e in entries:
        dt = e.get("divergence_type", "unknown")
        divergence_counts[dt] = divergence_counts.get(dt, 0) + 1

    # Latency statistics (only non-timeout entries)
    live_latencies = [
        e["latency_live_ms"]
        for e in entries
        if not e.get("shadow_timed_out") and "latency_live_ms" in e
    ]
    shadow_latencies = [
        e["latency_shadow_ms"]
        for e in entries
        if not e.get("shadow_timed_out") and "latency_shadow_ms" in e
    ]

    def _pct(part: int, whole: int) -> str:
        if whole == 0:
            return "0.0%"
        return f"{part / whole * 100:.1f}%"

    report: dict[str, Any] = {
        "model_type": model_type,
        "window_hours": window_hours,
        "total_comparisons": total,
        "agreement_rate": _pct(agreements, total),
        "agreement_count": agreements,
        "divergence_count": total - agreements,
        "divergence_breakdown": divergence_counts,
        "timeout_count": timeouts,
        "timeout_rate": _pct(timeouts, total),
        "latency_stats": {
            "live_avg_ms": round(sum(live_latencies) / max(len(live_latencies), 1), 2),
            "live_p50_ms": _percentile(live_latencies, 50),
            "live_p99_ms": _percentile(live_latencies, 99),
            "shadow_avg_ms": round(
                sum(shadow_latencies) / max(len(shadow_latencies), 1), 2
            ),
            "shadow_p50_ms": _percentile(shadow_latencies, 50),
            "shadow_p99_ms": _percentile(shadow_latencies, 99),
            "overhead_avg_ms": round(
                (sum(shadow_latencies) / max(len(shadow_latencies), 1))
                - (sum(live_latencies) / max(len(live_latencies), 1)),
                2,
            ),
        },
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    # Add recommendation
    agreement_pct = (agreements / total * 100) if total > 0 else 0.0
    if agreement_pct >= 99.0 and timeouts == 0:
        report["recommendation"] = (
            "Shadow model is in near-perfect agreement with live. "
            "Safe to promote."
        )
    elif agreement_pct >= 95.0:
        report["recommendation"] = (
            "High agreement. Review divergence patterns before promoting."
        )
    elif agreement_pct >= 80.0:
        report["recommendation"] = (
            "Moderate agreement. Investigate divergence before promoting."
        )
    else:
        report["recommendation"] = (
            "Low agreement. Shadow model may have a regression. "
            "Do not promote without investigation."
        )

    return report


def _percentile(values: list[float], pct: float) -> float:
    """Compute the pct-th percentile of a list of numeric values."""
    if not values:
        return 0.0
    sorted_vals = sorted(values)
    k = (len(sorted_vals) - 1) * pct / 100.0
    f = int(k)
    c = f + 1
    if c >= len(sorted_vals):
        return round(sorted_vals[-1], 2)
    d0 = sorted_vals[f] * (c - k)
    d1 = sorted_vals[c] * (k - f)
    return round(d0 + d1, 2)


def clear_comparison_log(model_type: str) -> None:
    """Delete the comparison log for a model type (housekeeping)."""
    with _shadow_lock:
        _comparison_buffer.pop(model_type, None)
    path = _comparison_log_path(model_type)
    if path.exists():
        path.unlink()
        logger.info("Comparison log cleared for '%s'", model_type)

# ─── Model Card Integration ─────────────────────────────────────────────

def save_model_with_card(
    model_type: str,
    model_obj: Any,
    card_data: dict,
    version: Optional[str] = None,
) -> str:
    """
    Save a model and its model card together.

    Args:
        model_type: e.g. "sentiment" or "price_predictor"
        model_obj: The model object to save
        card_data: Dictionary with model card fields
        version: Optional explicit version

    Returns:
        The version string that was saved.
    """
    from model_card import ModelCard, TrainingDataInfo, HyperparametersInfo, EvaluationMetrics, FeatureSchema

    # Parse card data
    training = TrainingDataInfo(**card_data.get("training_data", {}))
    hyper = HyperparametersInfo(**card_data.get("hyperparameters", {}))
    metrics = EvaluationMetrics(**card_data.get("metrics", {}))
    feature = FeatureSchema(**card_data.get("feature_schema", {}))

    if version is None:
        version = _next_version(model_type)

    # Create model card
    card = ModelCard(
        version=version,
        model_type=model_type,
        created_at=datetime.now(timezone.utc).isoformat(),
        training_data=training,
        hyperparameters=hyper,
        metrics=metrics,
        feature_schema=feature,
        source_code_commit=card_data.get("source_code_commit"),
        training_script=card_data.get("training_script"),
        created_by=card_data.get("created_by"),
        custom=card_data.get("custom", {}),
    )

    # Save the model
    save_model(model_type, model_obj, version)

    # Save the card
    card_path = _model_dir(model_type) / f"{version}.card.json"
    card.save(card_path)

    logger.info(f"Model card saved: type={model_type} version={version}")
    return version


def load_model_card(model_type: str, version: str = "current") -> Optional[dict]:
    """
    Load the model card for a specific version.

    Args:
        model_type: e.g. "sentiment" or "price_predictor"
        version: Specific version or "current"

    Returns:
        Model card as dict, or None if not found.
    """
    if version == "current":
        version = get_current_version(model_type)
        if version is None:
            return None

    card_path = _model_dir(model_type) / f"{version}.card.json"
    if not card_path.exists():
        return None

    try:
        with open(card_path) as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return None


def get_registry_status_with_cards() -> dict:
    """
    Get registry status with model cards included for each version.

    Returns:
        Status dictionary with card information.
    """
    status = get_registry_status()

    for model_type, info in status.items():
        versions = info.get("available_versions", [])
        cards = []
        for v in versions:
            card = load_model_card(model_type, v)
            cards.append({
                "version": v,
                "has_card": card is not None,
                "card": card if card else None,
            })
        info["model_cards"] = cards

    return status
