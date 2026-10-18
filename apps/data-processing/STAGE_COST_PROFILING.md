# Pipeline Stage Cost Profiling

This document describes how the data-processing service measures the compute
cost of each pipeline stage, exports that cost as metrics, retains it across
runs, and detects a regression against a recorded baseline.

Reference: Issue #1454 — "Data-processing: Profile compute cost per pipeline
stage (CPU, peak memory, wall clock)".

---

## 1. What is measured

`src/observability/stage_profiler.py` exposes `profile_stage(stage)`, a context
manager and decorator that wraps one unit of pipeline work and records three
costs for it:

| Cost | Source | Notes |
| --- | --- | --- |
| Wall clock | `time.perf_counter` | End-to-end including any I/O the stage does. |
| CPU time | `time.thread_time` | Current thread's user + system time; stays meaningful when stages run concurrently. |
| Peak memory | `tracemalloc` | Extra Python heap held at the stage's high-water mark (peak minus the heap already live when the stage started). |

The stages that are instrumented today:

| Stage | Instrumented in |
| --- | --- |
| `model_retraining_daily` | `src/ml/retraining_pipeline.py` (`run_retraining`) |
| `model_retraining.sentiment` | `src/ml/retraining_pipeline.py` |
| `model_retraining.price_predictor` | `src/ml/retraining_pipeline.py` |
| `model_retraining.anomaly_evaluation` | `src/ml/retraining_pipeline.py` |
| `forecasting` | `src/analytics/forecaster.py` (`SentimentForecaster.run`) and the `GET /analytics/forecast` route |
| `correlation_analysis` | `src/analytics/correlation_engine.py` (`full_analysis`) |
| `correlation_lag_analysis` | `src/analytics/correlation_engine.py` (`analyze_with_lags`) |
| `job.<job_type>` | `src/jobs/manager.py` (`_run_job`, one stage per queued job type) |

---

## 2. Metrics

Every measurement is exported to Prometheus, so a stage cost is visible in
`/metrics` and can be alerted on:

| Metric | Type | Labels | Meaning |
| --- | --- | --- | --- |
| `lumenpulse_pipeline_stage_wall_seconds` | histogram | `stage` | Wall-clock seconds per stage run. |
| `lumenpulse_pipeline_stage_cpu_seconds` | histogram | `stage` | CPU (user + system) seconds per stage run. |
| `lumenpulse_pipeline_stage_peak_memory_bytes` | histogram | `stage` | Peak Python heap (delta) per stage run. |
| `lumenpulse_pipeline_stage_runs_total` | counter | `stage`, `status` | Completed runs, `status` = `success` or `failed`. |

A stage that raises is still measured: it is recorded with
`status="failed"` and its error string (the exception still propagates).

---

## 3. Retained cost history

Each measurement is appended as one JSON line to a cost log, so cost history
survives process restarts and can be summarised across runs:

| Env var | Default | Purpose |
| --- | --- | --- |
| `STAGE_COST_LOG_PATH` | `$DATA_DIR/stage_costs.jsonl` | Explicit path to the JSONL cost log. |
| `DATA_DIR` | `./data` | Base directory used when `STAGE_COST_LOG_PATH` is unset. |
| `STAGE_PROFILING_TRACEMALLOC` | `1` | Set to `0`/`false` to skip `tracemalloc` (drops peak-memory cost only). |

The log is append-only, so a truncated last line (crash mid-write) is ignored
on read rather than losing the whole file.

---

## 4. Reporting and regression gating

`scripts/report_stage_costs.py` reads the log, prints a per-stage summary and
the most expensive stages (each with a tuning recommendation), and compares the
latest run of each stage against `stage_cost_baseline.json`:

```bash
# Rank the most expensive stages
python scripts/report_stage_costs.py --top 3

# Fail (exit 1) when a stage is >25% slower than the committed baseline
python scripts/report_stage_costs.py --check

# Record the current summary as the new baseline
python scripts/report_stage_costs.py --write-baseline
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--log` | resolved cost log | JSONL cost log to read. |
| `--baseline` | `stage_cost_baseline.json` | Baseline used for regression detection. |
| `--top` | `3` | Number of expensive stages to report. |
| `--last-n` | `0` (all runs) | Aggregate only the last N runs per stage. |
| `--threshold` | `25` | Regression threshold, as a percentage above the baseline. |
| `--check` | off | Exit 1 on a regression or a missing baseline. |
| `--write-baseline` | off | Write the current summary to the baseline file. |
| `--json` | off | Emit the report as JSON. |

A regression is the most recent run of a stage exceeding its baseline
`cpu_seconds` or `wall_seconds` by the threshold; it is detectable both from the
metric (compared over time) and from the CLI (`--check`).

---

## 5. Recorded baseline

`stage_cost_baseline.json` records the median cost per stage. The figures below
were produced by running the profiled stages once each (Python 3.9, a single
development machine) and writing the summary with `--write-baseline`; absolute
values are environment-specific, and the file is the source of truth for the
`--check` gate.

| Stage | Runs | Wall (median) | CPU (median) | Peak memory (median) |
| --- | --- | --- | --- | --- |
| `model_retraining_daily` | 1 | 714 ms | 703 ms | 9.7 MB |
| `correlation_lag_analysis` | 1 | 477 ms | 438 ms | 145 KB |
| `model_retraining.sentiment` | 1 | 136 ms | 141 ms | 5.3 MB |
| `correlation_analysis` | 1 | 130 ms | 141 ms | 286 KB |
| `model_retraining.price_predictor` | 1 | 99 ms | 94 ms | 986 KB |
| `forecasting` | 1 | 17 ms | 16 ms | 92 KB |
| `model_retraining.anomaly_evaluation` | 1 | 13 ms | 16 ms | 19 KB |
| `job.daily_kpi_snapshot` | 1 | <1 ms | 0 ms | 56 B |

### Three most expensive stages

The three costliest stages, with the recommendation the reporter emits for
each:

1. **`model_retraining_daily`** (703 ms CPU, 714 ms wall, 9.7 MB peak) —
   Retraining dominates compute; run it on a schedule rather than on demand and
   cap the training window so row count stays bounded.
2. **`correlation_lag_analysis`** (438 ms CPU, 477 ms wall, 145 KB peak) —
   Runs `full_analysis` once per lag offset; evaluate only the lags that can
   plausibly matter instead of a dense sweep.
3. **`model_retraining.sentiment`** (141 ms CPU, 136 ms wall, 5.3 MB peak) —
   Rebuilds the VADER lexicon on every run; cache the enriched lexicon and only
   rebuild it when the slang dictionary changes.

---

## 6. Refreshing the baseline

After an intentional change to a stage's cost profile, regenerate the baseline
and commit it with the change:

```bash
# Produce fresh measurements (run the pipeline / its tests), then:
python scripts/report_stage_costs.py --write-baseline
python scripts/report_stage_costs.py --check   # should now pass
```

### Caveats

* **Peak memory is process-wide.** `tracemalloc` is global: when two profiled
  stages overlap, the peak is shared between them. CPU time uses thread-local
  timing, so it is not affected by that overlap.
* **Small samples are noisy.** The baseline is a median; ranking and regression
  detection become more stable as more runs accumulate in the log (`--last-n`
  keeps a summary representative after a configuration change).
