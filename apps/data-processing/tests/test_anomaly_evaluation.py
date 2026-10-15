"""Issue #1450: labelled evaluation of AnomalyDetector precision/recall/FPR.

Runs the real (non-ML, Z-score) AnomalyDetector against the seed labelled
set in src/ml/anomaly_evaluation.py and asserts on the *actual* computed
metrics -- this is the source of the false-positive rate quoted in the PR
description, not a fabricated number.
"""

from src.anomaly_detector import AnomalyDetector
from src.ml.anomaly_evaluation import (
    SEED_ANOMALY_EXAMPLES,
    binary_classification_metrics,
    evaluate_detector,
)


def _make_detector(z_threshold: float = 2.5) -> AnomalyDetector:
    # use_ml=False: the evaluation set is small and synthetic, not enough
    # data to fit a meaningful IsolationForest -- this is a Z-score-only
    # evaluation. The ML path needs its own held-out set once real
    # historical data exists (documented as a known gap below).
    return AnomalyDetector(z_threshold=z_threshold, use_ml=False)


def test_binary_classification_metrics_on_known_inputs():
    """Sanity-check the metrics function itself against hand-computed values."""
    actual = ["confirmed", "confirmed", "refuted", "refuted"]
    predicted = [True, False, False, True]
    # TP=1 (confirmed,True), FN=1 (confirmed,False), FP=1 (refuted,True), TN=1 (refuted,False)
    metrics = binary_classification_metrics(actual, predicted)
    assert metrics["precision"] == 0.5
    assert metrics["recall"] == 0.5
    assert metrics["false_positive_rate"] == 0.5
    assert metrics["support"] == 4


def test_seed_examples_have_both_labels_per_metric():
    """The eval set must have at least one confirmed and one refuted case per metric."""
    labels_by_metric = {}
    for metric_name, _, _, label in SEED_ANOMALY_EXAMPLES:
        labels_by_metric.setdefault(metric_name, set()).add(label)

    for metric_name, labels in labels_by_metric.items():
        assert {"confirmed", "refuted"} <= labels, (
            f"'{metric_name}' eval examples must include both confirmed and "
            f"refuted cases, got: {labels}"
        )


def test_default_threshold_evaluation_reports_measured_metrics():
    """Run the real detector at its default threshold and report precision/recall/FPR.

    This is the number the PR description's stated false-positive rate comes
    from -- run this test (or CI) to reproduce it.
    """
    report = evaluate_detector(_make_detector)

    overall = report["overall"]
    print(
        f"\n[anomaly eval] threshold={report['z_threshold']} "
        f"precision={overall['precision']:.3f} recall={overall['recall']:.3f} "
        f"false_positive_rate={overall['false_positive_rate']:.3f} "
        f"(support={overall['support']})"
    )
    for metric_name, metrics in report["per_detector"].items():
        print(
            f"[anomaly eval]   {metric_name}: precision={metrics['precision']:.3f} "
            f"recall={metrics['recall']:.3f} fpr={metrics['false_positive_rate']:.3f}"
        )

    # The seed "confirmed" cases are deliberately large (>=4 std dev)
    # deviations -- a detector that misses these at the default threshold is
    # not usable, so recall on this seed set must be perfect.
    assert overall["recall"] == 1.0
    # The seed "refuted" cases are values drawn from within their own
    # baseline's normal range -- the default threshold must not flag them.
    assert overall["false_positive_rate"] == 0.0


def test_lower_threshold_trades_precision_for_recall():
    """Documents the threshold's effect on the precision/recall trade-off (issue #1450)."""
    loose_report = evaluate_detector(lambda: _make_detector(z_threshold=1.0))
    strict_report = evaluate_detector(lambda: _make_detector(z_threshold=4.5))

    # A looser (lower) threshold flags more things -- recall can only go up
    # (or stay the same), never down, relative to a stricter threshold.
    assert loose_report["overall"]["recall"] >= strict_report["overall"]["recall"]
    # A stricter (higher) threshold flags fewer things -- false-positive rate
    # can only go down (or stay the same).
    assert strict_report["overall"]["false_positive_rate"] <= loose_report["overall"]["false_positive_rate"]
