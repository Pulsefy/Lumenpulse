#!/usr/bin/env python3
"""Report and gate on per-pipeline-stage compute cost (#1454).

Reads the cost log written by ``src.observability.stage_profiler`` (JSONL, one
measurement per profiled stage run, retained across process restarts), prints a
per-stage summary, names the most expensive stages with a tuning recommendation
for each, and detects a regression against a recorded baseline.

Usage (from apps/data-processing/):
    # Rank the most expensive stages
    python scripts/report_stage_costs.py --top 3

    # Fail when a stage got slower than the committed baseline
    python scripts/report_stage_costs.py --check

    # Record a new baseline from the current log
    python scripts/report_stage_costs.py --write-baseline

Exit codes:
    0 = report produced (and, with --check, no regression detected)
    1 = a regression was detected with --check, or the baseline is missing
"""

import argparse
import json
import sys
from pathlib import Path
from typing import List

# Ensure the project root (apps/data-processing) is on sys.path so that
# ``src.*`` imports resolve correctly regardless of the working directory.
_PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from src.observability.stage_profiler import (  # noqa: E402
    detect_regressions,
    default_log_path,
    load_baseline,
    load_measurements,
    rank_stages,
    recommendation_for,
    summarize_costs,
    write_baseline,
)

DEFAULT_BASELINE = _PROJECT_ROOT / "stage_cost_baseline.json"


def _format_seconds(value: float) -> str:
    if value >= 10:
        return f"{value:,.1f}s"
    if value >= 1:
        return f"{value:.3f}s"
    return f"{value * 1000:.1f}ms"


def _format_bytes(value: float) -> str:
    size = float(value)
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{size:.1f} {unit}" if unit != "B" else f"{size:.0f} B"
        size /= 1024
    return f"{size:.1f} GB"


def _top_stages(
    summary: dict, top_n: int
) -> List[dict]:
    ranked = rank_stages(summary)
    return [
        {
            "rank": index + 1,
            "stage": stage,
            **summary[stage],
            "recommendation": recommendation_for(stage),
        }
        for index, stage in enumerate(ranked[:top_n])
    ]


def build_report(args: argparse.Namespace) -> dict:
    measurements = load_measurements(args.log)
    summary = summarize_costs(measurements, last_n=args.last_n)
    top = _top_stages(summary, args.top)
    baseline = load_baseline(args.baseline)
    regressions = detect_regressions(
        measurements, baseline, threshold=args.threshold / 100.0
    )
    return {
        "log": args.log,
        "measurements": len(measurements),
        "summary": summary,
        "top": top,
        "regressions": regressions,
        "threshold_percent": args.threshold,
        "baseline": str(args.baseline) if baseline else None,
    }


def render(report: dict) -> str:
    lines: List[str] = []
    lines.append("Pipeline stage cost report")
    lines.append(f"Log: {report['log']} ({report['measurements']} measurements)")

    if not report["summary"]:
        lines.append("")
        lines.append(
            "No measurements yet: run a pipeline stage that uses "
            "src.observability.stage_profiler first."
        )
        return "\n".join(lines)

    lines.append("")
    header = f"{'stage':<40} {'runs':>6} {'wall':>10} {'cpu':>10} {'peak mem':>12}"
    lines.append(header)
    lines.append("-" * len(header))
    ordered = sorted(
        report["summary"].items(),
        key=lambda item: item[1]["wall_seconds"],
        reverse=True,
    )
    for stage, values in ordered:
        lines.append(
            f"{stage:<40} {int(values['runs']):>6} "
            f"{_format_seconds(values['wall_seconds']):>10} "
            f"{_format_seconds(values['cpu_seconds']):>10} "
            f"{_format_bytes(values['peak_memory_bytes']):>12}"
        )

    lines.append("")
    lines.append(f"Top {len(report['top'])} most expensive stages (by median CPU):")
    for entry in report["top"]:
        lines.append(
            f"  {entry['rank']}. {entry['stage']} — "
            f"{_format_seconds(entry['cpu_seconds'])} cpu, "
            f"{_format_seconds(entry['wall_seconds'])} wall, "
            f"{_format_bytes(entry['peak_memory_bytes'])} peak"
        )
        lines.append(f"     Recommendation: {entry['recommendation']}")

    lines.append("")
    lines.append(
        f"Regression check (threshold {report['threshold_percent']}% vs "
        f"{report['baseline'] or 'no baseline'})"
    )
    if not report["baseline"]:
        lines.append("  Baseline missing: run with --write-baseline to record one.")
    elif report["regressions"]:
        for item in report["regressions"]:
            lines.append(
                f"  REGRESSION {item['stage']}.{item['metric']}: "
                f"baseline {_format_seconds(item['baseline'])} -> "
                f"latest {_format_seconds(item['latest'])} "
                f"({item['ratio']:.2f}x)"
            )
    else:
        lines.append("  OK: no stage exceeded its baseline.")

    return "\n".join(lines)


def main(argv: List[str] = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--log", default=default_log_path(), help="Cost log (JSONL) to read"
    )
    parser.add_argument(
        "--baseline",
        default=str(DEFAULT_BASELINE),
        help="Baseline JSON used for regression detection",
    )
    parser.add_argument(
        "--top", type=int, default=3, help="Number of expensive stages to report"
    )
    parser.add_argument(
        "--last-n",
        type=int,
        default=0,
        dest="last_n",
        help="Aggregate only the last N runs per stage (0 = all runs)",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=25.0,
        help="Regression threshold as a percentage above the baseline",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Exit 1 when a stage regressed against the baseline",
    )
    parser.add_argument(
        "--write-baseline",
        action="store_true",
        dest="write_baseline",
        help="Write the current summary to the baseline file",
    )
    parser.add_argument("--json", action="store_true", help="Emit JSON instead of text")
    args = parser.parse_args(argv)

    report = build_report(args)

    if args.write_baseline:
        if not report["summary"]:
            print("Nothing to record: the cost log is empty.", file=sys.stderr)
            return 1
        write_baseline(args.baseline, report["summary"])
        stage_count = len(report["summary"])
        print(f"Wrote baseline for {stage_count} stage(s) to {args.baseline}")

    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print(render(report))

    if args.check:
        if not report["baseline"]:
            print("No baseline recorded; cannot gate on regressions.", file=sys.stderr)
            return 1
        if report["regressions"]:
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
