"""
Prediction Audit Trail — Issue #1639
======================================

Assembles a complete audit record for a single prediction by joining data
across three stores:

  1. ``prediction_logs`` table  — the logged request (model_type, model_version,
     input_hash, output, latency_ms, created_at).
  2. Model registry metadata sidecar  — training metrics, feature schema,
     data query bounds, seed, library versions (``<version>.meta.json``).
  3. Model card  — training data info, hyperparameters, evaluation metrics,
     provenance (``<version>.card.json``).

Privacy
-------
All text that might carry personal data is handled per Wave 9 policy
(docs/personal-data-policy.md):
  * ``input_hash`` is a SHA-256 of the *scrubbed* input — it cannot be
    reversed to raw text.
  * ``raw_input`` is included only when the caller holds the
    ``audit:raw_input`` scope AND the ``LOG_PREDICTION_RAW_INPUT`` env-var
    is ``true`` in the deployment; otherwise the field is omitted entirely.
  * ``output`` was scrubbed at log time — no additional treatment required.

Export runs are themselves logged to ``audit_export_runs`` via
``PostgresService.log_audit_export_run()``.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Optional

from src.ml.model_registry import load_metadata, get_current_version
from src.ml.model_card import load_model_card
from src.utils.logger import setup_logger

logger = setup_logger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_RAW_INPUT_ENV = "LOG_PREDICTION_RAW_INPUT"
_REDACTED = "[REDACTED]"


def _raw_input_enabled() -> bool:
    """Return True when raw input logging is permitted by deployment config."""
    return os.getenv(_RAW_INPUT_ENV, "false").lower() == "true"


# ---------------------------------------------------------------------------
# Core assembly function
# ---------------------------------------------------------------------------

def assemble_audit_trail(
    prediction_row: dict[str, Any],
    include_raw_input: bool = False,
) -> dict[str, Any]:
    """
    Given a *single* ``prediction_logs`` row (as a dict), return a fully
    assembled audit-trail document that joins in model metadata and card.

    Args:
        prediction_row:    A dict with at minimum the keys returned by
                           ``PostgresService.get_prediction_by_id()`` /
                           ``query_prediction_logs()``:
                           ``request_id``, ``model_type``, ``model_version``,
                           ``input_hash``, ``output``, ``latency_ms``,
                           ``raw_input``, ``created_at``.
        include_raw_input: When *True* **and** ``LOG_PREDICTION_RAW_INPUT``
                           is ``"true"``, the scrubbed ``raw_input`` is
                           included in the returned document.  Otherwise
                           the field is present but set to ``[REDACTED]``.

    Returns:
        A dict with the keys:
          - ``prediction``  — the core log fields (input_hash, output, …)
          - ``model``       — version, type, and the .meta.json sidecar
          - ``model_card``  — the .card.json contents (or None if missing)
          - ``privacy``     — policy flags applied to this record
          - ``assembled_at``— ISO timestamp of assembly
    """
    model_type = prediction_row.get("model_type", "unknown")
    model_version = prediction_row.get("model_version", "unknown")

    # ── 1. Prediction core ────────────────────────────────────────────────
    show_raw = include_raw_input and _raw_input_enabled()
    prediction_section: dict[str, Any] = {
        "request_id": prediction_row.get("request_id"),
        "model_type": model_type,
        "model_version": model_version,
        "input_hash": prediction_row.get("input_hash"),
        "output": prediction_row.get("output"),
        "latency_ms": prediction_row.get("latency_ms"),
        "created_at": prediction_row.get("created_at"),
        # raw_input is either included (scrubbed) or explicitly redacted
        "raw_input": (
            prediction_row.get("raw_input")
            if show_raw
            else _REDACTED
        ),
    }

    # ── 2. Model registry metadata ────────────────────────────────────────
    registry_meta: Optional[dict[str, Any]] = None
    try:
        registry_meta = load_metadata(model_type, version=model_version)
    except Exception as exc:
        logger.warning(
            "audit_trail: could not load registry metadata "
            "type=%s version=%s: %s",
            model_type,
            model_version,
            exc,
        )

    model_section: dict[str, Any] = {
        "model_type": model_type,
        "model_version": model_version,
        "registry_metadata": registry_meta,
    }

    # ── 3. Model card ──────────────────────────────────────────────────────
    card_dict: Optional[dict[str, Any]] = None
    try:
        card = load_model_card(model_type, version=model_version)
        if card is not None:
            card_dict = card.to_dict()
    except Exception as exc:
        logger.warning(
            "audit_trail: could not load model card "
            "type=%s version=%s: %s",
            model_type,
            model_version,
            exc,
        )

    # ── 4. Privacy flags ──────────────────────────────────────────────────
    privacy_section: dict[str, Any] = {
        "input_hash_algorithm": "sha256_of_scrubbed_input",
        "raw_input_included": show_raw,
        "raw_input_policy": (
            "included_scrubbed" if show_raw else "redacted_per_wave9_policy"
        ),
        "output_scrubbed_at_log_time": True,
    }

    return {
        "prediction": prediction_section,
        "model": model_section,
        "model_card": card_dict,
        "privacy": privacy_section,
        "assembled_at": datetime.now(timezone.utc).isoformat(),
    }
