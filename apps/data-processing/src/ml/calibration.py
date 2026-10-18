"""Confidence calibration (reliability curves, isotonic / base-rate calibrators).

A model's raw confidence is only useful to a user if it matches how often the
model is actually right: a raw 0.9 that is correct 60% of the time is
misleading.  This module

* measures that gap against labelled outcomes (reliability curve, expected
  calibration error, Brier score),
* fits a calibrator when the gap is material, and
* applies the committed calibrator at serving time.

Calibrators are plain JSON files under ``models/calibration/<model>.json`` so
a reviewer can read the committed curve and mapping; ``scripts/
build_calibration.py`` regenerates them deterministically.

Method selection (see :func:`fit_calibration`):

* ECE <= ``MATERIAL_ECE``            -> ``none`` (identity; gap is not material)
* fewer than ``MIN_SAMPLES_ISOTONIC``-> ``base_rate`` (constant, Laplace-smoothed
  accuracy -- the only claim a tiny sample can support)
* otherwise                          -> ``isotonic`` (pool-adjacent-violators)

A fitted method is discarded (back to ``none``) when k-fold held-out ECE does
not improve on the raw ECE by ``MIN_HELD_OUT_IMPROVEMENT``, so noise is not
mistaken for a material gap.
"""

from __future__ import annotations

import json
import os
from bisect import bisect_right
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

APP_ROOT = Path(__file__).resolve().parents[2]
CALIBRATION_DIR = APP_ROOT / "models" / "calibration"

N_BINS = 10
MATERIAL_ECE = 0.05
MIN_SAMPLES_ISOTONIC = 30
CV_FOLDS = 5
# A fitted calibrator is kept only if it cuts held-out ECE by at least this much.
MIN_HELD_OUT_IMPROVEMENT = 0.01
# A finite sample can never justify certainty: fitted outputs are clamped.
CALIBRATED_FLOOR = 0.02
CALIBRATED_CEILING = 0.98

# Which response field clients should render, and which they must ignore.
CONFIDENCE_GUIDANCE = {
    "display": "calibrated_confidence",
    "ignore": ["confidence", "confidence_24h", "confidence_48h", "severity_score"],
    "note": (
        "Raw model scores are not probabilities. Show calibrated_confidence "
        "(the empirically observed probability the prediction is correct) and "
        "ignore the raw fields; they are kept only for backward compatibility."
    ),
}


# ── Metrics ───────────────────────────────────────────────────────────────


def _validate(confidences: Sequence[float], outcomes: Sequence[int]) -> None:
    if len(confidences) != len(outcomes):
        raise ValueError("confidences and outcomes must have equal lengths")
    if not confidences:
        raise ValueError("at least one sample is required")


def reliability_curve(
    confidences: Sequence[float],
    outcomes: Sequence[int],
    n_bins: int = N_BINS,
) -> List[Dict[str, Any]]:
    """Equal-width reliability curve; empty bins are omitted."""
    _validate(confidences, outcomes)
    bins: List[List[Tuple[float, int]]] = [[] for _ in range(n_bins)]
    for conf, outcome in zip(confidences, outcomes):
        idx = min(int(max(0.0, min(1.0, conf)) * n_bins), n_bins - 1)
        bins[idx].append((conf, int(bool(outcome))))
    curve = []
    for idx, items in enumerate(bins):
        if not items:
            continue
        curve.append(
            {
                "lower": round(idx / n_bins, 4),
                "upper": round((idx + 1) / n_bins, 4),
                "count": len(items),
                "mean_confidence": round(sum(c for c, _ in items) / len(items), 4),
                "observed_accuracy": round(sum(o for _, o in items) / len(items), 4),
            }
        )
    return curve


def expected_calibration_error(
    confidences: Sequence[float], outcomes: Sequence[int], n_bins: int = N_BINS
) -> float:
    """Sample-weighted mean |confidence - accuracy| over reliability bins."""
    curve = reliability_curve(confidences, outcomes, n_bins)
    total = len(confidences)
    return round(
        sum(
            b["count"] * abs(b["mean_confidence"] - b["observed_accuracy"])
            for b in curve
        )
        / total,
        4,
    )


def brier_score(confidences: Sequence[float], outcomes: Sequence[int]) -> float:
    _validate(confidences, outcomes)
    return round(
        sum((c - int(bool(o))) ** 2 for c, o in zip(confidences, outcomes))
        / len(confidences),
        4,
    )


# ── Calibrators ───────────────────────────────────────────────────────────


def fit_isotonic(
    confidences: Sequence[float], outcomes: Sequence[int]
) -> Dict[str, List[float]]:
    """Pool-adjacent-violators isotonic regression -> piecewise-linear knots."""
    _validate(confidences, outcomes)
    pairs = sorted(zip(confidences, (int(bool(o)) for o in outcomes)))
    # Each block: [sum_y, weight, x_min, x_max]
    # Tied confidences are one observation point: pool them first.
    points: List[List[float]] = []
    for x, y in pairs:
        if points and points[-1][2] == x:
            points[-1][0] += float(y)
            points[-1][1] += 1.0
        else:
            points.append([float(y), 1.0, x, x])

    blocks: List[List[float]] = []
    for point in points:
        blocks.append(list(point))
        while len(blocks) > 1 and (
            blocks[-2][0] / blocks[-2][1] > blocks[-1][0] / blocks[-1][1]
        ):
            top = blocks.pop()
            blocks[-1] = [
                blocks[-1][0] + top[0],
                blocks[-1][1] + top[1],
                blocks[-1][2],
                top[3],
            ]
    xs: List[float] = []
    ys: List[float] = []
    for sum_y, weight, x_min, x_max in blocks:
        value = round(sum_y / weight, 6)
        midpoint = round((x_min + x_max) / 2.0, 6)
        if xs and midpoint <= xs[-1]:
            continue
        xs.append(midpoint)
        ys.append(value)
    return {"x": xs, "y": ys}


def apply_knots(mapping: Dict[str, List[float]], value: float) -> float:
    xs, ys = mapping["x"], mapping["y"]
    if not xs:
        return value
    if value <= xs[0]:
        return ys[0]
    if value >= xs[-1]:
        return ys[-1]
    hi = bisect_right(xs, value)
    lo = hi - 1
    span = xs[hi] - xs[lo]
    if span <= 0:
        return ys[lo]
    return ys[lo] + (ys[hi] - ys[lo]) * (value - xs[lo]) / span


def base_rate(outcomes: Sequence[int]) -> float:
    """Laplace-smoothed accuracy; never claims certainty from a small sample."""
    n = len(outcomes)
    return round((sum(int(bool(o)) for o in outcomes) + 1) / (n + 2), 6)


def _apply(method: str, mapping: Dict[str, Any], raw: float) -> float:
    if method == "isotonic":
        return apply_knots(mapping, raw)
    if method == "base_rate":
        return float(mapping["value"])
    return raw


def _cv_ece(
    method: str,
    confidences: Sequence[float],
    outcomes: Sequence[int],
) -> Optional[float]:
    """Held-out ECE of ``method`` via deterministic k-fold (i % k)."""
    n = len(confidences)
    if n < CV_FOLDS * 2:
        return None
    cal_conf: List[float] = []
    cal_out: List[int] = []
    for fold in range(CV_FOLDS):
        train_idx = [i for i in range(n) if i % CV_FOLDS != fold]
        test_idx = [i for i in range(n) if i % CV_FOLDS == fold]
        tc = [confidences[i] for i in train_idx]
        to = [outcomes[i] for i in train_idx]
        if method == "isotonic":
            mapping: Dict[str, Any] = fit_isotonic(tc, to)
        else:
            mapping = {"value": base_rate(to)}
        for i in test_idx:
            cal_conf.append(_apply(method, mapping, confidences[i]))
            cal_out.append(outcomes[i])
    return expected_calibration_error(cal_conf, cal_out)


def fit_calibration(
    model: str,
    confidences: Sequence[float],
    outcomes: Sequence[int],
    *,
    dataset: str,
    raw_field: str,
    notes: str = "",
) -> Dict[str, Any]:
    """Measure the calibration gap and fit a calibrator when it is material."""
    _validate(confidences, outcomes)
    outs = [int(bool(o)) for o in outcomes]
    n = len(outs)
    ece_before = expected_calibration_error(confidences, outs)
    material = ece_before > MATERIAL_ECE

    if not material:
        method, mapping = "none", {}
    elif n < MIN_SAMPLES_ISOTONIC:
        method, mapping = "base_rate", {"value": base_rate(outs)}
    else:
        method, mapping = "isotonic", fit_isotonic(confidences, outs)

    held_out = _cv_ece(method, confidences, outs) if method != "none" else None
    discarded = False
    if (
        method != "none"
        and held_out is not None
        and held_out > ece_before - MIN_HELD_OUT_IMPROVEMENT
    ):
        method, mapping, discarded = "none", {}, True

    calibrated = [_apply(method, mapping, c) for c in confidences]
    return {
        "model": model,
        "dataset": dataset,
        "raw_field": raw_field,
        "notes": notes,
        "n_samples": n,
        "accuracy": round(sum(outs) / n, 4),
        "material_gap": material,
        "discarded_no_held_out_gain": discarded,
        "material_ece_threshold": MATERIAL_ECE,
        "method": method,
        "reliable": n >= MIN_SAMPLES_ISOTONIC,
        "mapping": mapping,
        "before": {
            "ece": ece_before,
            "brier": brier_score(confidences, outs),
            "curve": reliability_curve(confidences, outs),
        },
        "after": {
            "ece_in_sample": expected_calibration_error(calibrated, outs),
            "ece_held_out": ece_before if method == "none" else held_out,
            "brier": brier_score(calibrated, outs),
            "curve": reliability_curve(calibrated, outs),
        },
    }


# ── Serving ───────────────────────────────────────────────────────────────


class Calibrator:
    """Applies a committed calibration report to raw confidences."""

    def __init__(self, report: Optional[Dict[str, Any]] = None) -> None:
        self.report = report
        self.method = report["method"] if report else "none"
        self.mapping = report["mapping"] if report else {}

    @property
    def available(self) -> bool:
        return self.report is not None

    def calibrate(self, raw: float) -> float:
        raw = max(0.0, min(1.0, float(raw)))
        value = _apply(self.method, self.mapping, raw)
        if self.method != "none":
            value = max(CALIBRATED_FLOOR, min(CALIBRATED_CEILING, value))
        return round(max(0.0, min(1.0, value)), 4)

    def describe(self) -> Dict[str, Any]:
        if not self.report:
            return {"method": "uncalibrated", "reliable": False, "n_samples": 0}
        return {
            "method": self.method,
            "reliable": bool(self.report.get("reliable")),
            "n_samples": self.report.get("n_samples", 0),
        }


_CACHE: Dict[str, Calibrator] = {}


def calibration_path(model: str) -> Path:
    base = Path(os.environ.get("CALIBRATION_DIR", CALIBRATION_DIR))
    return base / f"{model}.json"


def load_calibrator(model: str) -> Calibrator:
    """Load (and cache) the committed calibrator; identity if none is committed."""
    cached = _CACHE.get(model)
    if cached is not None:
        return cached
    path = calibration_path(model)
    report = None
    if path.exists():
        report = json.loads(path.read_text(encoding="utf-8"))
    calibrator = Calibrator(report)
    _CACHE[model] = calibrator
    return calibrator


def clear_calibrator_cache() -> None:
    _CACHE.clear()


def calibrated_confidence(model: str, raw: float) -> Dict[str, Any]:
    """Return ``{calibrated_confidence, calibration}`` for a raw score."""
    calibrator = load_calibrator(model)
    return {
        "calibrated_confidence": calibrator.calibrate(raw),
        "calibration": calibrator.describe(),
    }
