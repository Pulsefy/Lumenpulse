#!/usr/bin/env python3
"""Generate the committed anomaly-dataset snapshot used by the experiment CLI (#1459).

The output is a *committed* dataset (``data/experiments/anomaly_pump_and_dump_v1.json``):
it is the immutable input pinned by ``experiments/anomaly_pump_and_dump.json``
via ``data.path`` + ``data.sha256``.  Regenerating with this script must produce
byte-identical output (fixed seed, no timestamps), so a reviewer can verify the
snapshot instead of trusting it.

Usage
-----
    python scripts/generate_experiment_dataset.py            # print sha256
    python scripts/generate_experiment_dataset.py --write    # (re)write the file
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = APP_ROOT / "data" / "experiments" / "anomaly_pump_and_dump_v1.json"

SEED = 1234
ROWS = 240
EPISODES = 10
EPISODE_LEN = 3


def _uniforms(count: int) -> list:
    # Deterministic LCG so regeneration never drifts with library versions.
    state = SEED
    out = []
    for _ in range(count):
        state = (1103515245 * state + 12345) % (2 ** 31)
        out.append(state / (2 ** 31))
    return out


def _normal(u1: float, u2: float, mean: float, std: float) -> float:
    # Box-Muller, seeded -- keeps the generator free of a numpy dependency.
    u1 = max(u1, 1e-12)
    return mean + std * math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)


def build_records() -> list:
    draws = iter(_uniforms(ROWS * 4))
    records = []
    for index in range(ROWS):
        volume = round(_normal(next(draws), next(draws), 100.0, 10.0), 4)
        sentiment = round(min(max(_normal(next(draws), next(draws), 0.35, 0.07), -1.0), 1.0), 4)
        records.append(
            {"index": index, "volume": volume, "sentiment": sentiment, "label": "refuted"}
        )

    # Overlay pump-and-dump episodes: rising volume with euphoric sentiment.
    spacing = ROWS // EPISODES
    for episode in range(EPISODES):
        start = 4 + episode * spacing
        for step in range(EPISODE_LEN):
            row = records[start + step]
            row["volume"] = round(100.0 * (4.0 + 1.6 * step), 4)
            row["sentiment"] = round(0.7 + 0.12 * step, 4)
            row["label"] = "confirmed"

    return records


def render() -> str:
    payload = {
        "dataset": "anomaly_pump_and_dump",
        "version": 1,
        "snapshot_ref": "anomaly-pump-and-dump/v1",
        "description": (
            "Synthetic volume/sentiment series with labelled pump-and-dump "
            "episodes. Generated once from a fixed seed and committed as an "
            "immutable experiment snapshot."
        ),
        "generator": "scripts/generate_experiment_dataset.py",
        "seed": SEED,
        "records": build_records(),
    }
    return json.dumps(payload, indent=2, sort_keys=True) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="write the snapshot file")
    args = parser.parse_args()

    text = render()
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()

    if args.write:
        OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        with OUTPUT_PATH.open("w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
        print(f"wrote {OUTPUT_PATH} ({len(json.loads(text)['records'])} records)")

    # Matches resolve_snapshot(), which hashes line-ending-normalised bytes so
    # a CRLF checkout on Windows pins to the same sha256.
    print(f"sha256: {digest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
