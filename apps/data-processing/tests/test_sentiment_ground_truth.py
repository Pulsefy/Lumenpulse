from datetime import datetime

from src.ml.sentiment_evaluation import classification_metrics, evaluate_sentiment


def test_classification_metrics_reports_macro_precision_recall_f1():
    metrics = classification_metrics(
        ["positive", "negative", "neutral"],
        ["positive", "neutral", "neutral"],
    )
    assert metrics["support"] == 3
    assert 0 < metrics["precision"] < 1
    assert 0 < metrics["recall"] < 1
    assert 0 < metrics["f1"] < 1


def test_evaluation_uses_only_held_out_rows():
    class Result:
        sentiment_label = "positive"

    class Analyzer:
        def analyze(self, text):
            return Result()

    rows = [
        {"text": "train", "label": "positive", "is_held_out": False},
        {"text": "test", "label": "positive", "is_held_out": True},
    ]
    metrics = evaluate_sentiment(Analyzer(), rows)
    assert metrics["support"] == 1
    assert metrics["f1"] == 1 / 3
