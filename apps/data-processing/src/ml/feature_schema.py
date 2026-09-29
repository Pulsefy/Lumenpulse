# -*- coding: utf-8 -*-
"""
Versioned feature-set schemas (#1239).

A model is only as trustworthy as the features it was trained on. If the
feature matrix produced at *serving* time silently changes shape or meaning
relative to what a model saw at *training* time, the model keeps returning
confident predictions that are quietly wrong — the classic silent-failure
mode for a deployed model.

This module gives every ML feature set an explicit, versioned schema:

* ``version``      — a human-curated ``<major>.<minor>`` string that is bumped
                     deliberately whenever the meaning/composition of a feature
                     set changes. It is recorded with each trained model so
                     serving can compare against it.
* ``fingerprint``  — a deterministic hash derived from the ordered
                     (name, dtype) pairs. It catches *accidental* structural
                     drift (a column added/removed/reordered/retyped) even when
                     someone forgets to bump ``version``.

The schema is the single source of truth shared by:
  - ``src/ml/feature_store.py``          (tags produced frames)
  - ``src/ml/price_predictor.py``        (records training version, guards serving)
  - ``src/ml/feature_drift_detector.py`` (per-feature distribution drift)
  - ``src/lineage/feature_lineage.yaml`` (documented lineage)
"""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence

from src.utils.logger import setup_logger

logger = setup_logger(__name__)

# Enforcement mode for the serving-vs-training schema check.
#   "strict" -> raise SchemaVersionMismatch and refuse to serve
#   "warn"   -> log loudly but still serve (default; safe for existing callers)
_ENFORCEMENT_ENV = "FEATURE_SCHEMA_ENFORCEMENT"
_DEFAULT_ENFORCEMENT = "warn"


class SchemaVersionMismatch(RuntimeError):
    """Raised (in strict mode) when serving/training schema versions differ."""

    def __init__(self, feature_set: str, training_version: str, serving_version: str):
        self.feature_set = feature_set
        self.training_version = training_version
        self.serving_version = serving_version
        super().__init__(
            f"Feature schema version mismatch for '{feature_set}': "
            f"model was trained on v{training_version} but serving is producing "
            f"v{serving_version}. Refusing to serve a model against features it "
            f"was not trained on. Retrain/promote a model for the current schema, "
            f"or set {_ENFORCEMENT_ENV}=warn to downgrade this to a warning."
        )


@dataclass(frozen=True)
class FeatureSpec:
    """A single feature's contract within a feature set."""

    name: str
    dtype: str
    description: str = ""

    def key(self) -> str:
        return f"{self.name}:{self.dtype}"


@dataclass(frozen=True)
class FeatureSchema:
    """An ordered, versioned contract for one ML feature set."""

    feature_set: str
    version: str
    features: Sequence[FeatureSpec]

    @property
    def feature_names(self) -> List[str]:
        return [f.name for f in self.features]

    @property
    def fingerprint(self) -> str:
        """
        Deterministic short hash of the ordered (name, dtype) pairs.

        Independent of ``version`` on purpose: two schemas with the same
        declared version but different columns will have different
        fingerprints, which is exactly how accidental drift is caught.
        """
        payload = "|".join(spec.key() for spec in self.features)
        digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
        return digest[:12]

    def to_dict(self) -> Dict[str, object]:
        return {
            "feature_set": self.feature_set,
            "version": self.version,
            "fingerprint": self.fingerprint,
            "features": [
                {"name": f.name, "dtype": f.dtype, "description": f.description}
                for f in self.features
            ],
        }


# ---------------------------------------------------------------------------
# Registered schemas
# ---------------------------------------------------------------------------
#
# The price-predictor feature set as produced by FeatureStore.get_features_for_asset:
# an outer-merged, time-aligned matrix of sentiment / volume / volatility. The
# leading ``timestamp`` column is an index, not a model feature, so it is not
# part of the trained-feature contract.
PRICE_PREDICTOR_FEATURE_SET = "price_predictor_features"

_PRICE_PREDICTOR_SCHEMA = FeatureSchema(
    feature_set=PRICE_PREDICTOR_FEATURE_SET,
    version="1.0",
    features=(
        FeatureSpec("sentiment_score", "float64", "Compound sentiment score [-1, 1]"),
        FeatureSpec("volume", "float64", "XLM-equivalent on-chain volume [0, +inf)"),
        FeatureSpec("volatility", "float64", "Rolling log-return volatility [0, +inf)"),
    ),
)

_SCHEMAS: Dict[str, FeatureSchema] = {
    _PRICE_PREDICTOR_SCHEMA.feature_set: _PRICE_PREDICTOR_SCHEMA,
}


def current_feature_schema(
    feature_set: str = PRICE_PREDICTOR_FEATURE_SET,
) -> FeatureSchema:
    """Return the active schema for a feature set."""
    try:
        return _SCHEMAS[feature_set]
    except KeyError as exc:
        raise KeyError(
            f"No registered feature schema for '{feature_set}'. "
            f"Known feature sets: {sorted(_SCHEMAS)}"
        ) from exc


def get_enforcement_mode() -> str:
    """Read the serving-schema enforcement mode from the environment."""
    mode = os.getenv(_ENFORCEMENT_ENV, _DEFAULT_ENFORCEMENT).strip().lower()
    if mode not in ("strict", "warn"):
        logger.warning(
            "Unknown %s=%r; falling back to %r",
            _ENFORCEMENT_ENV,
            mode,
            _DEFAULT_ENFORCEMENT,
        )
        return _DEFAULT_ENFORCEMENT
    return mode


def check_serving_schema(
    training_version: Optional[str],
    serving_version: Optional[str],
    feature_set: str = PRICE_PREDICTOR_FEATURE_SET,
) -> bool:
    """
    Compare the schema version a model was trained on against the version the
    serving pipeline is currently producing.

    Returns ``True`` when the versions match (or when there is nothing to check,
    e.g. a legacy model with no recorded training version).

    On mismatch:
      * strict mode -> raises :class:`SchemaVersionMismatch`
      * warn mode   -> logs a loud warning and returns ``False``
    """
    # A legacy model with no recorded training version can't be checked; do not
    # break it, but make the gap visible.
    if training_version is None:
        logger.warning(
            "Serving a model for '%s' with no recorded training schema version; "
            "schema-drift protection is disabled for this model. Retrain to "
            "record a version.",
            feature_set,
        )
        return True

    effective_serving = serving_version or current_feature_schema(feature_set).version
    if training_version == effective_serving:
        return True

    # Import here to avoid a hard dependency on prometheus at module import time
    # for callers that only need schema helpers.
    try:
        from src.utils.metrics import FEATURE_SCHEMA_MISMATCH_TOTAL

        FEATURE_SCHEMA_MISMATCH_TOTAL.labels(feature_set=feature_set).inc()
    except Exception:  # pragma: no cover - metrics are best-effort
        pass

    mode = get_enforcement_mode()
    if mode == "strict":
        raise SchemaVersionMismatch(feature_set, training_version, effective_serving)

    logger.warning(
        "⚠️  Feature schema version mismatch for '%s': model trained on v%s but "
        "serving is producing v%s. Predictions may be silently wrong. "
        "(%s=warn, so serving continues.)",
        feature_set,
        training_version,
        effective_serving,
        _ENFORCEMENT_ENV,
    )
    return False


def validate_frame_columns(
    columns: Sequence[str],
    feature_set: str = PRICE_PREDICTOR_FEATURE_SET,
) -> List[str]:
    """
    Return the list of schema feature names missing from ``columns``.

    An empty list means every declared feature is present (extra columns such
    as ``timestamp`` or a caller-set ``target`` are allowed).
    """
    schema = current_feature_schema(feature_set)
    present = set(columns)
    return [name for name in schema.feature_names if name not in present]


def schema_metadata(
    feature_set: str = PRICE_PREDICTOR_FEATURE_SET,
) -> Dict[str, str]:
    """Compact (version, fingerprint) pair recorded alongside a trained model."""
    schema = current_feature_schema(feature_set)
    return {
        "feature_set": feature_set,
        "schema_version": schema.version,
        "schema_fingerprint": schema.fingerprint,
    }


def dumps_schema(feature_set: str = PRICE_PREDICTOR_FEATURE_SET) -> str:
    """JSON representation of a schema (used by tooling / debugging)."""
    return json.dumps(current_feature_schema(feature_set).to_dict(), indent=2)
