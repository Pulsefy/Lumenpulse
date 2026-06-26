"""
Model Registry - versioned model storage with atomic zero-downtime swap.

Versions follow semver-lite: v<major>.<minor>  (e.g. v1.0, v1.1, v2.0)
Each model type (sentiment, price_predictor) is stored independently.

Directory layout:
  models/
    sentiment/
      v1.0.pkl
      v1.1.pkl
      current -> v1.1.pkl   (symlink, updated atomically)
    price_predictor/
      v1.0.pkl
      current -> v1.0.pkl
"""

import os
import pickle
import shutil
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from src.utils.logger import setup_logger

logger = setup_logger(__name__)

_MODELS_ROOT = Path(os.getenv("MODEL_REGISTRY_PATH", "./models"))

# In-memory hot-swap: the live model is held here so the API never reads disk
# during inference. A reentrant read-write lock guards concurrent access.
_live_models: Dict[str, Any] = {}
_live_versions: Dict[str, str] = {}
_lock = threading.RLock()


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _model_dir(model_type: str) -> Path:
    d = _MODELS_ROOT / model_type
    d.mkdir(parents=True, exist_ok=True)
    return d


def _symlink_path(model_type: str) -> Path:
    return _model_dir(model_type) / "current"


def _version_path(model_type: str, version: str) -> Path:
    return _model_dir(model_type) / f"{version}.pkl"


def _next_version(model_type: str) -> str:
    """Increment the minor version of the latest saved model."""
    existing = list_versions(model_type)
    if not existing:
        return "v1.0"
    # Parse the highest version
    def _parse(v: str) -> Tuple[int, int]:
        parts = v.lstrip("v").split(".")
        return int(parts[0]), int(parts[1])

    major, minor = max(_parse(v) for v in existing)
    return f"v{major}.{minor + 1}"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def save_model(model_type: str, model_obj: Any, version: Optional[str] = None) -> str:
    """
    Persist a trained model to disk and return the version string.

    Args:
        model_type: e.g. "sentiment" or "price_predictor"
        model_obj:  The object to pickle (sklearn pipeline, VADER lexicon dict, …)
        version:    Explicit version string; auto-incremented if omitted.

    Returns:
        The version string that was saved (e.g. "v1.2").
    """
    if version is None:
        version = _next_version(model_type)

    path = _version_path(model_type, version)
    with open(path, "wb") as fh:
        pickle.dump(model_obj, fh, protocol=pickle.HIGHEST_PROTOCOL)

    logger.info(f"Model saved: type={model_type} version={version} path={path}")
    return version


def load_model(model_type: str, version: str = "current") -> Any:
    """
    Load a model from disk.

    Args:
        model_type: e.g. "sentiment" or "price_predictor"
        version:    Specific version string or "current" (follows symlink).

    Returns:
        The unpickled model object.
    """
    if version == "current":
        sym = _symlink_path(model_type)
        if not sym.exists():
            raise FileNotFoundError(
                f"No current model for '{model_type}'. Run retraining first."
            )
        path = sym.resolve()
    else:
        path = _version_path(model_type, version)

    if not path.exists():
        raise FileNotFoundError(f"Model not found: {path}")

    with open(path, "rb") as fh:
        obj = pickle.load(fh)

    logger.info(f"Model loaded from disk: type={model_type} version={version}")
    return obj


def promote_model(model_type: str, version: str) -> None:
    """
    Atomically promote a saved version to 'current' (zero-downtime swap).

    The on-disk symlink is updated atomically via a rename, and the
    in-memory hot model is swapped under the RLock so in-flight requests
    finish with the old model while new requests immediately use the new one.

    Args:
        model_type: e.g. "sentiment" or "price_predictor"
        version:    The version to promote (must already be saved).
    """
    target = _version_path(model_type, version)
    if not target.exists():
        raise FileNotFoundError(
            f"Cannot promote {model_type}@{version}: file not found at {target}"
        )

    sym = _symlink_path(model_type)
    tmp_sym = sym.with_suffix(".tmp")

    # Atomic symlink swap (POSIX rename is atomic)
    if tmp_sym.exists() or tmp_sym.is_symlink():
        tmp_sym.unlink()
    tmp_sym.symlink_to(target.name)
    tmp_sym.rename(sym)

    # Hot-swap in memory
    new_model = load_model(model_type, version)
    with _lock:
        _live_models[model_type] = new_model
        _live_versions[model_type] = version

    logger.info(f"Model promoted: type={model_type} version={version} (zero-downtime swap complete)")


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
        sym = _symlink_path(model_type)
        if sym.exists():
            _live_versions[model_type] = sym.resolve().stem  # filename without .pkl
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

    sym = _symlink_path(model_type)
    if sym.exists():
        return sym.resolve().stem
    return None


def get_registry_status() -> Dict[str, Any]:
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
                }
    return status
