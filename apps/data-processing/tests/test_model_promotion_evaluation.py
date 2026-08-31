import json

import pandas as pd

import src.ml.model_registry as registry


class FakeModel:
    def __init__(self, predictions):
        self.predictions = predictions

    def predict(self, features):
        return self.predictions


def evaluation_set():
    return pd.DataFrame({"feature": [1, 2, 3], "target": [1, 2, 3]})


def test_promote_on_improvement(monkeypatch, tmp_path):
    monkeypatch.setattr(registry, "_MODELS_ROOT", tmp_path)
    incumbent = registry.save_model("test", FakeModel([1, 2, 0]))
    registry.promote_model("test", incumbent)
    candidate = registry.save_model("test", FakeModel([1, 2, 3]))

    assert registry.promote_model(
        "test", candidate, evaluation_set=evaluation_set(), threshold=0.5
    ) is True
    assert registry.get_current_version("test") == candidate


def test_refuse_on_regression_records_metrics(monkeypatch, tmp_path):
    monkeypatch.setattr(registry, "_MODELS_ROOT", tmp_path)
    incumbent = registry.save_model("test", FakeModel([1, 2, 3]))
    registry.promote_model("test", incumbent)
    candidate = registry.save_model("test", FakeModel([3, 1, 1]))

    assert registry.promote_model(
        "test", candidate, evaluation_set=evaluation_set(), threshold=-1.0
    ) is False
    assert registry.get_current_version("test") == incumbent
    with open(tmp_path / "test" / "promotion_log.jsonl", encoding="utf-8") as fh:
        event = json.loads(fh.readline())
    assert event["status"] == "refused"
    assert "candidate_metrics" in event
    assert "incumbent_metrics" in event


def test_force_promote_records_override(monkeypatch, tmp_path):
    monkeypatch.setattr(registry, "_MODELS_ROOT", tmp_path)
    incumbent = registry.save_model("test", FakeModel([1, 2, 3]))
    registry.promote_model("test", incumbent)
    candidate = registry.save_model("test", FakeModel([3, 1, 1]))

    assert registry.promote_model(
        "test", candidate, evaluation_set=evaluation_set(), threshold=0.99, force=True
    ) is True
    assert registry.get_current_version("test") == candidate
    with open(tmp_path / "test" / "promotion_log.jsonl", encoding="utf-8") as fh:
        events = [json.loads(line) for line in fh]
    assert events[-1]["status"] == "forced"
