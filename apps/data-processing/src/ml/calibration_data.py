"""Builds (raw confidence, outcome) pairs from the committed ground-truth sets.

* ``sentiment`` -- the labelled sentiment set (Wave 8, ``sentiment_evaluation``).
  Outcome: the predicted label equals the ground-truth label.
* ``anomaly``   -- the labelled anomaly seed set plus the committed
  ``anomaly_pump_and_dump_v1`` snapshot (Wave 9).  Only *flagged* points are
  scored, because the confidence is the claim "this flag is a real anomaly".
  Outcome: the ground-truth label is ``confirmed``.
* ``forecast``  -- walk-forward forecasts over the sentiment series of the same
  committed snapshot (no separate forecast outcome log is committed).
  Outcome: the predicted 24h/48h trend equals the realised trend.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Tuple

from .anomaly_evaluation import SEED_ANOMALY_EXAMPLES
from .sentiment_evaluation import SEED_LABELS

APP_ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT_PATH = APP_ROOT / "data" / "experiments" / "anomaly_pump_and_dump_v1.json"
SENTIMENT_LABELS_PATH = APP_ROOT / "data" / "sentiment_labels.seed.json"

# VADER's conventional neutral band on the compound score.
NEUTRAL_BAND = 0.05
BASELINE_WINDOW = 12

Dataset = Tuple[List[float], List[int]]


def sentiment_raw_confidence(compound: float, label: str) -> float:
    """Raw confidence in the predicted label, derived from the compound score.

    Positive/negative: grows with |compound|.  Neutral: highest at 0, falling
    as |compound| approaches the edge of the neutral band.
    """
    magnitude = abs(compound)
    if label == "neutral":
        return round(1.0 - 0.5 * min(1.0, magnitude / NEUTRAL_BAND), 4)
    return round(min(1.0, 0.5 + 0.5 * magnitude), 4)


def sentiment_dataset(analyzer: Any) -> Dataset:
    rows = json.loads(SENTIMENT_LABELS_PATH.read_text(encoding="utf-8"))
    pairs = [(row["text"], row["label"]) for row in rows] or list(SEED_LABELS)
    confidences: List[float] = []
    outcomes: List[int] = []
    for text, truth in pairs:
        result = analyzer.analyze(text)
        confidences.append(
            sentiment_raw_confidence(result.compound_score, result.sentiment_label)
        )
        outcomes.append(int(result.sentiment_label == truth))
    return confidences, outcomes


def _score_flagged(
    detector_factory: Callable[[], Any],
    metric: str,
    baseline: List[float],
    value: float,
    label: str,
    confidences: List[float],
    outcomes: List[int],
) -> None:
    detector = detector_factory()
    for point in baseline:
        if metric == "volume":
            detector.add_data_point(volume=point, sentiment_score=0.0)
        else:
            detector.add_data_point(volume=0.0, sentiment_score=point)
    result = (
        detector.detect_volume_anomaly(value)
        if metric == "volume"
        else detector.detect_sentiment_anomaly(value)
    )
    if result.is_anomaly:
        confidences.append(float(result.severity_score))
        outcomes.append(int(label == "confirmed"))


def anomaly_dataset(detector_factory: Callable[[], Any]) -> Dataset:
    confidences: List[float] = []
    outcomes: List[int] = []

    for metric, baseline, value, label in SEED_ANOMALY_EXAMPLES:
        _score_flagged(
            detector_factory, metric, list(baseline), value, label, confidences, outcomes
        )

    records = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))["records"]
    for index, record in enumerate(records):
        # Baseline = the most recent clean (refuted) observations, so pump
        # episodes do not contaminate the statistics of later points.
        clean = [r for r in records[:index] if r["label"] == "refuted"][-BASELINE_WINDOW:]
        if len(clean) < BASELINE_WINDOW:
            continue
        for metric, key in (("volume", "volume"), ("sentiment", "sentiment")):
            _score_flagged(
                detector_factory,
                metric,
                [float(r[key]) for r in clean],
                float(record[key]),
                record["label"],
                confidences,
                outcomes,
            )
    return confidences, outcomes


def _trend(score: float) -> str:
    from src.analytics.forecaster import _classify_trend

    return _classify_trend(score)


def snapshot_sentiment_frame() -> Any:
    """Hourly DataFrame in the forecaster's schema, from the committed snapshot."""
    import pandas as pd

    records = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))["records"]
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    rows = []
    for record in records:
        score = float(record["sentiment"])
        rows.append(
            {
                "timestamp": start + timedelta(hours=int(record["index"])),
                "sentiment_score": score,
                "positive_pct": max(0.0, min(1.0, 0.5 + score / 2)),
                "negative_pct": max(0.0, min(1.0, 0.5 - score / 2)),
                "news_count": int(float(record["volume"])),
            }
        )
    return pd.DataFrame(rows)


def forecast_dataset(initial_train: int = 72, step: int = 6) -> Dataset:
    from src.analytics.forecaster import SentimentForecaster

    df = snapshot_sentiment_frame()
    n = len(df)
    confidences: List[float] = []
    outcomes: List[int] = []
    train_end = initial_train
    while train_end + 48 <= n:
        train_df = df.iloc[:train_end].copy()
        forecaster = SentimentForecaster()
        forecaster.train(train_df)
        prediction = forecaster.predict(train_df)
        for horizon, predicted, confidence in (
            (24, prediction.predicted_trend_24h, prediction.confidence_24h),
            (48, prediction.predicted_trend_48h, prediction.confidence_48h),
        ):
            actual = float(df["sentiment_score"].iloc[train_end + horizon - 1])
            confidences.append(float(confidence))
            outcomes.append(int(predicted == _trend(actual)))
        train_end += step
    return confidences, outcomes


def build_all() -> Dict[str, Dict[str, Any]]:
    """Return ``{model: {"dataset": Dataset, "meta": {...}}}`` for every model."""
    from src.anomaly_detector import AnomalyDetector
    from src.sentiment import SentimentAnalyzer

    return {
        "sentiment": {
            "data": sentiment_dataset(SentimentAnalyzer()),
            "dataset": "data/sentiment_labels.seed.json",
            "raw_field": "sentiment_raw_confidence(compound_score, sentiment_label)",
            "notes": "Wave 8 labelled sentiment set; outcome = predicted label matches ground truth.",
        },
        "anomaly": {
            "data": anomaly_dataset(lambda: AnomalyDetector(z_threshold=2.5, use_ml=False)),
            "dataset": "SEED_ANOMALY_EXAMPLES + data/experiments/anomaly_pump_and_dump_v1.json",
            "raw_field": "severity_score",
            "notes": "Wave 8/9 labelled anomalies; only flagged points are scored; outcome = label confirmed.",
        },
        "forecast": {
            "data": forecast_dataset(),
            "dataset": "data/experiments/anomaly_pump_and_dump_v1.json (sentiment series, walk-forward)",
            "raw_field": "confidence_24h / confidence_48h",
            "notes": "Walk-forward over the committed snapshot; outcome = predicted trend equals realised trend.",
        },
    }
