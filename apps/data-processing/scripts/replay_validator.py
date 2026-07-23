#!/usr/bin/env python3
"""Replay historical JSON/JSONL records through two transforms."""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.replay_validator import import_transform, identity, load_records, replay, select_records


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Replay historical records and compare transforms")
    parser.add_argument("--input", required=True, help="JSON array or JSONL historical records")
    parser.add_argument("--limit", type=int, help="Maximum records to replay")
    parser.add_argument("--start-ledger", type=int, help="First ledger, inclusive")
    parser.add_argument("--end-ledger", type=int, help="Last ledger, inclusive")
    parser.add_argument("--old-transform", help="Old transform as module:function")
    parser.add_argument("--new-transform", help="New transform as module:function")
    parser.add_argument("--output", help="Optional report path; stdout is always written")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.limit is not None and args.limit < 1:
        raise SystemExit("--limit must be greater than zero")
    if args.start_ledger is not None and args.end_ledger is not None and args.start_ledger > args.end_ledger:
        raise SystemExit("--start-ledger must be <= --end-ledger")

    records = select_records(
        load_records(args.input), args.limit, args.start_ledger, args.end_ledger
    )
    old_transform = import_transform(args.old_transform) if args.old_transform else identity
    new_transform = import_transform(args.new_transform) if args.new_transform else identity
    report = replay(records, old_transform, new_transform)
    rendered = json.dumps(report, indent=2, sort_keys=True)
    print(rendered)
    if args.output:
        Path(args.output).write_text(rendered + "\n", encoding="utf-8")
    return 1 if report["status"] != "match" else 0


if __name__ == "__main__":
    raise SystemExit(main())