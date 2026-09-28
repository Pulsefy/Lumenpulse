# Experiment CLI

**Issue:** [#1459 — Provide a reproducible experiment CLI](https://github.com/Pulsefy/Lumenpulse/issues/1459)

`scripts/experiment.py` is the supported entry point for model experiments. It
replaces the `demo_*.py` scripts that used to live at the service root and
bypassed the model registry, the model cards and the evaluation gate.

Every run is driven by a **committed configuration file** and always does the
same four things:

1. **Snapshot** — resolve the dataset through `data.snapshot_ref`, with the
   exact bytes pinned by `data.path` + `data.sha256` (drift is refused).
2. **Train** — deterministically; the seed comes from the configuration.
3. **Evaluate** — score the held-out rows against ground-truth labels and
   evaluate `evaluation.threshold`.
4. **Record** — write a registry entry, a model card and an evaluation result,
   plus a run manifest under `runs/`.

Because the config pins the snapshot, the seed and the hyperparameters,
re-running it reproduces the same artefact from the configuration alone.

## Worked end-to-end example

```bash
cd apps/data-processing

# 1. see what is available
python scripts/experiment.py list

# 2. run the committed pump-and-dump experiment
python scripts/experiment.py run experiments/anomaly_pump_and_dump.json
```

Output:

```text
run           anomaly-pump-and-dump-20260928T111934Z-7faa62ea
snapshot      anomaly-pump-and-dump/v1 (288530a45c4d…)
split         168 train / 72 evaluation rows
registry      anomaly_detector@v1.0
model card    models/anomaly_detector/v1.0.card.json
metrics       f1_score=0.6667  precision=0.6667 recall=0.6667 accuracy=0.9167
gate          f1_score max 0.5: PASS
artefacts     runs/anomaly-pump-and-dump-20260928T111934Z-7faa62ea
```

Inspect what the run produced:

```bash
# the registry entry and its model card (records the snapshot reference)
python -c "import json;print(json.dumps(json.load(open('models/anomaly_detector/v1.0.card.json')),indent=2))"

# the evaluation result: metrics, gate and per-row predictions
python -m json.tool runs/anomaly-pump-and-dump-*/evaluation.json | less

# the manifest: config digest, snapshot provenance, artefact hashes
python -m json.tool runs/anomaly-pump-and-dump-*/manifest.json | less
```

Machine-readable output and a stricter gate:

```bash
# manifest on stdout (logs suppressed), for scripting/CI
python scripts/experiment.py run experiments/anomaly_pump_and_dump.json --json

# exit 3 when the evaluation gate fails
python scripts/experiment.py run experiments/anomaly_pump_and_dump.json --fail-on-gate
```

### Reproducibility

```bash
python scripts/experiment.py run experiments/anomaly_pump_and_dump.json --json > a.json
python scripts/experiment.py run experiments/anomaly_pump_and_dump.json --json > b.json
python - <<'PY'
import json
a, b = (json.load(open(p)) for p in ("a.json", "b.json"))
assert a["artefacts"]["model_sha256"] == b["artefacts"]["model_sha256"]
assert a["evaluation"]["prediction_digest"] == b["evaluation"]["prediction_digest"]
assert a["evaluation"]["metrics"] == b["evaluation"]["metrics"]
print("reproducible ✔")
PY
```

If the dataset changes, the pinned `data.sha256` no longer matches and the run
refuses to start:

```text
error: snapshot 'anomaly-pump-and-dump/v1' at data/experiments/… has sha256 6f0f…,
but the config pins 2885… -- refusing to run on drifted data
(exit code 2)
```

## Configuration reference

```json
{
  "name": "anomaly-pump-and-dump",
  "description": "…",
  "model_type": "anomaly_detector",
  "seed": 42,
  "data": {
    "snapshot_ref": "anomaly-pump-and-dump/v1",
    "path": "data/experiments/anomaly_pump_and_dump_v1.json",
    "sha256": "<sha256 of the snapshot file>",
    "train_fraction": 0.7
  },
  "train": { "kind": "isolation_forest", "params": { "…": "…" } },
  "evaluation": { "kind": "anomaly_detection", "metric": "f1_score", "threshold": 0.5 },
  "registry": { "promote": false }
}
```

| Field | Meaning |
| --- | --- |
| `name` | Experiment name; also the run-id prefix. |
| `model_type` | Registry namespace (`models/<model_type>/`). |
| `seed` | Seeds training; same seed + same snapshot = same artefact. |
| `data.snapshot_ref` | Reference recorded on the manifest, the model card and the evaluation result. |
| `data.path` / `data.sha256` | Immutable dataset the run reads; a mismatch aborts the run. |
| `data.train_fraction` | Deterministic holdout split (first *N* rows train). |
| `train.kind` | Trainer — currently `isolation_forest`. |
| `evaluation.kind` | Evaluator — currently `anomaly_detection` (`confirmed`/`refuted` labels). |
| `evaluation.metric` / `threshold` | Gate: `metric` must be produced by the evaluator; `direction` is inferred (`false_positive_rate`, `mae`, `rmse`, `mse` minimise, everything else maximises). |
| `registry.promote` | Always `false` here: promotion stays behind `promote_model()` and its evaluation gate (#1238). |

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Run completed (and the gate passed when `--fail-on-gate` was given). |
| `1` | The run failed (training, evaluation, registry write). |
| `2` | Invalid configuration or a snapshot that does not match its pinned sha256. |
| `3` | Evaluation gate failed (only with `--fail-on-gate`). |

## Adding a new experiment

1. Commit the dataset (or extend the generator) under
   `data/experiments/` — it is the snapshot the run reproduces from.
2. Record its sha256: `python scripts/generate_experiment_dataset.py` prints it
   for the generated snapshot; for other data use `sha256sum <file>`.
3. Copy `experiments/anomaly_pump_and_dump.json`, set the `data` block, a
   `train.kind` and an `evaluation` gate.
4. Run it: `python scripts/experiment.py run experiments/<name>.json`.

New trainers/evaluators are added to `SUPPORTED_TRAIN_KINDS` and
`SUPPORTED_EVALUATION_KINDS` in `src/ml/experiment.py`.

## Related work

- #1238 evaluation gate on promotion, #1242 model cards, #1250 reproducible
  training runs, #1256 shadow mode — all facilities this CLI drives.
- #1449 (open) owns the training-data snapshot store; `resolve_snapshot()` in
  `src/ml/experiment.py` is the single place that switches from the pinned
  file to that store once it lands.
