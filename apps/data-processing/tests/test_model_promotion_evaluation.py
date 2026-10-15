import json

import pandas as pd
import pytest

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


def test_rollback_loads_target_and_records_audit(monkeypatch, tmp_path):
    monkeypatch.setattr(registry, "_MODELS_ROOT", tmp_path)
    previous = registry.save_model("test", FakeModel([1, 2, 3]))
    current = registry.save_model("test", FakeModel([3, 2, 1]))
    registry.promote_model("test", current)

    assert registry.rollback_model(
        "test", actor="on-call", reason="Candidate regressed in production"
    ) == previous
    assert registry.get_current_version("test") == previous
    assert registry.get_live_model("test").predictions == [1, 2, 3]

    with open(tmp_path / "test" / "promotion_log.jsonl", encoding="utf-8") as fh:
        event = json.loads(fh.readlines()[-1])
    assert event["status"] == "rolled_back"
    assert event["actor"] == "on-call"
    assert event["reason"] == "Candidate regressed in production"
    assert event["from_version"] == current
    assert event["to_version"] == previous
    assert "timestamp" in event


def test_rollback_does_not_move_pointer_when_target_cannot_load(monkeypatch, tmp_path):
    monkeypatch.setattr(registry, "_MODELS_ROOT", tmp_path)
    previous = registry.save_model("test", FakeModel([1, 2, 3]))
    current = registry.save_model("test", FakeModel([3, 2, 1]))
    registry.promote_model("test", current)
    (tmp_path / "test" / f"{previous}.pkl").write_bytes(b"not a pickle")

    with pytest.raises(Exception):
        registry.rollback_model(
            "test", previous, actor="on-call", reason="Bad candidate"
        )

    assert registry.get_current_version("test") == current
