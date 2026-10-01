# -*- coding: utf-8 -*-
"""Tests for the reproducible experiment CLI (issue #1459)."""

from __future__ import annotations

import importlib
import json
import logging
from pathlib import Path

import pytest

APP_ROOT = Path(__file__).resolve().parents[1]
CONFIG = APP_ROOT / "experiments" / "anomaly_pump_and_dump.json"


@pytest.fixture
def experiment(tmp_path, monkeypatch):
    """Isolated model registry + runs directory, quiet loggers."""
    monkeypatch.setenv("MODEL_REGISTRY_PATH", str(tmp_path / "models"))
    monkeypatch.setenv("EXPERIMENT_RUNS_PATH", str(tmp_path / "runs"))
    logging.disable(logging.INFO)

    import src.ml.model_registry as registry

    importlib.reload(registry)
    import src.ml.experiment as experiment_module

    importlib.reload(experiment_module)
    yield experiment_module
    logging.disable(logging.NOTSET)
    monkeypatch.undo()
    importlib.reload(registry)


def _load_manifest(run_dir: Path) -> dict:
    return json.loads((run_dir / "manifest.json").read_text(encoding="utf-8"))


def test_run_produces_registry_entry_model_card_and_evaluation(experiment, tmp_path):
    manifest = experiment.run_experiment(CONFIG)

    registry = experiment.model_registry
    version = registry.get_current_version("anomaly_detector") or registry.list_versions(
        "anomaly_detector"
    )[0]
    card = registry.load_model_card("anomaly_detector", version)

    assert manifest["registry"]["version"] == version
    assert card is not None
    # the snapshot reference rides along on the card, manifest and metrics
    assert card["custom"]["snapshot_ref"] == "anomaly-pump-and-dump/v1"
    assert card["custom"]["config_digest"] == manifest["config"]["digest"]
    assert card["metrics"]["f1_score"] == manifest["evaluation"]["metrics"]["f1_score"]
    assert card["training_data"]["source"] == "anomaly-pump-and-dump/v1"

    run_dir = Path(manifest["run_dir"])
    assert (run_dir / "manifest.json").exists()
    assert (run_dir / "evaluation.json").exists()
    assert (run_dir / "config.resolved.json").exists()

    evaluation = json.loads((run_dir / "evaluation.json").read_text(encoding="utf-8"))
    assert evaluation["gate"]["passed"] is True
    assert evaluation["gate"]["metric"] == "f1_score"
    assert set(evaluation["predictions"][0]) == {"index", "is_anomaly"}
    assert manifest["split"] == {"train_rows": 168, "evaluation_rows": 72}


def test_run_is_reproducible_from_the_configuration_alone(experiment):
    first = experiment.run_experiment(CONFIG, run_id="reproducibility-a")
    second = experiment.run_experiment(CONFIG, run_id="reproducibility-b")

    assert first["artefacts"]["model_sha256"] == second["artefacts"]["model_sha256"]
    assert first["evaluation"]["prediction_digest"] == second["evaluation"]["prediction_digest"]
    assert first["evaluation"]["metrics"] == second["evaluation"]["metrics"]
    assert first["config"]["digest"] == second["config"]["digest"]
    assert first["snapshot"]["sha256"] == second["snapshot"]["sha256"]


def test_snapshot_drift_is_rejected(experiment, tmp_path):
    snapshot = APP_ROOT / "data" / "experiments" / "anomaly_pump_and_dump_v1.json"
    tampered = tmp_path / "tampered.json"
    document = json.loads(snapshot.read_text(encoding="utf-8"))
    document["records"][0]["volume"] = 999999.0
    tampered.write_text(json.dumps(document), encoding="utf-8")

    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    config["data"]["path"] = str(tampered)
    config_path = tmp_path / "tampered-config.json"
    config_path.write_text(json.dumps(config), encoding="utf-8")

    with pytest.raises(experiment.SnapshotIntegrityError) as excinfo:
        experiment.run_experiment(config_path)

    assert "refusing to run on drifted data" in str(excinfo.value)


def test_missing_required_config_field_is_reported(experiment, tmp_path):
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    del config["data"]
    config_path = tmp_path / "incomplete.json"
    config_path.write_text(json.dumps(config), encoding="utf-8")

    with pytest.raises(experiment.ExperimentConfigError) as excinfo:
        experiment.load_config(config_path)

    assert "data" in str(excinfo.value)


def test_gate_thresholds_are_evaluated(experiment):
    config = experiment.load_config(CONFIG)

    passing = experiment.evaluate_gate(config, {"f1_score": 0.9, "false_positive_rate": 0.01})
    assert passing["passed"] is True

    failing = experiment.evaluate_gate(config, {"f1_score": 0.1, "false_positive_rate": 0.01})
    assert failing["passed"] is False

    with pytest.raises(experiment.ExperimentConfigError):
        experiment.evaluate_gate(config, {"accuracy": 0.5})


def test_cli_lists_configs_and_runs_one(experiment, tmp_path, capsys):
    from scripts.experiment import main

    assert main(["list"]) == 0
    assert CONFIG.name in capsys.readouterr().out

    assert main(["run", str(CONFIG), "--runs-dir", str(tmp_path / "runs")]) == 0
    out = capsys.readouterr().out
    assert "anomaly_detector@v1.0" in out
    assert "gate" in out and "PASS" in out


def test_cli_fails_on_gate_when_asked(experiment, monkeypatch):
    from scripts import experiment as cli

    monkeypatch.setattr(
        cli,
        "run_experiment",
        lambda *args, **kwargs: {
            "run_id": "gate-check",
            "experiment": "x",
            "description": "",
            "model_type": "anomaly_detector",
            "config": {"path": "x", "digest": "d", "seed": 1, "train": {}, "evaluation": {}},
            "snapshot": {"snapshot_ref": "r", "sha256": "0" * 64},
            "split": {"train_rows": 1, "evaluation_rows": 1},
            "registry": {
                "model_type": "anomaly_detector",
                "version": "v1.0",
                "card_path": "card.json",
                "card_digest": "c",
            },
            "evaluation": {
                "metrics": {"f1_score": 0.1},
                "evaluated_rows": 1,
                "prediction_digest": "p",
                "gate": {"metric": "f1_score", "value": 0.1, "threshold": 0.5, "passed": False, "direction": "max"},
            },
            "artefacts": {"model_sha256": "m", "config_digest": "d"},
            "run_dir": "runs/gate-check",
        },
    )

    assert cli.main(["run", "unused.json"]) == 0
    assert cli.main(["run", "unused.json", "--fail-on-gate"]) == 3


def test_promotion_in_the_config_is_refused(experiment, tmp_path):
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    config["registry"]["promote"] = True
    config_path = tmp_path / "promote.json"
    config_path.write_text(json.dumps(config), encoding="utf-8")

    with pytest.raises(experiment.ExperimentConfigError) as excinfo:
        experiment.load_config(config_path)

    assert "promot" in str(excinfo.value)
