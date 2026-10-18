# Confidence calibration

Raw model scores are not probabilities. This document records how each served
confidence was measured against labelled outcomes, what was done about it, and
which response field clients must show.

## Which field to display

| Endpoint | **Display** | **Ignore** (raw, kept for compatibility) |
| --- | --- | --- |
| `POST /analyze`, `/analyze/batch` | `calibrated_confidence` | `confidence` (lexical support, not correctness) |
| `GET /analytics/forecast` | `calibrated_confidence_24h`, `calibrated_confidence_48h` | `confidence_24h`, `confidence_48h` |
| Anomaly results (`AnomalyResult.to_dict`) | `calibrated_confidence` (present only on flagged results) | `severity_score`, `confidence_level` |

Every response carries `confidence_guidance` (machine-readable copy of the table
above) and a `calibration` object (`method`, `reliable`, `n_samples`).
When `calibration.reliable` is `false` the sample behind the calibrator is
small (< 30); clients should treat the value as indicative and may style it
accordingly. The Isolation-Forest (multi-dimensional) anomaly result has no
ground-truth set and is **not** calibrated.

## Method

`scripts/build_calibration.py --write` regenerates `models/calibration/<model>.json`
deterministically from the committed ground truth; a test fails if the committed
files drift from a fresh build.

1. Measure the reliability curve (10 equal-width bins), expected calibration
   error (ECE) and Brier score of the raw confidence.
2. A gap is **material** when ECE > 0.05.
3. If material: fewer than 30 samples -> `base_rate` (constant, Laplace-smoothed
   accuracy); otherwise `isotonic` regression (pool-adjacent-violators).
4. A fitted method is **discarded** unless 5-fold held-out ECE improves on the raw
   ECE by at least 0.01 (so noise is not mistaken for miscalibration).
5. Calibrated outputs from a fitted method are clamped to [0.02, 0.98].

## Results

| Model | Ground truth | n | Accuracy | ECE before | ECE after (held-out) | Method |
| --- | --- | --- | --- | --- | --- | --- |
| `sentiment` | `data/sentiment_labels.seed.json` (Wave 8 labelled set) | 9 | 0.889 | 0.266 | 0.071 in-sample (n too small for held-out) | `base_rate`, **not reliable** |
| `anomaly` | `SEED_ANOMALY_EXAMPLES` + `anomaly_pump_and_dump_v1` snapshot (flagged points only) | 74 | 0.797 | 0.062 | 0.062 | `none` - isotonic gave no held-out gain, so it was discarded |
| `forecast` | walk-forward over the `anomaly_pump_and_dump_v1` sentiment series | 42 | 0.857 | 0.272 | 0.104 | `isotonic` |

Reliability curves (raw, and after calibration) are in each JSON file under
`before.curve` / `after.curve`.

## Known limitations

* The sentiment ground truth is nine labelled sentences. The calibrator is a
  conservative constant and is flagged `reliable: false`; it should be rebuilt
  when the labelling queue (`sentiment_label_routes`) has produced more labels.
* No separate forecast outcome log exists, so forecast outcomes come from a
  walk-forward over the committed Wave 9 snapshot's sentiment series. Rebuild
  once real forecast-vs-realised history is available.
* The sentiment "raw confidence" is derived from the VADER compound score
  (`sentiment_raw_confidence`); the model never exposed a probability before.
