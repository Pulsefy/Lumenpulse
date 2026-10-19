"""Tests for per-stage compute-cost profiling (#1454)."""

import json

import pytest
from prometheus_client import REGISTRY

from src.observability.stage_profiler import (
    RECOMMENDATIONS,
    StageMeasurement,
    default_log_path,
    detect_regressions,
    load_baseline,
    load_measurements,
    profile_stage,
    rank_stages,
    recommendation_for,
    summarize_costs,
    write_baseline,
)


def _measurement(stage, wall=1.0, cpu=0.5, mem=1024, status="success", run_id="r1"):
    return StageMeasurement(
        stage=stage,
        status=status,
        wall_seconds=wall,
        cpu_seconds=cpu,
        peak_memory_bytes=mem,
        started_at="2026-01-01T00:00:00+00:00",
        finished_at="2026-01-01T00:00:01+00:00",
        run_id=run_id,
    )


def test_profile_stage_records_wall_cpu_and_peak_memory():
    profiler = profile_stage("test.stage_basic", record=False)
    with profiler as stage:
        # Burn CPU and retain an allocation so neither cost is degenerate.
        data = [i * i for i in range(20000)]
        assert sum(data) > 0

    measurement = stage.measurement
    assert measurement.stage == "test.stage_basic"
    assert measurement.status == "success"
    assert measurement.wall_seconds > 0
    assert measurement.cpu_seconds > 0
    assert measurement.peak_memory_bytes > 0
    assert measurement.error is None
    assert measurement.run_id


def test_peak_memory_reports_the_stage_delta_not_the_process_total():
    with profile_stage("test.stage_peak_delta", record=False) as stage:
        retained = [i for i in range(100_000)]
        assert len(retained) == 100_000
    # A cheap stage must not inherit allocations made by earlier stages.
    with profile_stage("test.stage_peak_cheap", record=False) as cheap:
        pass
    assert stage.measurement.peak_memory_bytes >= 1_000_000
    assert cheap.measurement.peak_memory_bytes < 1_000_000


def test_profile_stage_retains_measurements_across_calls(tmp_path):
    log = tmp_path / "stage_costs.jsonl"

    with profile_stage("test.stage_retained", log_path=str(log)):
        pass
    with profile_stage("test.stage_retained", log_path=str(log)):
        pass

    measurements = load_measurements(str(log))
    assert len(measurements) == 2
    assert {m.stage for m in measurements} == {"test.stage_retained"}
    # Retention is append-only: every line is independently parseable.
    raw = log.read_text(encoding="utf-8").strip().split("\n")
    assert len(raw) == 2
    assert json.loads(raw[0])["stage"] == "test.stage_retained"


def test_profile_stage_records_failure_and_propagates(tmp_path):
    log = tmp_path / "stage_costs.jsonl"

    with pytest.raises(ValueError, match="boom"):
        with profile_stage("test.stage_failure", log_path=str(log)):
            raise ValueError("boom")

    measurements = load_measurements(str(log))
    assert len(measurements) == 1
    assert measurements[0].status == "failed"
    assert measurements[0].error == "boom"
    assert measurements[0].wall_seconds > 0


def test_profile_stage_exports_prometheus_metrics():
    stage = "test.stage_metrics"
    stage_labels = {"stage": stage}
    success_labels = {"stage": stage, "status": "success"}
    count_metric = "lumenpulse_pipeline_stage_runs_total"
    wall_metric = "lumenpulse_pipeline_stage_wall_seconds_count"
    cpu_metric = "lumenpulse_pipeline_stage_cpu_seconds_count"
    memory_metric = "lumenpulse_pipeline_stage_peak_memory_bytes_count"

    def sample(metric, labels):
        return REGISTRY.get_sample_value(metric, labels) or 0.0

    before_count = sample(count_metric, success_labels)
    before_wall = sample(wall_metric, stage_labels)
    before_cpu = sample(cpu_metric, stage_labels)
    before_mem = sample(memory_metric, stage_labels)

    with profile_stage(stage, record=False):
        pass

    assert sample(count_metric, success_labels) == before_count + 1.0
    assert sample(wall_metric, stage_labels) > before_wall
    assert sample(cpu_metric, stage_labels) > before_cpu
    assert sample(memory_metric, stage_labels) > before_mem


def test_profile_stage_works_as_a_decorator(tmp_path):
    log = tmp_path / "stage_costs.jsonl"

    @profile_stage("test.stage_decorated", log_path=str(log))
    def work(value):
        return value * 2

    assert work(21) == 42
    measurements = load_measurements(str(log))
    assert len(measurements) == 1
    assert measurements[0].status == "success"

    # Each decorated invocation must be recorded as its own measurement.
    work(1)
    assert len(load_measurements(str(log))) == 2


def test_profile_stage_nested_stages_are_recorded_separately(tmp_path):
    log = tmp_path / "stage_costs.jsonl"

    with profile_stage("test.stage_outer", log_path=str(log)):
        with profile_stage("test.stage_inner", log_path=str(log)):
            sum(range(5000))

    stages = {m.stage for m in load_measurements(str(log))}
    assert stages == {"test.stage_outer", "test.stage_inner"}


def test_default_log_path_follows_environment(monkeypatch):
    monkeypatch.setenv("STAGE_COST_LOG_PATH", "/tmp/custom_costs.jsonl")
    assert default_log_path() == "/tmp/custom_costs.jsonl"
    monkeypatch.delenv("STAGE_COST_LOG_PATH")
    monkeypatch.setenv("DATA_DIR", "/tmp/pipeline-data")
    assert default_log_path().endswith("stage_costs.jsonl")
    assert default_log_path().startswith("/tmp/pipeline-data")


def test_load_measurements_ignores_malformed_lines(tmp_path):
    log = tmp_path / "stage_costs.jsonl"
    log.write_text(
        json.dumps(_measurement("test.stage_ok").to_dict())
        + "\n"
        + "not json at all\n"
        + '{"stage": "missing_required"}\n',
        encoding="utf-8",
    )
    measurements = load_measurements(str(log))
    assert [m.stage for m in measurements] == ["test.stage_ok"]


def test_summarize_costs_returns_medians_and_ranks_by_cpu():
    measurements = [
        _measurement("test.stage_a", wall=2.0, cpu=1.0),
        _measurement("test.stage_a", wall=4.0, cpu=3.0),
        _measurement("test.stage_b", wall=9.0, cpu=8.0),
    ]

    summary = summarize_costs(measurements)
    assert summary["test.stage_a"]["runs"] == 2
    assert summary["test.stage_a"]["wall_seconds"] == 3.0
    assert summary["test.stage_a"]["cpu_seconds"] == 2.0
    assert summary["test.stage_b"]["runs"] == 1

    assert rank_stages(summary) == ["test.stage_b", "test.stage_a"]


def test_summarize_costs_last_n_limits_window():
    measurements = [
        _measurement("test.stage_window", wall=10.0, cpu=10.0, run_id="1"),
        _measurement("test.stage_window", wall=1.0, cpu=1.0, run_id="2"),
        _measurement("test.stage_window", wall=1.0, cpu=1.0, run_id="3"),
    ]
    summary = summarize_costs(measurements, last_n=1)
    assert summary["test.stage_window"]["runs"] == 1
    assert summary["test.stage_window"]["cpu_seconds"] == 1.0


def test_detect_regressions_flags_stage_above_threshold():
    measurements = [
        _measurement("test.stage_slow", wall=2.0, cpu=2.0, run_id="old"),
        _measurement("test.stage_slow", wall=4.0, cpu=4.0, run_id="new"),
        _measurement("test.stage_stable", wall=1.0, cpu=1.0, run_id="new"),
    ]
    baseline = {
        "test.stage_slow": {"cpu_seconds": 2.0, "wall_seconds": 2.0},
        "test.stage_stable": {"cpu_seconds": 1.0, "wall_seconds": 1.0},
    }

    regressions = detect_regressions(measurements, baseline, threshold=0.25)
    metrics = {(r["stage"], r["metric"]) for r in regressions}
    assert ("test.stage_slow", "cpu_seconds") in metrics
    assert ("test.stage_slow", "wall_seconds") in metrics
    assert ("test.stage_stable", "cpu_seconds") not in metrics
    for item in regressions:
        assert item["ratio"] > 1.25


def test_detect_regressions_ignores_stages_without_baseline():
    measurements = [_measurement("test.stage_unknown", wall=99.0, cpu=99.0)]
    assert detect_regressions(measurements, {"other": {"cpu_seconds": 0.1}}) == []


def test_baseline_round_trip(tmp_path):
    path = tmp_path / "stage_cost_baseline.json"
    summary = summarize_costs([_measurement("test.stage_base", wall=1.5, cpu=0.75)])

    write_baseline(str(path), summary)
    loaded = load_baseline(str(path))

    assert loaded["test.stage_base"]["cpu_seconds"] == 0.75
    assert loaded["test.stage_base"]["wall_seconds"] == 1.5
    assert load_baseline(str(tmp_path / "absent.json")) == {}


def test_every_known_stage_has_a_recommendation():
    for stage in RECOMMENDATIONS:
        assert recommendation_for(stage)
    assert "job-queue" in recommendation_for("job.daily_kpi_snapshot")
    assert "work function" in recommendation_for("job.retrain")
    assert recommendation_for("brand_new_stage")
