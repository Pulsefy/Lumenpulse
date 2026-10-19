#!/usr/bin/env python3
"""Measure confidence calibration per model and write the committed curves.

Usage
-----
    python scripts/build_calibration.py            # print a summary
    python scripts/build_calibration.py --write    # (re)write models/calibration/*.json

Inputs are the committed ground-truth sets and the generation is deterministic,
so re-running on an unchanged repo yields byte-identical files.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP_ROOT))

from src.ml.calibration import CALIBRATION_DIR, fit_calibration  # noqa: E402
from src.ml.calibration_data import build_all  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="write the JSON files")
    args = parser.parse_args()

    for model, spec in build_all().items():
        confidences, outcomes = spec["data"]
        report = fit_calibration(
            model,
            confidences,
            outcomes,
            dataset=spec["dataset"],
            raw_field=spec["raw_field"],
            notes=spec["notes"],
        )
        print(
            f"{model:10s} n={report['n_samples']:4d} acc={report['accuracy']:.3f} "
            f"ECE {report['before']['ece']:.3f} -> "
            f"{report['after']['ece_in_sample']:.3f} "
            f"(held-out {report['after']['ece_held_out']}) "
            f"method={report['method']} reliable={report['reliable']}"
        )
        if args.write:
            CALIBRATION_DIR.mkdir(parents=True, exist_ok=True)
            path = CALIBRATION_DIR / f"{model}.json"
            path.write_text(
                json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
            )
            print(f"  wrote {path.relative_to(APP_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
