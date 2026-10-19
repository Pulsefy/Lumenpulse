"""Ground-truth sentiment labels and held-out evaluation helpers (#1241)."""

from __future__ import annotations

from typing import Any, Dict, Iterable, Sequence, Tuple

SEED_LABELS: Tuple[Tuple[str, str], ...] = (
    ("Bitcoin rallies to a new all time high", "positive"),
    ("The market crash wiped out gains", "negative"),
    ("The protocol published its weekly update", "neutral"),
    ("XLM mooning after a strong breakout", "positive"),
    ("Bearish sell pressure is accelerating", "negative"),
    ("Trading volume was unchanged today", "neutral"),
    ("Investors celebrate a massive pump", "positive"),
    ("The exploit caused panic and losses", "negative"),
    ("The token announcement is scheduled for Friday", "neutral"),
)

VALID_LABELS = frozenset({"positive", "negative", "neutral"})


def seed_sentiment_labels(store: Any, labeller: str = "seed") -> int:
    """Insert the built-in examples idempotently, reserving the last third for evaluation."""
    held_out_start = len(SEED_LABELS) * 2 // 3
    for index, (text, label) in enumerate(SEED_LABELS):
        store.save_sentiment_label(
            text=text,
            label=label,
            labeller=labeller,
            is_held_out=index >= held_out_start,
        )
    return len(SEED_LABELS)


def classification_metrics(actual: Sequence[str], predicted: Sequence[str]) -> Dict[str, Any]:
    """Return macro precision, recall, and F1, with per-label support."""
    if len(actual) != len(predicted):
        raise ValueError("actual and predicted must have equal lengths")
    labels = sorted(set(actual) | set(predicted) | VALID_LABELS)
    per_label: Dict[str, Dict[str, float]] = {}
    for label in labels:
        tp = sum(a == label and p == label for a, p in zip(actual, predicted))
        fp = sum(a != label and p == label for a, p in zip(actual, predicted))
        fn = sum(a == label and p != label for a, p in zip(actual, predicted))
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        per_label[label] = {"precision": precision, "recall": recall, "f1": f1, "support": sum(a == label for a in actual)}
    count = len(labels) or 1
    return {
        "precision": sum(item["precision"] for item in per_label.values()) / count,
        "recall": sum(item["recall"] for item in per_label.values()) / count,
        "f1": sum(item["f1"] for item in per_label.values()) / count,
        "accuracy": sum(a == p for a, p in zip(actual, predicted)) / len(actual) if actual else 0.0,
        "support": len(actual),
        "per_label": per_label,
    }


def evaluate_sentiment(analyzer: Any, rows: Iterable[Any]) -> Dict[str, Any]:
    """Evaluate only rows explicitly marked held-out; those rows never enter training."""
    held_out = [row for row in rows if isinstance(row, dict) and row.get("is_held_out")]
    actual = [row["label"] for row in held_out]
    predicted = [analyzer.analyze(row["text"]).sentiment_label for row in held_out]
    return classification_metrics(actual, predicted)
