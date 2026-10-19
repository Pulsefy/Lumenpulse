# -*- coding: utf-8 -*-
"""
Shared model-loading façade for issue #1628.

Both the *inference service* (``src/api/server.py``) and the *batch/scheduler
service* (``src/main.py``) import their model access through this module.
This keeps the contract stable even if the underlying storage layer (currently
a file-based pickle registry) is swapped for a remote registry later.

Public surface
--------------
``warm_models(*model_types)``
    Pre-load one or more model types into the in-memory hot cache.  Call once
    at process startup so the first real request never pays a cold-start disk
    read.

``get_model(model_type)``
    Return the currently-live in-memory model object.  Thread-safe; falls back
    to a disk load if the cache is cold.

``get_model_version(model_type)``
    Return the string version tag of the currently promoted model (e.g. "v1.2").

``reload_model(model_type)``
    Force a fresh disk load and hot-swap the in-memory model.  Useful after the
    batch service has completed a retraining run and promoted a new version.

All heavy I/O and locking lives in ``src/ml/model_registry``; this module is a
thin, stable re-export layer with one extra helper (``warm_models``).
"""

from __future__ import annotations

import os
from typing import Any, Optional

from src.utils.logger import setup_logger

logger = setup_logger(__name__)

# ---------------------------------------------------------------------------
# Lazy import so this module can be imported even before the registry has been
# fully initialised (e.g. in lightweight test contexts).
# ---------------------------------------------------------------------------


def _registry():
    """Return the model_registry module (imported on first access)."""
    import importlib
    return importlib.import_module("src.ml.model_registry")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

#: Model types that the inference service needs loaded at startup.
INFERENCE_MODELS = ("sentiment", "price_predictor")


def warm_models(*model_types: str) -> dict[str, bool]:
    """
    Pre-warm the in-memory hot cache for each requested model type.

    Models that do not yet have a promoted version (e.g. fresh installs before
    the first retraining run) are skipped with a warning rather than raising so
    the service can still start up and serve endpoints that don't require the
    missing model.

    Args:
        *model_types: Variable number of model type strings.  Defaults to
            ``INFERENCE_MODELS`` when called with no arguments.

    Returns:
        Dict mapping each model type to ``True`` (loaded) / ``False`` (skipped).

    Example::

        from src.ml.model_loader import warm_models, INFERENCE_MODELS
        warm_models(*INFERENCE_MODELS)
    """
    targets = model_types if model_types else INFERENCE_MODELS
    results: dict[str, bool] = {}
    reg = _registry()

    for mtype in targets:
        try:
            reg.get_live_model(mtype)
            version = reg.get_current_version(mtype)
            logger.info(
                "Model pre-warmed: type=%s version=%s", mtype, version
            )
            results[mtype] = True
        except FileNotFoundError:
            logger.warning(
                "Model not yet available (no promoted version): type=%s — "
                "endpoint will return 503 until retraining runs.",
                mtype,
            )
            results[mtype] = False
        except Exception as exc:  # pragma: no cover
            logger.error(
                "Failed to pre-warm model type=%s: %s", mtype, exc, exc_info=True
            )
            results[mtype] = False

    return results


def get_model(model_type: str) -> Any:
    """
    Return the currently-live in-memory model for *model_type*.

    Delegates to ``model_registry.get_live_model`` which holds the model in a
    thread-safe in-memory dict and falls back to a disk read on cache miss.

    Raises:
        FileNotFoundError: when no version has been promoted yet.
    """
    return _registry().get_live_model(model_type)


def get_model_version(model_type: str) -> Optional[str]:
    """
    Return the currently promoted version string, or ``None`` if no version
    has been promoted yet.
    """
    return _registry().get_current_version(model_type)


def reload_model(model_type: str) -> Optional[str]:
    """
    Force a fresh disk load and hot-swap the in-memory model.

    This is the hook for the batch service to call after it has promoted a new
    model version so that an inference process running in the same OS (or
    sharing the same ``models/`` volume mount) picks up the update without
    restarting.  In a fully split deployment with separate containers the
    inference service detects the promotion via the ``current.json`` pointer
    change on the next ``get_live_model`` call anyway, but calling this
    explicitly makes the handoff immediate.

    Returns:
        The newly-loaded version string, or ``None`` if unavailable.
    """
    reg = _registry()
    try:
        version = reg._read_current_version(model_type)
        if version is None:
            logger.warning(
                "reload_model: no promoted version for type=%s — skipping",
                model_type,
            )
            return None
        model = reg.load_model(model_type, version)
        # Thread-safe hot-swap into the live cache.
        with reg._lock:
            reg._live_models[model_type] = model
            reg._live_versions[model_type] = version
        logger.info(
            "Model reloaded: type=%s version=%s", model_type, version
        )
        return version
    except Exception as exc:
        logger.error(
            "Failed to reload model type=%s: %s", model_type, exc, exc_info=True
        )
        return None


def list_available_models() -> dict[str, dict]:
    """
    Return a status snapshot of every registered model type.

    Delegates to ``model_registry.get_registry_status`` which walks the
    ``models/`` directory.  Safe to call at any time.
    """
    return _registry().get_registry_status()
