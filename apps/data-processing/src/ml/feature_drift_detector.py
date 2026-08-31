# -*- coding: utf-8 -*-
"""
Training-vs-serving feature drift detection (#1239).

A trained model records, in its registry metadata sidecar, the *baseline*
distribution of every feature it was trained on (see
``compute_distribution_baseline`` / the retraining pipeline). This detector
periodically recomputes the *current serving* distribution of those same
features and measures how far it has moved from the training baseline.

Drift is quantified per feature with the Population Stability Index (PSI), the
industry-standard train/serve distribution-shift metric:

    PSI = Σ_bins (serving% − baseline%) · ln(serving% / baseline%)

Conventional interpretation:
    PSI < 0.10  → no significant shift
    0.10–0.25   → moderate shift, investigate
    PSI ≥ 0.25  → major shift

The alert threshold is configurable (``FEATURE_DRIFT_PSI_THRESHOLD``, default
0.25). When any feature drifts beyond it — or the recorded training schema
version/fingerprint no longer matches what serving produces — an alert is
raised through the existing alerting path (:class:`AlertNotifier`).

The detector is strictly read-only and defensive: a missing baseline, an empty
serving window, or a failed notification is logged and reported, never fatal,
so a scheduled run can never crash the scheduler.
"""

from __future__ import annotations

import math
import os
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

from src.ml.feature_schema import (
    PRICE_PREDICTOR_FEATURE_SET,
    current_feature_schema,
)
from src.ml.model_registry import load_metadata
from src.utils.logger import setup_logger

logger = setup_logger(__name__)

_DEFAULT_PSI_THRESHOLD = 0.25
_DEFAULT_BINS = 10
# Small floor so empty bins don't blow PSI up to infinity via log(0).
_EPS = 1e-6


# ---------------------------------------------------------------------------
# Pure statistics (no DB, no pandas required) — easy to unit test
# ---------------------------------------------------------------------------

def compute_distribution_baseline(
    frame: Any,
    feature_names: List[str],
    n_bins: int = _DEFAULT_BINS,
) -> Dict[str, Dict[str, Any]]:
    """
    Summarise the training distribution of each named feature.

    Returns a JSON-serialisable mapping suitable for storing in a model's
    metadata sidecar:

        {
          "sentiment_score": {
             "count": int, "mean": float, "std": float,
             "min": float, "max": float,
             "bin_edges": [...], "bin_props": [...]   # quantile bins + proportions
          },
          ...
        }

    ``frame`` is any object exposing pandas-like column access
    (``frame[name]`` -> series of numbers). Non-finite values are dropped.
    """
    import numpy as np

    baseline: Dict[str, Dict[str, Any]] = {}
    for name in feature_names:
        try:
            raw = np.asarray(frame[name], dtype="float64")
        except Exception:
            continue
        values = raw[np.isfinite(raw)]
        if values.size == 0:
            continue

        # Quantile-based bin edges make PSI robust to skewed feature scales.
        quantiles = np.linspace(0.0, 1.0, n_bins + 1)
        edges = np.unique(np.quantile(values, quantiles))
        # Guarantee an outer envelope so serving values below/above the
        # training range still land in the first/last bin.
        edges[0] = -np.inf
        edges[-1] = np.inf

        counts, _ = np.histogram(values, bins=edges)
        total = counts.sum()
        props = (counts / total) if total else counts.astype("float64")

        baseline[name] = {
            "count": int(values.size),
            "mean": float(np.mean(values)),
            "std": float(np.std(values)),
            "min": float(np.min(values)),
            "max": float(np.max(values)),
            "bin_edges": [_json_float(e) for e in edges.tolist()],
            "bin_props": [float(p) for p in props.tolist()],
        }
    return baseline


def population_stability_index(
    baseline: Dict[str, Any],
    serving_values: Any,
) -> float:
    """
    PSI of a serving sample against a stored per-feature baseline.

    ``baseline`` must contain ``bin_edges`` and ``bin_props`` as produced by
    :func:`compute_distribution_baseline`. Returns 0.0 when the baseline is
    degenerate (a single bin) or the serving sample is empty.
    """
    import numpy as np

    # Reconstruct the outer envelope: the baseline stores the first edge (-inf)
    # and last edge (+inf) as None so it stays valid JSON. Restore them by
    # position — first None -> -inf, trailing None -> +inf — so the bins remain
    # monotonically increasing.
    raw_edges = baseline.get("bin_edges", [])
    last = len(raw_edges) - 1
    edges = np.asarray(
        [
            (-math.inf if i == 0 else math.inf) if e is None else float(e)
            for i, e in enumerate(raw_edges)
        ]
        if raw_edges
        else [],
        dtype="float64",
    )
    # Guard: if an interior edge was None (shouldn't happen), the trailing-inf
    # rule above still keeps monotonicity for the canonical first/last case.
    if edges.size and raw_edges and raw_edges[last] is None:
        edges[last] = math.inf
    base_props = np.asarray(baseline.get("bin_props", []), dtype="float64")
    if edges.size < 3 or base_props.size == 0:
        return 0.0

    serving = np.asarray(serving_values, dtype="float64")
    serving = serving[np.isfinite(serving)]
    if serving.size == 0:
        return 0.0

    serv_counts, _ = np.histogram(serving, bins=edges)
    serv_total = serv_counts.sum()
    if serv_total == 0:
        return 0.0
    serv_props = serv_counts / serv_total

    base = np.clip(base_props, _EPS, None)
    serv = np.clip(serv_props, _EPS, None)
    psi = float(np.sum((serv - base) * np.log(serv / base)))
    # Numerical noise can yield a tiny negative; PSI is non-negative by defn.
    return max(psi, 0.0)


def _json_float(value: float) -> Optional[float]:
    """Represent ±inf as None so the baseline stays valid JSON."""
    if value == math.inf or value == -math.inf:
        return None
    return float(value)


# ---------------------------------------------------------------------------
# Report types
# ---------------------------------------------------------------------------

@dataclass
class FeatureDriftResult:
    feature: str
    psi: float
    drifted: bool
    baseline_mean: Optional[float] = None
    serving_mean: Optional[float] = None
    baseline_count: Optional[int] = None
    serving_count: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class FeatureDriftReport:
    run_id: str
    feature_set: str
    started_at: datetime
    threshold: float
    status: str = "ok"  # ok | drift_detected | no_baseline | insufficient_serving_data | error
    training_schema_version: Optional[str] = None
    serving_schema_version: Optional[str] = None
    schema_mismatch: bool = False
    results: List[FeatureDriftResult] = field(default_factory=list)
    alerted: bool = False
    completed_at: Optional[datetime] = None
    error: Optional[str] = None

    @property
    def drifted_features(self) -> List[str]:
        return [r.feature for r in self.results if r.drifted]

    @property
    def drift_detected(self) -> bool:
        return bool(self.drifted_features) or self.schema_mismatch

    def to_dict(self) -> Dict[str, Any]:
        return {
            "run_id": self.run_id,
            "feature_set": self.feature_set,
            "started_at": self.started_at.isoformat(),
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "status": self.status,
            "threshold": self.threshold,
            "training_schema_version": self.training_schema_version,
            "serving_schema_version": self.serving_schema_version,
            "schema_mismatch": self.schema_mismatch,
            "drift_detected": self.drift_detected,
            "drifted_features": self.drifted_features,
            "results": [r.to_dict() for r in self.results],
            "alerted": self.alerted,
            "error": self.error,
        }


# ---------------------------------------------------------------------------
# Detector
# ---------------------------------------------------------------------------

class FeatureDriftDetector:
    """
    Compares the current serving feature distribution against the training-time
    baseline recorded with the live model, and alerts on drift.
    """

    def __init__(
        self,
        model_type: str = "price_predictor",
        feature_set: str = PRICE_PREDICTOR_FEATURE_SET,
        psi_threshold: Optional[float] = None,
        serving_frame_provider: Optional[Callable[[], Any]] = None,
        metadata_loader: Optional[Callable[[str, str], Optional[Dict[str, Any]]]] = None,
        notifier: Optional[Any] = None,
    ):
        self.model_type = model_type
        self.feature_set = feature_set
        self.psi_threshold = (
            psi_threshold
            if psi_threshold is not None
            else float(os.getenv("FEATURE_DRIFT_PSI_THRESHOLD", str(_DEFAULT_PSI_THRESHOLD)))
        )
        # Injectable seams keep the detector unit-testable without a live DB or
        # network: a serving-feature provider, a metadata loader, and a notifier.
        self._serving_frame_provider = serving_frame_provider or self._default_serving_frame
        self._metadata_loader = metadata_loader or load_metadata
        self._notifier = notifier  # lazily constructed in _raise_alert if None

    # -- serving features -------------------------------------------------

    def _default_serving_frame(self) -> Any:
        """
        Pull the current serving feature window from the live feature store.

        Uses a fresh PostgresService session and the same FeatureStore the
        model consumes, so "serving distribution" means exactly what the model
        would see in production.
        """
        from src.db.postgres_service import PostgresService
        from src.ml.feature_store import FeatureStore

        asset = os.getenv("FEATURE_DRIFT_ASSET", "XLM")
        window = os.getenv("FEATURE_DRIFT_SERVING_WINDOW", "7d")

        service = PostgresService()
        with service.get_session() as session:
            store = FeatureStore(session)
            return store.get_features_for_asset(asset, window)

    # -- main entrypoint --------------------------------------------------

    def detect(self) -> FeatureDriftReport:
        schema = current_feature_schema(self.feature_set)
        report = FeatureDriftReport(
            run_id=str(uuid.uuid4()),
            feature_set=self.feature_set,
            started_at=datetime.now(timezone.utc),
            threshold=self.psi_threshold,
            serving_schema_version=schema.version,
        )

        try:
            metadata = self._metadata_loader(self.model_type, "current")
        except Exception as exc:  # pragma: no cover - defensive
            logger.error("Failed to load model metadata: %s", exc, exc_info=True)
            metadata = None

        if not metadata or not metadata.get("feature_baseline"):
            report.status = "no_baseline"
            report.completed_at = datetime.now(timezone.utc)
            logger.warning(
                "Feature drift check skipped: no training baseline recorded for "
                "'%s'. Train/promote a model to record one.",
                self.model_type,
            )
            return report

        report.training_schema_version = metadata.get("schema_version")
        baseline: Dict[str, Any] = metadata["feature_baseline"]

        # Batch-level schema skew: the model's recorded schema no longer matches
        # what serving produces. This is itself a drift signal.
        report.schema_mismatch = self._schema_mismatch(metadata, schema)

        serving_frame = self._safe_serving_frame()
        if serving_frame is None or self._frame_len(serving_frame) == 0:
            report.status = "insufficient_serving_data"
            report.completed_at = datetime.now(timezone.utc)
            logger.warning(
                "Feature drift check for '%s': no serving data available in the "
                "current window; nothing to compare.",
                self.feature_set,
            )
            # A schema mismatch is still alert-worthy even without serving rows.
            if report.schema_mismatch:
                self._finalise_alert(report)
            return report

        report.results = self._score_features(schema.feature_names, baseline, serving_frame)

        if report.drift_detected:
            report.status = "drift_detected"
            self._finalise_alert(report)
        else:
            report.status = "ok"

        report.completed_at = datetime.now(timezone.utc)
        self._log_outcome(report)
        return report

    # -- internals --------------------------------------------------------

    def _schema_mismatch(self, metadata: Dict[str, Any], schema) -> bool:
        trained_version = metadata.get("schema_version")
        trained_fp = metadata.get("schema_fingerprint")
        version_skew = trained_version is not None and trained_version != schema.version
        fp_skew = trained_fp is not None and trained_fp != schema.fingerprint
        return bool(version_skew or fp_skew)

    def _score_features(
        self,
        feature_names: List[str],
        baseline: Dict[str, Any],
        serving_frame: Any,
    ) -> List[FeatureDriftResult]:
        import numpy as np

        try:
            from src.utils.metrics import FEATURE_DRIFT_PSI
        except Exception:  # pragma: no cover
            FEATURE_DRIFT_PSI = None

        results: List[FeatureDriftResult] = []
        for name in feature_names:
            feat_baseline = baseline.get(name)
            if not feat_baseline:
                continue

            try:
                serving_values = np.asarray(serving_frame[name], dtype="float64")
                serving_values = serving_values[np.isfinite(serving_values)]
            except Exception:
                serving_values = np.asarray([], dtype="float64")

            psi = population_stability_index(feat_baseline, serving_values)
            serving_mean = (
                float(np.mean(serving_values)) if serving_values.size else None
            )

            if FEATURE_DRIFT_PSI is not None:
                try:
                    FEATURE_DRIFT_PSI.labels(
                        feature_set=self.feature_set, feature=name
                    ).set(psi)
                except Exception:  # pragma: no cover
                    pass

            results.append(
                FeatureDriftResult(
                    feature=name,
                    psi=round(psi, 6),
                    drifted=psi >= self.psi_threshold,
                    baseline_mean=feat_baseline.get("mean"),
                    serving_mean=serving_mean,
                    baseline_count=feat_baseline.get("count"),
                    serving_count=int(serving_values.size),
                )
            )
        return results

    def _finalise_alert(self, report: FeatureDriftReport) -> None:
        """Raise an alert through the existing alerting path and count it."""
        try:
            from src.utils.metrics import FEATURE_DRIFT_ALERTS_TOTAL

            if report.schema_mismatch:
                FEATURE_DRIFT_ALERTS_TOTAL.labels(
                    feature_set=self.feature_set, reason="schema"
                ).inc()
            if report.drifted_features:
                FEATURE_DRIFT_ALERTS_TOTAL.labels(
                    feature_set=self.feature_set, reason="distribution"
                ).inc()
        except Exception:  # pragma: no cover
            pass

        report.alerted = self._raise_alert(report)

    def _raise_alert(self, report: FeatureDriftReport) -> bool:
        try:
            notifier = self._notifier
            if notifier is None:
                from src.alert_notifier import AlertNotifier

                notifier = AlertNotifier()
            notifier.notify_feature_drift(report.to_dict())
            return True
        except Exception as exc:
            logger.error(
                "Feature drift detected but alerting failed: %s", exc, exc_info=True
            )
            return False

    def _safe_serving_frame(self) -> Any:
        try:
            return self._serving_frame_provider()
        except Exception as exc:
            logger.error(
                "Feature drift check: serving feature provider failed: %s",
                exc,
                exc_info=True,
            )
            return None

    @staticmethod
    def _frame_len(frame: Any) -> int:
        try:
            return len(frame)
        except Exception:
            return 0

    def _log_outcome(self, report: FeatureDriftReport) -> None:
        if report.drift_detected:
            logger.warning(
                "🚨 Feature drift detected (%s): schema_mismatch=%s drifted=%s "
                "threshold=%.3f alerted=%s",
                self.feature_set,
                report.schema_mismatch,
                report.drifted_features,
                report.threshold,
                report.alerted,
            )
        else:
            logger.info(
                "Feature drift check complete (%s): no drift beyond PSI %.3f "
                "across %d features",
                self.feature_set,
                report.threshold,
                len(report.results),
            )


def run_feature_drift_check() -> Dict[str, Any]:
    """Convenience entrypoint for the scheduler / CLI."""
    detector = FeatureDriftDetector()
    return detector.detect().to_dict()
