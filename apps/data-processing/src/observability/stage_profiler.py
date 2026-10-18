"""Per-stage compute-cost profiling (#1454).

Retraining, forecasting, correlation analysis and the Wave 8 async job queue
are the most expensive operations in the service and, before this module, none
of them was measured. ``profile_stage`` wraps a unit of pipeline work and
records three costs for it:

* wall clock -- ``time.perf_counter``
* CPU time   -- ``time.thread_time`` (the current thread's user + system time),
               which stays meaningful when stages run concurrently
* peak memory -- the extra Python heap the stage held at its high-water mark,
               i.e. the ``tracemalloc`` peak measured while it ran minus the
               heap already live when it started

Every measurement is exported to Prometheus (so it can be alerted on) and,
unless disabled, appended to a JSONL log so cost history survives process
restarts. ``scripts/report_stage_costs.py`` reads that log to rank the most
expensive stages and to flag a regression against ``stage_cost_baseline.json``.

Peak memory is process-wide state in ``tracemalloc``: when two profiled stages
overlap the reported peak is shared between them. CPU time uses thread-local
timing, so it is not affected by that overlap.
"""

from __future__ import annotations

import json
import os
import statistics
import threading
import time
import tracemalloc
import uuid
from contextlib import ContextDecorator
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Type

from prometheus_client import Counter, Histogram

from src.utils.logger import setup_logger

logger = setup_logger(__name__)

# ── Prometheus metrics ──────────────────────────────────────────────────────

_WALL_BUCKETS = (
    0.001,
    0.005,
    0.01,
    0.05,
    0.1,
    0.5,
    1.0,
    5.0,
    30.0,
    60.0,
    300.0,
    1800.0,
)
_CPU_BUCKETS = _WALL_BUCKETS
_MEMORY_BUCKETS = (
    100_000,
    1_000_000,
    5_000_000,
    10_000_000,
    50_000_000,
    100_000_000,
    500_000_000,
    1_000_000_000,
)

STAGE_WALL_SECONDS = Histogram(
    "lumenpulse_pipeline_stage_wall_seconds",
    "Wall-clock seconds spent in each data-processing pipeline stage",
    ["stage"],
    buckets=_WALL_BUCKETS,
)

STAGE_CPU_SECONDS = Histogram(
    "lumenpulse_pipeline_stage_cpu_seconds",
    "CPU (user + system) seconds spent in each data-processing pipeline stage",
    ["stage"],
    buckets=_CPU_BUCKETS,
)

STAGE_PEAK_MEMORY_BYTES = Histogram(
    "lumenpulse_pipeline_stage_peak_memory_bytes",
    "Peak Python heap allocated during each data-processing pipeline stage",
    ["stage"],
    buckets=_MEMORY_BUCKETS,
)

STAGE_RUNS_TOTAL = Counter(
    "lumenpulse_pipeline_stage_runs_total",
    "Completed pipeline-stage profiling runs",
    ["stage", "status"],  # status: success | failed
)

# ── Retention log ───────────────────────────────────────────────────────────

_DEFAULT_LOG_ENV = "STAGE_COST_LOG_PATH"
_log_lock = threading.Lock()


def default_log_path() -> str:
    """Resolve the JSONL cost log path from the environment."""
    explicit = os.getenv(_DEFAULT_LOG_ENV)
    if explicit:
        return explicit
    data_dir = os.getenv("DATA_DIR", "./data")
    return os.path.join(data_dir, "stage_costs.jsonl")


def _tracemalloc_disabled() -> bool:
    return os.getenv("STAGE_PROFILING_TRACEMALLOC", "1").strip().lower() in (
        "0",
        "false",
        "no",
    )


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(frozen=True)
class StageMeasurement:
    """One profiled stage run."""

    stage: str
    status: str
    wall_seconds: float
    cpu_seconds: float
    peak_memory_bytes: int
    started_at: str
    finished_at: str
    run_id: str
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "StageMeasurement":
        if not isinstance(data, dict):
            raise TypeError("stage measurement must be an object")
        # A truncated line (crash mid-write) must not be read back as a run.
        missing = [k for k in ("stage", "wall_seconds", "cpu_seconds") if k not in data]
        if missing:
            raise ValueError(f"incomplete stage measurement: {', '.join(missing)}")
        return cls(
            stage=str(data["stage"]),
            status=str(data.get("status", "success")),
            wall_seconds=float(data.get("wall_seconds", 0.0)),
            cpu_seconds=float(data.get("cpu_seconds", 0.0)),
            peak_memory_bytes=int(data.get("peak_memory_bytes", 0)),
            started_at=str(data.get("started_at", "")),
            finished_at=str(data.get("finished_at", "")),
            run_id=str(data.get("run_id", "")),
            error=data.get("error"),
        )


class StageProfiler(ContextDecorator):
    """Context manager / decorator that measures one pipeline stage.

    Usage::

        with profile_stage("forecasting"):
            result = forecaster.run()

    or as a decorator::

        @profile_stage("correlation_analysis")
        def analyze(...):
            ...
    """

    def __init__(
        self,
        stage: str,
        log_path: Optional[str] = None,
        run_id: Optional[str] = None,
        record: bool = True,
    ) -> None:
        self.stage = stage
        self._log_path = log_path
        self._explicit_run_id = run_id
        self._run_id = run_id or uuid.uuid4().hex
        self._record = record
        self._tracing = False
        self._traced_start = 0
        self._wall_start = 0.0
        self._cpu_start = 0.0
        self._started_at = ""
        self.measurement: Optional[StageMeasurement] = None

    def _recreate_cm(self) -> "StageProfiler":
        """Fresh profiler per invocation so decorated calls never share state."""
        return StageProfiler(
            self.stage,
            log_path=self._log_path,
            run_id=self._explicit_run_id,
            record=self._record,
        )

    def __enter__(self) -> "StageProfiler":
        self._wall_start = time.perf_counter()
        self._cpu_start = time.thread_time()
        self._started_at = _utcnow_iso()
        self._tracing = False
        if not _tracemalloc_disabled():
            if not tracemalloc.is_tracing():
                try:
                    tracemalloc.start()
                except Exception as exc:  # pragma: no cover - platform specific
                    logger.debug("tracemalloc unavailable: %s", exc)
            if tracemalloc.is_tracing():
                tracemalloc.reset_peak()
                # reset_peak() sets the peak to the *current* heap, so record it
                # and report the stage's own high-water mark as a delta below.
                self._traced_start = tracemalloc.get_traced_memory()[0]
                self._tracing = True
        return self

    def __exit__(
        self,
        exc_type: Optional[Type[BaseException]],
        exc: Optional[BaseException],
        tb: Any,
    ) -> bool:
        wall_seconds = time.perf_counter() - self._wall_start
        cpu_seconds = time.thread_time() - self._cpu_start
        peak_memory_bytes = 0
        if self._tracing and tracemalloc.is_tracing():
            _current, peak = tracemalloc.get_traced_memory()
            peak_memory_bytes = max(int(peak) - self._traced_start, 0)

        status = "failed" if exc_type is not None else "success"
        measurement = StageMeasurement(
            stage=self.stage,
            status=status,
            wall_seconds=round(wall_seconds, 6),
            cpu_seconds=round(cpu_seconds, 6),
            peak_memory_bytes=peak_memory_bytes,
            started_at=self._started_at,
            finished_at=_utcnow_iso(),
            run_id=self._run_id,
            error=str(exc) if exc is not None else None,
        )
        self.measurement = measurement
        _emit(measurement)
        if self._record:
            try:
                append_measurement(measurement, log_path=self._log_path)
            except Exception as log_exc:  # pragma: no cover - best effort
                logger.warning("Failed to append stage cost log: %s", log_exc)
        return False


def profile_stage(
    stage: str,
    log_path: Optional[str] = None,
    run_id: Optional[str] = None,
    record: bool = True,
) -> StageProfiler:
    """Return a :class:`StageProfiler` for ``stage``."""
    return StageProfiler(stage, log_path=log_path, run_id=run_id, record=record)


def _emit(measurement: StageMeasurement) -> None:
    STAGE_WALL_SECONDS.labels(stage=measurement.stage).observe(
        measurement.wall_seconds
    )
    STAGE_CPU_SECONDS.labels(stage=measurement.stage).observe(
        measurement.cpu_seconds
    )
    STAGE_PEAK_MEMORY_BYTES.labels(stage=measurement.stage).observe(
        measurement.peak_memory_bytes
    )
    STAGE_RUNS_TOTAL.labels(
        stage=measurement.stage, status=measurement.status
    ).inc()


def append_measurement(
    measurement: StageMeasurement, log_path: Optional[str] = None
) -> None:
    """Append ``measurement`` as one JSON line to the retained cost log."""
    path = Path(log_path or default_log_path())
    if path.parent and str(path.parent) not in ("", "."):
        path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(measurement.to_dict(), sort_keys=True)
    with _log_lock:
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(line + "\n")


def load_measurements(log_path: Optional[str] = None) -> List[StageMeasurement]:
    """Read every valid measurement from the cost log, in append order."""
    path = Path(log_path or default_log_path())
    if not path.exists():
        return []
    measurements: List[StageMeasurement] = []
    with open(path, "r", encoding="utf-8") as handle:
        for raw in handle:
            raw = raw.strip()
            if not raw:
                continue
            try:
                measurements.append(StageMeasurement.from_dict(json.loads(raw)))
            except (ValueError, KeyError, TypeError):
                continue
    return measurements


def summarize_costs(
    measurements: List[StageMeasurement], last_n: Optional[int] = None
) -> Dict[str, Dict[str, float]]:
    """Aggregate the cost log into a per-stage median summary.

    ``last_n`` limits the aggregation to the most recent ``last_n`` runs of each
    stage, which keeps a summary representative after a configuration change.
    """
    grouped: Dict[str, List[StageMeasurement]] = {}
    for measurement in measurements:
        grouped.setdefault(measurement.stage, []).append(measurement)

    summary: Dict[str, Dict[str, float]] = {}
    for stage, runs in grouped.items():
        selected = runs[-last_n:] if last_n else runs
        summary[stage] = {
            "runs": float(len(selected)),
            "wall_seconds": round(
                statistics.median(m.wall_seconds for m in selected), 6
            ),
            "cpu_seconds": round(
                statistics.median(m.cpu_seconds for m in selected), 6
            ),
            "peak_memory_bytes": float(
                statistics.median(m.peak_memory_bytes for m in selected)
            ),
        }
    return summary


def rank_stages(summary: Dict[str, Dict[str, float]]) -> List[str]:
    """Order stages from most to least expensive (CPU, then wall, then memory)."""
    return sorted(
        summary,
        key=lambda stage: (
            summary[stage].get("cpu_seconds", 0.0),
            summary[stage].get("wall_seconds", 0.0),
            summary[stage].get("peak_memory_bytes", 0.0),
        ),
        reverse=True,
    )


RECOMMENDATIONS: Dict[str, str] = {
    "model_retraining_daily": (
        "Retraining dominates compute; run it on a schedule rather than on "
        "demand and cap the training window so row count stays bounded."
    ),
    "model_retraining.sentiment": (
        "Rebuilds the VADER lexicon on every run; cache the enriched lexicon "
        "and only rebuild it when the slang dictionary changes."
    ),
    "model_retraining.price_predictor": (
        "Retrains a scikit-learn pipeline on the full feature window; trim the "
        "feature set to those with non-zero importance and reuse the snapshot."
    ),
    "model_retraining.anomaly_evaluation": (
        "Re-scores the labelled seed set every run; keep the seed set small and "
        "sample it when it grows."
    ),
    "forecasting": (
        "Prophet fits one model per horizon; keep the sklearn Ridge backend "
        "enabled and cache the fitted model until the input window changes."
    ),
    "correlation_analysis": (
        "Converts both series to DataFrames per metric; reuse a single aligned "
        "frame for price and volume instead of rebuilding it twice."
    ),
    "correlation_lag_analysis": (
        "Runs full_analysis once per lag offset; evaluate only the lags that "
        "can plausibly matter instead of a dense sweep."
    ),
}

_JOB_PREFIX = "job."


def recommendation_for(stage: str) -> str:
    """Return a tuning recommendation for ``stage``."""
    if stage in RECOMMENDATIONS:
        return RECOMMENDATIONS[stage]
    if stage.startswith(_JOB_PREFIX):
        job_type = stage[len(_JOB_PREFIX):]
        inner = "model_retraining_daily" if job_type == "retrain" else job_type
        if inner in RECOMMENDATIONS:
            return (
                f"Async job '{job_type}' is dominated by its work function; "
                + RECOMMENDATIONS[inner]
            )
        return (
            f"Async job '{job_type}' runs on the shared job-queue workers; "
            "lower its frequency or split it if it starves other jobs."
        )
    return (
        "Profile the stage over more runs to establish a trend, then target "
        "the dominant cost (CPU, wall or memory)."
    )


def latest_by_stage(
    measurements: List[StageMeasurement]
) -> Dict[str, StageMeasurement]:
    """Return the most recent measurement for each stage."""
    latest: Dict[str, StageMeasurement] = {}
    for measurement in measurements:
        latest[measurement.stage] = measurement
    return latest


def detect_regressions(
    measurements: List[StageMeasurement],
    baseline: Dict[str, Dict[str, float]],
    threshold: float = 0.25,
) -> List[Dict[str, Any]]:
    """Flag stages whose most recent run exceeds the baseline by ``threshold``.

    ``baseline`` maps a stage to its recorded ``cpu_seconds`` / ``wall_seconds``
    (see :func:`write_baseline`). Returns one entry per breaching metric.
    """
    regressions: List[Dict[str, Any]] = []
    for stage, latest in latest_by_stage(measurements).items():
        reference = baseline.get(stage)
        if not reference:
            continue
        for metric in ("cpu_seconds", "wall_seconds"):
            base_value = reference.get(metric)
            if not base_value or base_value <= 0:
                continue
            latest_value = getattr(latest, metric)
            ratio = latest_value / base_value
            if ratio > 1.0 + threshold:
                regressions.append(
                    {
                        "stage": stage,
                        "metric": metric,
                        "baseline": base_value,
                        "latest": latest_value,
                        "ratio": round(ratio, 4),
                    }
                )
    return regressions


def write_baseline(path: str, summary: Dict[str, Dict[str, float]]) -> None:
    """Write the per-stage medians as a regression baseline."""
    baseline = {
        stage: {
            "cpu_seconds": values.get("cpu_seconds", 0.0),
            "wall_seconds": values.get("wall_seconds", 0.0),
            "peak_memory_bytes": values.get("peak_memory_bytes", 0.0),
            "runs": values.get("runs", 0.0),
        }
        for stage, values in summary.items()
    }
    target = Path(path)
    if target.parent and str(target.parent) not in ("", "."):
        target.parent.mkdir(parents=True, exist_ok=True)
    with open(target, "w", encoding="utf-8") as handle:
        json.dump(baseline, handle, indent=2, sort_keys=True)
        handle.write("\n")


def load_baseline(path: str) -> Dict[str, Dict[str, float]]:
    """Load a regression baseline written by :func:`write_baseline`."""
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {
        str(stage): values
        for stage, values in data.items()
        if isinstance(values, dict)
    }
