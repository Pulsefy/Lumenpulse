"""Ground-truth anomaly labels and evaluation helpers (issue #1450).

The anomaly detector feeds the backend's suspicious-contribution flow, which
can flag real user activity. This module gives that a measured false-positive
rate instead of an unknown one.

Each seed example is a synthetic (baseline series, test value) pair with an
explicit ground-truth label:

- ``confirmed`` examples are deliberate, large deviations (>=4 standard
  deviations from a tight baseline) that should always be flagged --
  refusing to catch these would make the detector useless.
- ``refuted`` examples are values drawn from *within* their own baseline's
  normal range (a real reading, not a crafted edge case) that a
  well-calibrated detector must *not* flag -- these are what the
  false-positive rate is measured against.

This is a synthetic seed set (no historical confirmed/refuted incident log
exists yet to draw from) rather than real historical incidents. It exists so
precision/recall/FPR are measured against *something* concrete instead of
being unknown, and is designed to be extended with real confirmed/refuted
cases as the suspicious-contribution flow accumulates a review history.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Sequence, Tuple

# (metric_name, baseline_values, test_value, label) -- label is "confirmed"
# (a true anomaly) or "refuted" (normal activity that must not be flagged).
SEED_ANOMALY_EXAMPLES: Tuple[Tuple[str, Tuple[float, ...], float, str], ...] = (
    # Volume: tight baseline around 1000 +/- 50.
    ("volume", (980, 1010, 995, 1005, 990, 1000, 1015, 985, 1002, 998, 1008, 992), 1000.0, "refuted"),
    ("volume", (980, 1010, 995, 1005, 990, 1000, 1015, 985, 1002, 998, 1008, 992), 1006.0, "refuted"),
    ("volume", (980, 1010, 995, 1005, 990, 1000, 1015, 985, 1002, 998, 1008, 992), 994.0, "refuted"),
    ("volume", (980, 1010, 995, 1005, 990, 1000, 1015, 985, 1002, 998, 1008, 992), 8000.0, "confirmed"),
    ("volume", (980, 1010, 995, 1005, 990, 1000, 1015, 985, 1002, 998, 1008, 992), 50.0, "confirmed"),
    # Volume: wider baseline around 5000 +/- 400.
    ("volume", (4600, 5400, 4900, 5100, 4800, 5200, 4700, 5300, 5000, 4950, 5050, 4850), 5150.0, "refuted"),
    ("volume", (4600, 5400, 4900, 5100, 4800, 5200, 4700, 5300, 5000, 4950, 5050, 4850), 4650.0, "refuted"),
    ("volume", (4600, 5400, 4900, 5100, 4800, 5200, 4700, 5300, 5000, 4950, 5050, 4850), 40000.0, "confirmed"),
    # Sentiment: tight baseline around 0.5 +/- 0.05 (VADER-style compound score range).
    ("sentiment", (0.48, 0.52, 0.50, 0.51, 0.49, 0.53, 0.47, 0.50, 0.52, 0.48, 0.51, 0.49), 0.50, "refuted"),
    ("sentiment", (0.48, 0.52, 0.50, 0.51, 0.49, 0.53, 0.47, 0.50, 0.52, 0.48, 0.51, 0.49), 0.54, "refuted"),
    ("sentiment", (0.48, 0.52, 0.50, 0.51, 0.49, 0.53, 0.47, 0.50, 0.52, 0.48, 0.51, 0.49), -0.90, "confirmed"),
    ("sentiment", (0.48, 0.52, 0.50, 0.51, 0.49, 0.53, 0.47, 0.50, 0.52, 0.48, 0.51, 0.49), 0.99, "confirmed"),
)


def binary_classification_metrics(
    actual: Sequence[str], predicted: Sequence[bool]
) -> Dict[str, Any]:
    """Precision, recall, and false-positive rate for a binary (confirmed/refuted) label set.

    ``actual`` entries are "confirmed" or "refuted"; ``predicted`` entries are
    the detector's ``is_anomaly`` booleans.
    """
    if len(actual) != len(predicted):
        raise ValueError("actual and predicted must have equal lengths")

    tp = sum(a == "confirmed" and p for a, p in zip(actual, predicted))
    fp = sum(a == "refuted" and p for a, p in zip(actual, predicted))
    fn = sum(a == "confirmed" and not p for a, p in zip(actual, predicted))
    tn = sum(a == "refuted" and not p for a, p in zip(actual, predicted))

    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    false_positive_rate = fp / (fp + tn) if (fp + tn) else 0.0

    return {
        "precision": precision,
        "recall": recall,
        "false_positive_rate": false_positive_rate,
        "true_positives": tp,
        "false_positives": fp,
        "false_negatives": fn,
        "true_negatives": tn,
        "support": len(actual),
    }


def evaluate_detector(
    detector_factory: Callable[[], Any],
    examples: Sequence[Tuple[str, Sequence[float], float, str]] = SEED_ANOMALY_EXAMPLES,
) -> Dict[str, Any]:
    """Run a fresh detector (from ``detector_factory``) over every seed example.

    A new detector instance is built per example so one example's baseline
    never leaks into another's statistics -- each example specifies its own
    complete baseline.
    """
    results_by_metric: Dict[str, Dict[str, List[Any]]] = {}
    overall_actual: List[str] = []
    overall_predicted: List[bool] = []
    z_threshold = detector_factory().z_threshold

    for metric_name, baseline, test_value, label in examples:
        detector = detector_factory()
        for value in baseline:
            if metric_name == "volume":
                detector.add_data_point(volume=value, sentiment_score=0.0)
            else:
                detector.add_data_point(volume=0.0, sentiment_score=value)

        if metric_name == "volume":
            result = detector.detect_volume_anomaly(test_value)
        else:
            result = detector.detect_sentiment_anomaly(test_value)

        bucket = results_by_metric.setdefault(metric_name, {"actual": [], "predicted": []})
        bucket["actual"].append(label)
        bucket["predicted"].append(result.is_anomaly)
        overall_actual.append(label)
        overall_predicted.append(result.is_anomaly)

    report = {
        "z_threshold": z_threshold,
        "per_detector": {
            metric_name: binary_classification_metrics(bucket["actual"], bucket["predicted"])
            for metric_name, bucket in results_by_metric.items()
        },
        "overall": binary_classification_metrics(overall_actual, overall_predicted),
    }
    return report
