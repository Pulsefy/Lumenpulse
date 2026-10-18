"""
Serving-side compute cost attribution (Issue #1643).

The pipeline side profiles cost per stage (#1454); this module covers the
*serving* side: every model inference executed by an API endpoint is charged
for the compute it consumed and attributed to the model version that produced
it and the endpoint (serving path) it was served from.

Cost model
----------
Compute cost is measured, not guessed::

    cost_usd = compute_seconds * hourly_rate_usd / 3600

``compute_seconds`` is the wall-clock time of the inference call itself. The
hourly rate is configurable and resolved in this precedence order:

1. ``SERVING_COST_RATES_JSON`` — a JSON object mapping
   ``"<model_type>@<model_version>"`` to a USD/hour rate, e.g.
   ``{"sentiment@v1.2": 0.40}``. Lets a more expensive model version be
   priced differently from its predecessor.
2. ``SERVING_COST_PER_HOUR_USD_<MODEL_TYPE>`` — per model type, e.g.
   ``SERVING_COST_PER_HOUR_USD_SENTIMENT=0.25``.
3. ``SERVING_COST_PER_HOUR_USD`` — global default rate.

Reported data
-------------
* Cost attributed per model version and per endpoint.
* Cost per thousand inferences, per model version (and per endpoint).
* Cost delta of a newly promoted model version against its predecessor
  (recorded on promotion and refreshed as the new version accrues traffic).
* The most expensive serving paths, ranked by attributed cost.

Everything is exported through the Prometheus default registry, so it shows up
on ``GET /metrics`` alongside the stage-level profiling from #1454, and is
served as a report from ``GET /model/cost-report``.

Counter/gauge accumulators are per-process (like every other metric here);
they reset when the API process restarts.
"""

from __future__ import annotations

import json
import os
import re
import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from prometheus_client import Counter, Gauge

from src.utils.logger import setup_logger

logger = setup_logger(__name__)

SECONDS_PER_HOUR = 3600.0

# USD/hour used when no rate is configured anywhere. Roughly the cost of a
# small container CPU-hour; tune it with the env vars documented above.
DEFAULT_HOURLY_RATE_USD = 0.05

# Fallback model version when neither the caller nor the registry knows it.
UNKNOWN_VERSION = "unknown"

# ---------------------------------------------------------------------------
# Prometheus metrics (exported alongside the #1454 stage-level profiling)
# ---------------------------------------------------------------------------

SERVING_INFERENCES_TOTAL = Counter(
    "lumenpulse_serving_inferences_total",
    "Total model inferences served, attributed per model version and endpoint",
    ["model_type", "model_version", "endpoint"],
)

SERVING_COST_USD_TOTAL = Counter(
    "lumenpulse_serving_compute_cost_usd_total",
    "Attributed serving compute cost in USD, per model version and endpoint",
    ["model_type", "model_version", "endpoint"],
)

SERVING_COST_PER_1K_USD = Gauge(
    "lumenpulse_serving_cost_per_1k_inferences_usd",
    "Cost per thousand inferences in USD, per model version and endpoint",
    ["model_type", "model_version", "endpoint"],
)

SERVING_MODEL_COST_PER_1K_USD = Gauge(
    "lumenpulse_serving_model_cost_per_1k_inferences_usd",
    "Cost per thousand inferences in USD, per model version across all endpoints",
    ["model_type", "model_version"],
)

SERVING_PATH_COST_USD_TOTAL = Counter(
    "lumenpulse_serving_path_cost_usd_total",
    "Attributed serving compute cost in USD per serving path (endpoint)",
    ["endpoint"],
)

SERVING_PROMOTION_COST_DELTA_USD_PER_1K = Gauge(
    "lumenpulse_serving_promotion_cost_delta_usd_per_1k",
    "Cost per thousand inferences delta of the newly promoted model version "
    "against its predecessor (positive = the new version is more expensive)",
    ["model_type", "from_version", "to_version"],
)

# ---------------------------------------------------------------------------
# In-process attribution state
# ---------------------------------------------------------------------------

# (model_type, model_version, endpoint) -> {"inferences": float, "cost_usd": float}
_usage: Dict[Tuple[str, str, str], Dict[str, float]] = {}
# endpoint -> {"inferences": float, "cost_usd": float}
_paths: Dict[str, Dict[str, float]] = {}
# model_type -> {"from_version": str, "to_version": str}
_last_promotion: Dict[str, Dict[str, str]] = {}
# model_type -> latest cost-per-1k delta (None while data is insufficient)
_promotion_deltas: Dict[str, Optional[float]] = {}

_state_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Rate configuration
# ---------------------------------------------------------------------------


def _env_slug(model_type: str) -> str:
    """Normalize a model type for use in an env var name (``price-predictor``
    -> ``PRICE_PREDICTOR``)."""
    return re.sub(r"[^A-Za-z0-9]+", "_", model_type).upper()


def get_hourly_rate_usd(model_type: str, model_version: str) -> float:
    """
    Return the configured USD/hour compute rate for a model version.

    Version-specific rates from ``SERVING_COST_RATES_JSON`` win over
    per-model-type rates, which win over the global
    ``SERVING_COST_PER_HOUR_USD`` rate. Unknown/invalid values fall back to
    the next level; an unparsable global rate falls back to the default.
    """
    raw_json = os.getenv("SERVING_COST_RATES_JSON", "").strip()
    if raw_json:
        try:
            rates = json.loads(raw_json)
        except ValueError:
            logger.warning("Invalid SERVING_COST_RATES_JSON; ignoring it")
            rates = {}
        if isinstance(rates, dict):
            for key in (f"{model_type}@{model_version}", model_type):
                value = rates.get(key)
                rate = _coerce_rate(value)
                if rate is not None:
                    return rate

    raw_type = os.getenv(f"SERVING_COST_PER_HOUR_USD_{_env_slug(model_type)}", "")
    rate = _coerce_rate(raw_type)
    if rate is not None:
        return rate

    rate = _coerce_rate(os.getenv("SERVING_COST_PER_HOUR_USD", ""))
    if rate is not None:
        return rate

    return DEFAULT_HOURLY_RATE_USD


def _coerce_rate(value: Any) -> Optional[float]:
    """Parse a rate value, returning ``None`` when it is absent or invalid."""
    if value is None or value == "":
        return None
    try:
        rate = float(value)
    except (TypeError, ValueError):
        return None
    return rate if rate >= 0 else None


# ---------------------------------------------------------------------------
# Attribution
# ---------------------------------------------------------------------------


def _resolve_version(model_type: str, model_version: Optional[str]) -> str:
    """Use the caller's version, else the live registry pointer, else 'unknown'."""
    if model_version:
        return model_version
    try:
        from src.ml.model_registry import get_current_version

        current = get_current_version(model_type)
        if current:
            return current
    except Exception as exc:  # pragma: no cover - registry unavailable
        logger.debug("Could not resolve live model version: %s", exc)
    return UNKNOWN_VERSION


def _cost_per_1k(cost_usd: float, inferences: float) -> Optional[float]:
    """Cost per thousand inferences, or None when nothing has been served."""
    if inferences <= 0:
        return None
    return cost_usd / inferences * 1000.0


def _model_totals(
    model_type: str, model_version: Optional[str] = None
) -> Dict[str, float]:
    """Aggregate inferences and cost for a model (optionally one version)."""
    total = {"inferences": 0.0, "cost_usd": 0.0}
    with _state_lock:
        for (mtype, mversion, _endpoint), agg in _usage.items():
            if mtype != model_type:
                continue
            if model_version is not None and mversion != model_version:
                continue
            total["inferences"] += agg["inferences"]
            total["cost_usd"] += agg["cost_usd"]
    return total


def record_inference(
    model_type: str,
    endpoint: str,
    duration_seconds: float,
    model_version: Optional[str] = None,
    count: int = 1,
) -> float:
    """
    Attribute compute cost for one or more inferences served by an endpoint.

    Args:
        model_type:        Model family, e.g. ``sentiment`` or ``embedding``.
        endpoint:          Serving path, e.g. ``/analyze``.
        duration_seconds:  Wall-clock compute time of the inference call.
        model_version:     Version that produced the prediction. Defaults to
                           the live registry pointer for ``model_type``.
        count:             Number of inferences represented by this call
                           (e.g. a batch request's item count).

    Returns:
        The attributed cost in USD for this call.
    """
    if count <= 0:
        return 0.0
    version = _resolve_version(model_type, model_version)
    seconds = max(float(duration_seconds), 0.0)
    cost_usd = seconds * get_hourly_rate_usd(model_type, version) / SECONDS_PER_HOUR

    key = (model_type, version, endpoint)
    with _state_lock:
        agg = _usage.setdefault(key, {"inferences": 0.0, "cost_usd": 0.0})
        agg["inferences"] += count
        agg["cost_usd"] += cost_usd

        path_agg = _paths.setdefault(endpoint, {"inferences": 0.0, "cost_usd": 0.0})
        path_agg["inferences"] += count
        path_agg["cost_usd"] += cost_usd

        model_inferences = 0.0
        model_cost = 0.0
        for (mtype, mversion, _endpoint), other in _usage.items():
            if mtype == model_type and mversion == version:
                model_inferences += other["inferences"]
                model_cost += other["cost_usd"]

    SERVING_INFERENCES_TOTAL.labels(
        model_type=model_type, model_version=version, endpoint=endpoint
    ).inc(count)
    SERVING_COST_USD_TOTAL.labels(
        model_type=model_type, model_version=version, endpoint=endpoint
    ).inc(cost_usd)
    SERVING_PATH_COST_USD_TOTAL.labels(endpoint=endpoint).inc(cost_usd)

    per_1k = _cost_per_1k(agg["cost_usd"], agg["inferences"])
    if per_1k is not None:
        SERVING_COST_PER_1K_USD.labels(
            model_type=model_type, model_version=version, endpoint=endpoint
        ).set(per_1k)
    model_per_1k = _cost_per_1k(model_cost, model_inferences)
    if model_per_1k is not None:
        SERVING_MODEL_COST_PER_1K_USD.labels(
            model_type=model_type, model_version=version
        ).set(model_per_1k)

    # A promoted version keeps accruing traffic; refresh its delta against the
    # predecessor so the reported delta reflects observed cost, not a stale
    # (or still unknown) value.
    _refresh_promotion_delta(model_type)

    logger.debug(
        "Serving cost recorded: type=%s version=%s endpoint=%s "
        "inferences=%d cost_usd=%.6f",
        model_type,
        version,
        endpoint,
        count,
        cost_usd,
    )
    return cost_usd


# ---------------------------------------------------------------------------
# Promotion cost delta
# ---------------------------------------------------------------------------


def get_cost_per_1k(
    model_type: str, model_version: Optional[str] = None
) -> Optional[float]:
    """Cost per thousand inferences for a model (optionally one version)."""
    totals = _model_totals(model_type, model_version)
    return _cost_per_1k(totals["cost_usd"], totals["inferences"])


def _compute_promotion_delta(
    model_type: str, from_version: str, to_version: str
) -> Optional[float]:
    """Cost-per-1k delta of ``to_version`` against ``from_version``, or None
    when either side has not served enough traffic to be measured."""
    predecessor = get_cost_per_1k(model_type, from_version)
    promoted = get_cost_per_1k(model_type, to_version)
    if predecessor is None or promoted is None:
        return None
    return promoted - predecessor


def _publish_promotion_delta(
    model_type: str, from_version: str, to_version: str, delta: Optional[float]
) -> None:
    _promotion_deltas[model_type] = delta
    if delta is not None:
        SERVING_PROMOTION_COST_DELTA_USD_PER_1K.labels(
            model_type=model_type,
            from_version=from_version,
            to_version=to_version,
        ).set(delta)


def record_promotion(
    model_type: str, from_version: Optional[str], to_version: str
) -> Optional[float]:
    """
    Record that ``to_version`` was promoted over ``from_version`` (#1643).

    The cost-per-thousand-inferences delta of the new version against its
    predecessor is exported as a metric and kept for the cost report. When
    either version has no attributed traffic yet the delta is ``None`` and is
    recomputed (and exported) as soon as both versions have served requests.

    Returns:
        The delta in USD per thousand inferences, or ``None`` when it cannot
        be measured yet (first promotion, or no traffic yet).
    """
    if not from_version or from_version == to_version:
        return None

    delta = _compute_promotion_delta(model_type, from_version, to_version)
    with _state_lock:
        _last_promotion[model_type] = {
            "from_version": from_version,
            "to_version": to_version,
        }
        _publish_promotion_delta(model_type, from_version, to_version, delta)

    if delta is None:
        logger.info(
            "Promotion cost delta not yet measurable: type=%s %s -> %s",
            model_type,
            from_version,
            to_version,
        )
    else:
        logger.info(
            "Promotion cost delta: type=%s %s -> %s delta_usd_per_1k=%.6f",
            model_type,
            from_version,
            to_version,
            delta,
        )
    return delta


def _refresh_promotion_delta(model_type: str) -> None:
    """Recompute the pending delta for the latest promotion of ``model_type``."""
    with _state_lock:
        promotion = _last_promotion.get(model_type)
        if promotion is None:
            return
        if _promotion_deltas.get(model_type) is not None:
            return
        from_version = promotion["from_version"]
        to_version = promotion["to_version"]
    delta = _compute_promotion_delta(model_type, from_version, to_version)
    if delta is not None:
        with _state_lock:
            _publish_promotion_delta(model_type, from_version, to_version, delta)
        logger.info(
            "Promotion cost delta became measurable: type=%s %s -> %s "
            "delta_usd_per_1k=%.6f",
            model_type,
            from_version,
            to_version,
            delta,
        )


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------


def get_top_serving_paths(limit: int = 3) -> List[Dict[str, Any]]:
    """
    Return the most expensive serving paths (endpoints) by attributed cost.

    Each entry carries the endpoint, its attributed cost, the inferences it
    served, and its share of total attributed serving cost.
    """
    with _state_lock:
        entries: List[Dict[str, Any]] = [
            {
                "endpoint": endpoint,
                "inferences": agg["inferences"],
                "compute_cost_usd": agg["cost_usd"],
            }
            for endpoint, agg in _paths.items()
        ]
        total: float = sum(entry["compute_cost_usd"] for entry in entries)

    entries.sort(key=lambda entry: entry["compute_cost_usd"], reverse=True)
    ranked = entries[: max(limit, 0)]
    for rank, entry in enumerate(ranked, start=1):
        entry["rank"] = rank
        entry["inferences"] = int(entry["inferences"])
        entry["share_of_total_cost_pct"] = (
            round(entry["compute_cost_usd"] / total * 100.0, 2) if total > 0 else 0.0
        )
    return ranked


def get_cost_report() -> Dict[str, Any]:
    """
    Full serving cost report (#1643).

    Contains per-model-version attribution with cost per thousand inferences,
    per-endpoint (serving path) attribution, the three most expensive serving
    paths, and the cost delta of each newly promoted model against its
    predecessor.
    """
    with _state_lock:
        usage: Dict[Tuple[str, str, str], Dict[str, float]] = {
            key: dict(agg) for key, agg in _usage.items()
        }
        paths = {endpoint: dict(agg) for endpoint, agg in _paths.items()}
        promotions = {
            model_type: dict(promotion)
            for model_type, promotion in _last_promotion.items()
        }
        deltas = dict(_promotion_deltas)

    models: List[Dict[str, Any]] = []
    # Aggregate per model version across endpoints.
    version_totals: Dict[Tuple[str, str], Dict[str, float]] = {}
    for (model_type, model_version, _endpoint), agg in usage.items():
        totals = version_totals.setdefault(
            (model_type, model_version), {"inferences": 0.0, "cost_usd": 0.0}
        )
        totals["inferences"] += agg["inferences"]
        totals["cost_usd"] += agg["cost_usd"]

    for (model_type, model_version), totals in version_totals.items():
        models.append(
            {
                "model_type": model_type,
                "model_version": model_version,
                "inferences": int(totals["inferences"]),
                "compute_cost_usd": round(totals["cost_usd"], 12),
                "cost_per_1k_inferences_usd": _rounded(
                    _cost_per_1k(totals["cost_usd"], totals["inferences"])
                ),
            }
        )
    models.sort(key=lambda entry: entry["compute_cost_usd"], reverse=True)

    endpoint_total = sum(agg["cost_usd"] for agg in paths.values())
    endpoints: List[Dict[str, Any]] = []
    for endpoint, agg in paths.items():
        endpoints.append(
            {
                "endpoint": endpoint,
                "inferences": int(agg["inferences"]),
                "compute_cost_usd": round(agg["cost_usd"], 12),
                "cost_per_1k_inferences_usd": _rounded(
                    _cost_per_1k(agg["cost_usd"], agg["inferences"])
                ),
                "share_of_total_cost_pct": (
                    round(agg["cost_usd"] / endpoint_total * 100.0, 2)
                    if endpoint_total > 0
                    else 0.0
                ),
            }
        )
    endpoints.sort(key=lambda entry: entry["compute_cost_usd"], reverse=True)

    promotion_report: List[Dict[str, Any]] = []
    for model_type, promotion in promotions.items():
        from_version = promotion["from_version"]
        to_version = promotion["to_version"]
        delta = deltas.get(model_type)
        promotion_report.append(
            {
                "model_type": model_type,
                "from_version": from_version,
                "to_version": to_version,
                "predecessor_cost_per_1k_inferences_usd": _rounded(
                    get_cost_per_1k(model_type, from_version)
                ),
                "promoted_cost_per_1k_inferences_usd": _rounded(
                    get_cost_per_1k(model_type, to_version)
                ),
                "cost_delta_per_1k_inferences_usd": _rounded(delta),
            }
        )

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "models": models,
        "endpoints": endpoints,
        "top_serving_paths": get_top_serving_paths(limit=3),
        "promotions": promotion_report,
    }


def _rounded(value: Optional[float]) -> Optional[float]:
    # Serving costs are small (fractions of a cent), so round to nanodollar
    # precision instead of cents to keep the report readable.
    return None if value is None else round(value, 9)
