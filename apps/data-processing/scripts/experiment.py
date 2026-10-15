#!/usr/bin/env python3
"""Reproducible experiment CLI (issue #1459).

Runs a committed experiment configuration end to end -- snapshot, training,
evaluation, registry entry, model card and evaluation result -- instead of the
ad hoc ``demo_*.py`` scripts it replaces.

Usage
-----
    python scripts/experiment.py list
    python scripts/experiment.py run experiments/anomaly_pump_and_dump.json
    python scripts/experiment.py run experiments/anomaly_pump_and_dump.json --fail-on-gate
    python scripts/experiment.py run experiments/anomaly_pump_and_dump.json --json

See ``docs/experiment-cli.md`` for a worked end-to-end example.

Exit codes
----------
0  run completed (and the evaluation gate passed with --fail-on-gate)
1  the run failed
2  the configuration or the pinned snapshot is invalid
3  the evaluation gate failed (--fail-on-gate only)
"""

from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.ml.experiment import (  # noqa: E402
    ExperimentConfigError,
    ExperimentError,
    SnapshotIntegrityError,
    list_configs,
    run_experiment,
)

EXAMPLE = """\
examples:
  python scripts/experiment.py list
  python scripts/experiment.py run experiments/anomaly_pump_and_dump.json
  python scripts/experiment.py run experiments/anomaly_pump_and_dump.json --fail-on-gate
"""


def _print_summary(manifest: dict) -> None:
    registry = manifest["registry"]
    evaluation = manifest["evaluation"]
    gate = evaluation["gate"]
    metrics = evaluation["metrics"]

    print(f"run           {manifest['run_id']}")
    print(f"snapshot      {manifest['snapshot']['snapshot_ref']} ({manifest['snapshot']['sha256'][:12]}…)")
    print(
        f"split         {manifest['split']['train_rows']} train / "
        f"{manifest['split']['evaluation_rows']} evaluation rows"
    )
    print(f"registry      {registry['model_type']}@{registry['version']}")
    print(f"model card    {registry['card_path']}")
    reported = " ".join(
        f"{key}={metrics[key]:.4f}"
        for key in ("precision", "recall", "accuracy")
        if isinstance(metrics.get(key), (int, float))
    )
    print(f"metrics       {gate['metric']}={gate['value']:.4f}  {reported}".rstrip())
    if gate["threshold"] is None:
        print("gate          (no threshold configured)")
    else:
        print(
            f"gate          {gate['metric']} {gate['direction']} {gate['threshold']}: "
            f"{'PASS' if gate['passed'] else 'FAIL'}"
        )
    print(f"artefacts     {manifest['run_dir']}")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        prog="experiment",
        description="Run a reproducible model experiment from a committed config file.",
        epilog=EXAMPLE,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    subparsers = parser.add_subparsers(dest="command")

    run_parser = subparsers.add_parser("run", help="run an experiment from a config file")
    run_parser.add_argument("config", help="path to a committed experiment config (JSON)")
    run_parser.add_argument("--runs-dir", default=None, help="where run artefacts are written")
    run_parser.add_argument(
        "--fail-on-gate",
        action="store_true",
        help="exit 3 when the evaluation gate fails (default: report only)",
    )
    run_parser.add_argument(
        "--json", action="store_true", dest="as_json", help="print the run manifest as JSON"
    )

    subparsers.add_parser("list", help="list committed experiment configs")

    args = parser.parse_args(argv)
    if args.command is None:
        parser.print_help()
        return 2

    if args.command == "list":
        configs = list_configs()
        if not configs:
            print("no experiment configs found (expected experiments/*.json)")
            return 0
        for path in configs:
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                raw = {}
            name = raw.get("name", path.stem)
            model_type = raw.get("model_type", "?")
            description = raw.get("description", "")
            print(f"{path.name:40} {name} ({model_type})")
            if description:
                print(f"{'':40} {description}")
        return 0

    try:
        if args.as_json:
            # Keep stdout machine-readable: the experiment loggers would
            # otherwise interleave with the manifest JSON.
            import logging

            logging.disable(logging.INFO)
        manifest = run_experiment(args.config, runs_dir=args.runs_dir)
    except SnapshotIntegrityError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except ExperimentConfigError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except ExperimentError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    if args.as_json:
        print(json.dumps(manifest, indent=2, sort_keys=True, default=str))
    else:
        _print_summary(manifest)

    if args.fail_on_gate and not manifest["evaluation"]["gate"]["passed"]:
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
