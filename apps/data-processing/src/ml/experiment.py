# -*- coding: utf-8 -*-
"""Reproducible experiment runner (issue #1459).

``scripts/experiment.py`` is the supported entry point for model work; the
``demo_*.py`` scripts it replaces bypassed the registry, the model cards and
the evaluation gate.  A run is driven entirely by a committed configuration
file and always does the same four things:

1. resolve the dataset through the snapshot reference pinned in the config
   (``data.path`` + ``data.sha256``),
2. train deterministically -- the seed comes from the configuration,
3. evaluate against ground-truth labels and evaluate the gate,
4. write a registry entry, a model card and an evaluation result, plus a run
   manifest under ``runs/``.

Because the config pins the snapshot, the seed and the hyperparameters, a
re-run reproduces the same artefact from the configuration alone.
"""

from __future__ import annotations

import getpass
import hashlib
import json
import os
import pickle
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from . import model_registry
from .anomaly_evaluation import binary_classification_metrics
from .model_card import model_card_path

APP_ROOT = Path(__file__).resolve().parents[2]
EXPERIMENTS_DIR = APP_ROOT / "experiments"
DEFAULT_RUNS_DIR = APP_ROOT / "runs"

REQUIRED_FIELDS = ("name", "model_type", "seed", "data", "train", "evaluation")
SUPPORTED_TRAIN_KINDS = ("isolation_forest",)
SUPPORTED_EVALUATION_KINDS = ("anomaly_detection",)
LABELS = ("confirmed", "refuted")
LOWER_IS_BETTER = frozenset({"false_positive_rate", "mae", "rmse", "mse"})
HISTORY_WINDOW = 5


class ExperimentError(Exception):
    """A run failed for a reason the operator can act on."""


class ExperimentConfigError(ExperimentError):
    """The configuration file is missing, unreadable or invalid."""


class SnapshotIntegrityError(ExperimentError):
    """The dataset on disk no longer matches the sha256 pinned in the config."""


@dataclass
class ExperimentConfig:
    name: str
    model_type: str
    seed: int
    data: Dict[str, Any]
    train: Dict[str, Any]
    evaluation: Dict[str, Any]
    registry: Dict[str, Any]
    description: str
    path: Path
    raw: Dict[str, Any] = field(repr=False, default_factory=dict)


def load_config(path: Any) -> ExperimentConfig:
    """Read and validate a committed experiment configuration file."""
    config_path = Path(path)
    if not config_path.exists():
        raise ExperimentConfigError(f"config not found: {config_path}")

    try:
        raw = json.loads(config_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ExperimentConfigError(f"{config_path} is not valid JSON: {exc}") from exc

    if not isinstance(raw, dict):
        raise ExperimentConfigError(f"{config_path} must contain a JSON object")

    missing = [key for key in REQUIRED_FIELDS if key not in raw]
    if missing:
        raise ExperimentConfigError(
            f"{config_path} is missing required field(s): {', '.join(missing)}"
        )

    for key in ("name", "model_type"):
        if not isinstance(raw[key], str) or not raw[key].strip():
            raise ExperimentConfigError(f"'{key}' must be a non-empty string")

    if isinstance(raw["seed"], bool) or not isinstance(raw["seed"], int):
        raise ExperimentConfigError("'seed' must be an integer")

    sections = {}
    for section in ("data", "train", "evaluation", "registry"):
        value = raw.get(section, {})
        if not isinstance(value, dict):
            raise ExperimentConfigError(f"'{section}' must be an object")
        sections[section] = value

    data = sections["data"]
    for key in ("snapshot_ref", "path", "sha256"):
        if not data.get(key):
            raise ExperimentConfigError(
                f"'data.{key}' is required -- it pins the snapshot the run "
                "reproduces from"
            )

    if sections["train"].get("kind") not in SUPPORTED_TRAIN_KINDS:
        raise ExperimentConfigError(
            "'train.kind' must be one of: " + ", ".join(SUPPORTED_TRAIN_KINDS)
        )

    evaluation = sections["evaluation"]
    if evaluation.get("kind") not in SUPPORTED_EVALUATION_KINDS:
        raise ExperimentConfigError(
            "'evaluation.kind' must be one of: " + ", ".join(SUPPORTED_EVALUATION_KINDS)
        )
    if not evaluation.get("metric"):
        raise ExperimentConfigError("'evaluation.metric' is required")

    if sections["registry"].get("promote"):
        raise ExperimentConfigError(
            "'registry.promote' is not supported here: the experiment CLI records "
            "the evaluation result, promotion stays behind promote_model() and its "
            "evaluation gate"
        )

    train_fraction = data.get("train_fraction", 0.7)
    if isinstance(train_fraction, bool) or not isinstance(train_fraction, (int, float)):
        raise ExperimentConfigError("'data.train_fraction' must be a number between 0 and 1")
    if not 0 < float(train_fraction) < 1:
        raise ExperimentConfigError("'data.train_fraction' must be strictly between 0 and 1")

    return ExperimentConfig(
        name=raw["name"].strip(),
        model_type=raw["model_type"].strip(),
        seed=raw["seed"],
        data=data,
        train=sections["train"],
        evaluation=evaluation,
        registry=sections["registry"],
        description=raw.get("description", ""),
        path=config_path,
        raw=raw,
    )


def config_digest(config: ExperimentConfig) -> str:
    """Stable digest of the configuration the run was driven by."""
    canonical = json.dumps(
        config.raw, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _snapshot_path(config: ExperimentConfig) -> Path:
    raw_path = Path(config.data["path"])
    return raw_path if raw_path.is_absolute() else APP_ROOT / raw_path


def resolve_snapshot(config: ExperimentConfig) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Load the dataset pinned by the config, verifying its sha256.

    ``data.snapshot_ref`` is the reference recorded on every artefact this run
    produces; ``data.path``/``data.sha256`` pin the exact bytes until issue
    #1449's snapshot store owns that reference -- ``resolve_snapshot`` is the
    single place to switch over when it lands.
    """
    path = _snapshot_path(config)
    if not path.exists():
        raise SnapshotIntegrityError(
            f"snapshot {config.data['snapshot_ref']!r} not found at {path}"
        )

    payload = path.read_bytes()
    # Hash line-ending-normalised bytes: git checks the snapshot out as CRLF
    # on Windows (core.autocrlf) and LF everywhere else, and neither should
    # count as data drift.
    normalized = payload.replace(b"\r\n", b"\n")
    digest = hashlib.sha256(normalized).hexdigest()
    expected = str(config.data["sha256"]).lower()
    if digest != expected:
        raise SnapshotIntegrityError(
            f"snapshot {config.data['snapshot_ref']!r} at {path} has sha256 {digest}, "
            f"but the config pins {expected} -- refusing to run on drifted data"
        )

    try:
        document = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SnapshotIntegrityError(f"snapshot {path} is not valid JSON: {exc}") from exc

    records = document.get("records") if isinstance(document, dict) else document
    if not isinstance(records, list) or not records:
        raise SnapshotIntegrityError(f"snapshot {path} contains no records")

    for offset, record in enumerate(records):
        if not isinstance(record, dict):
            raise SnapshotIntegrityError(f"snapshot record {offset} is not an object")
        if record.get("label") not in LABELS:
            raise SnapshotIntegrityError(
                f"snapshot record {offset} has label {record.get('label')!r}; "
                f"expected one of {', '.join(LABELS)}"
            )

    provenance = {
        "snapshot_ref": config.data["snapshot_ref"],
        "path": str(path.relative_to(APP_ROOT)) if path.is_relative_to(APP_ROOT) else str(path),
        "sha256": digest,
        "records": len(records),
    }
    return records, provenance


def split_records(config: ExperimentConfig, records: List[Dict[str, Any]]) -> Tuple[int, List[Dict[str, Any]]]:
    """Deterministic holdout: the first ``train_fraction`` rows train, the rest evaluate."""
    cut = int(len(records) * float(config.data.get("train_fraction", 0.7)))
    if cut < 1 or cut >= len(records):
        raise ExperimentConfigError(
            f"data.train_fraction splits {len(records)} records into an empty "
            "training or evaluation set"
        )
    return cut, records[:cut]


def train(config: ExperimentConfig, train_records: List[Dict[str, Any]]) -> Any:
    """Train the configured model.  Seed comes from the configuration."""
    kind = config.train["kind"]
    if kind != "isolation_forest":
        raise ExperimentConfigError(f"unsupported train.kind: {kind!r}")

    from src.anomaly_detector import IsolationForestDetector  # heavy import, keep local

    params = dict(config.train.get("params") or {})
    params.setdefault("random_state", config.seed)
    try:
        detector = IsolationForestDetector(**params)
    except TypeError as exc:
        raise ExperimentConfigError(f"train.params is not valid for {kind}: {exc}") from exc

    if not detector.train(train_records):
        raise ExperimentError(
            f"{kind} training failed on {len(train_records)} records "
            f"(the detector needs at least {detector.min_training_samples})"
        )
    return detector


def evaluate(
    config: ExperimentConfig, model: Any, records: List[Dict[str, Any]], split_index: int
) -> Dict[str, Any]:
    """Score the model on the held-out rows and return metrics + predictions."""
    kind = config.evaluation["kind"]
    if kind != "anomaly_detection":
        raise ExperimentConfigError(f"unsupported evaluation.kind: {kind!r}")

    actual: List[str] = []
    predicted: List[bool] = []
    predictions: List[Dict[str, Any]] = []

    for index in range(split_index, len(records)):
        record = records[index]
        history = records[max(0, index - HISTORY_WINDOW):index]
        volume_history = [row["volume"] for row in history]
        sentiment_history = [row["sentiment"] for row in history]
        result = model.detect_anomaly(
            float(record["volume"]),
            float(record["sentiment"]),
            volume_history,
            sentiment_history,
        )
        is_anomaly = bool(result.is_anomaly) if result is not None else False
        actual.append(record["label"])
        predicted.append(is_anomaly)
        predictions.append({"index": index, "is_anomaly": is_anomaly})

    if not actual:
        raise ExperimentError("evaluation set is empty")

    metrics = binary_classification_metrics(actual, predicted)
    precision, recall = metrics["precision"], metrics["recall"]
    metrics["f1_score"] = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
    correct = metrics["true_positives"] + metrics["true_negatives"]
    metrics["accuracy"] = correct / metrics["support"]

    return {
        "metrics": metrics,
        "predictions": predictions,
        "evaluated_rows": len(actual),
        "prediction_digest": _digest(predictions),
    }


def evaluate_gate(config: ExperimentConfig, metrics: Dict[str, Any]) -> Dict[str, Any]:
    """Apply ``evaluation.threshold`` to ``evaluation.metric``."""
    metric = config.evaluation["metric"]
    if metric not in metrics:
        raise ExperimentConfigError(
            f"evaluation.metric {metric!r} is not produced by the "
            f"{config.evaluation['kind']} evaluator; available: {', '.join(sorted(metrics))}"
        )

    value = float(metrics[metric])
    threshold = config.evaluation.get("threshold")
    if threshold is None:
        return {"metric": metric, "value": value, "threshold": None, "passed": True}

    threshold = float(threshold)
    higher_is_better = metric not in LOWER_IS_BETTER
    passed = value >= threshold if higher_is_better else value <= threshold
    return {
        "metric": metric,
        "value": value,
        "threshold": threshold,
        "passed": bool(passed),
        "direction": "min" if not higher_is_better else "max",
    }


def _digest(payload: Any) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _card_data(
    config: ExperimentConfig,
    run_id: str,
    config_sha: str,
    snapshot: Dict[str, Any],
    train_rows: int,
    evaluation: Dict[str, Any],
    gate: Dict[str, Any],
) -> Dict[str, Any]:
    metrics = evaluation["metrics"]
    params = dict(config.train.get("params") or {})
    params["seed"] = config.seed

    return {
        "training_data": {
            "row_count": train_rows,
            "source": snapshot["snapshot_ref"],
            "description": config.description or config.name,
            "features": ["volume", "sentiment"],
        },
        "hyperparameters": {"params": params},
        "metrics": {
            "accuracy": metrics["accuracy"],
            "precision": metrics["precision"],
            "recall": metrics["recall"],
            "f1_score": metrics["f1_score"],
            "additional_metrics": {"false_positive_rate": metrics["false_positive_rate"]},
            "test_size": evaluation["evaluated_rows"],
        },
        "feature_schema": {
            "version": "1.0",
            "features": [
                {"name": "volume", "type": "float"},
                {"name": "sentiment", "type": "float"},
            ],
            "target": "label",
        },
        "training_script": "scripts/experiment.py",
        "created_by": getpass.getuser(),
        "source_code_commit": os.getenv("GITHUB_SHA"),
        "custom": {
            "experiment": config.name,
            "run_id": run_id,
            "config_digest": config_sha,
            "snapshot_ref": snapshot["snapshot_ref"],
            "snapshot_sha256": snapshot["sha256"],
            "seed": config.seed,
            "gate": gate,
        },
    }


def _new_run_id(config: ExperimentConfig, config_sha: str) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"{config.name}-{stamp}-{config_sha[:8]}"


def _run_dir(runs_root: Path, run_id: str) -> Path:
    candidate = runs_root / run_id
    suffix = 1
    while candidate.exists():
        candidate = runs_root / f"{run_id}-{suffix}"
        suffix += 1
    return candidate


def run_experiment(config_path: Any, runs_dir: Any = None, run_id: Optional[str] = None) -> Dict[str, Any]:
    """Execute one experiment and return its manifest."""
    config = load_config(config_path)
    config_sha = config_digest(config)
    run_id = run_id or _new_run_id(config, config_sha)
    started_at = datetime.now(timezone.utc)

    records, snapshot = resolve_snapshot(config)
    split_index, train_records = split_records(config, records)
    model = train(config, train_records)
    evaluation = evaluate(config, model, records, split_index)
    gate = evaluate_gate(config, evaluation["metrics"])

    card_data = _card_data(
        config, run_id, config_sha, snapshot, len(train_records), evaluation, gate
    )
    version = model_registry.save_model_with_card(config.model_type, model, card_data)
    card = model_registry.load_model_card(config.model_type, version)
    if not card:
        raise ExperimentError(
            f"registry entry {config.model_type}@{version} was saved without a model card"
        )

    predictions = evaluation.pop("predictions")
    manifest = {
        "run_id": run_id,
        "experiment": config.name,
        "description": config.description,
        "model_type": config.model_type,
        "config": {
            "path": str(config.path),
            "digest": config_sha,
            "seed": config.seed,
            "train": config.train,
            "evaluation": config.evaluation,
        },
        "snapshot": snapshot,
        "split": {"train_rows": len(train_records), "evaluation_rows": evaluation["evaluated_rows"]},
        "registry": {
            "model_type": config.model_type,
            "version": version,
            "card_path": str(model_card_path(config.model_type, version)),
            "card_digest": _digest(card),
        },
        "evaluation": {
            "metrics": evaluation["metrics"],
            "evaluated_rows": evaluation["evaluated_rows"],
            "prediction_digest": evaluation["prediction_digest"],
            "gate": gate,
        },
        "artefacts": {
            "model_sha256": hashlib.sha256(
                pickle.dumps(model, protocol=pickle.HIGHEST_PROTOCOL)
            ).hexdigest(),
            "config_digest": config_sha,
        },
        "started_at": started_at.isoformat(),
        "finished_at": datetime.now(timezone.utc).isoformat(),
    }

    runs_root = Path(runs_dir) if runs_dir else Path(
        os.getenv("EXPERIMENT_RUNS_PATH", str(DEFAULT_RUNS_DIR))
    )
    run_dir = _run_dir(runs_root, run_id)
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True, default=str) + "\n", encoding="utf-8"
    )
    (run_dir / "evaluation.json").write_text(
        json.dumps(
            {
                "run_id": run_id,
                "model_type": config.model_type,
                "version": version,
                "metrics": evaluation["metrics"],
                "predictions": predictions,
                "gate": gate,
            },
            indent=2,
            sort_keys=True,
            default=str,
        )
        + "\n",
        encoding="utf-8",
    )
    (run_dir / "config.resolved.json").write_text(
        json.dumps(config.raw, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    manifest["run_dir"] = str(run_dir)
    return manifest


def list_configs(directory: Any = None) -> List[Path]:
    """Committed experiment configuration files, sorted."""
    root = Path(directory) if directory else EXPERIMENTS_DIR
    if not root.exists():
        return []
    return sorted(root.glob("*.json"))


__all__ = [
    "APP_ROOT",
    "EXPERIMENTS_DIR",
    "ExperimentConfig",
    "ExperimentConfigError",
    "ExperimentError",
    "SnapshotIntegrityError",
    "config_digest",
    "evaluate_gate",
    "list_configs",
    "load_config",
    "resolve_snapshot",
    "run_experiment",
]
