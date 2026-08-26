#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/label_examples.py
=========================
CLI tool for submitting and correcting human-labelled sentiment examples.

Usage examples
--------------
# Add a new labelled example
python scripts/label_examples.py add \
    --text "Bitcoin surges to new ATH" \
    --label positive \
    --labeller alice

# Correct an existing label
python scripts/label_examples.py correct \
    --id 00000001-0000-4000-8000-000000000001 \
    --label neutral \
    --labeller bob \
    --notes "actually flat, not positive"

# Delete an example
python scripts/label_examples.py delete \
    --id 00000001-0000-4000-8000-000000000001

# List all examples (optionally filter by split or label)
python scripts/label_examples.py list
python scripts/label_examples.py list --split eval
python scripts/label_examples.py list --label negative

# Show class balance report
python scripts/label_examples.py stats

# Export all examples as CSV
python scripts/label_examples.py export --output /tmp/labelled_examples.csv

Environment variables
---------------------
LABELLED_EXAMPLES_PATH  — override the default JSONL path
                          (default: data/labelled_examples.jsonl)
"""

import argparse
import csv
import os
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Bootstrap path so the script can be run from anywhere inside the repo
# ---------------------------------------------------------------------------
_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT))

from src.ml.labelled_example_store import LabelledExampleStore, VALID_LABELS, VALID_SPLITS

# ---------------------------------------------------------------------------
# Default store path (can be overridden via env var)
# ---------------------------------------------------------------------------
_DEFAULT_PATH = os.environ.get(
    "LABELLED_EXAMPLES_PATH",
    str(_ROOT / "data" / "labelled_examples.jsonl"),
)


# ---------------------------------------------------------------------------
# Sub-command handlers
# ---------------------------------------------------------------------------


def cmd_add(args: argparse.Namespace, store: LabelledExampleStore) -> None:
    eid = store.add(
        text=args.text,
        label=args.label,
        labeller=args.labeller,
        split=args.split,
        notes=args.notes or "",
    )
    print(f"Added example  id={eid}  label={args.label}  split={store.get(eid)['split']}")


def cmd_correct(args: argparse.Namespace, store: LabelledExampleStore) -> None:
    try:
        store.correct(
            example_id=args.id,
            new_label=args.label,
            labeller=args.labeller,
            notes=args.notes or "",
        )
        row = store.get(args.id)
        print(f"Updated example  id={args.id}  new_label={row['label']}  labeller={row['labeller']}")
    except KeyError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)


def cmd_delete(args: argparse.Namespace, store: LabelledExampleStore) -> None:
    try:
        store.delete(args.id)
        print(f"Deleted example  id={args.id}")
    except KeyError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)


def cmd_list(args: argparse.Namespace, store: LabelledExampleStore) -> None:
    rows = store.list_all()

    if args.split:
        rows = [r for r in rows if r.get("split") == args.split]
    if args.label:
        rows = [r for r in rows if r.get("label") == args.label]

    if not rows:
        print("No examples found matching the given filters.")
        return

    header = f"{'ID':<38}  {'LABEL':<10}  {'SPLIT':<6}  {'LABELLER':<16}  TEXT"
    print(header)
    print("-" * (len(header) + 20))
    for r in rows:
        text_preview = r["text"][:60] + ("…" if len(r["text"]) > 60 else "")
        print(f"{r['id']:<38}  {r['label']:<10}  {r['split']:<6}  {r['labeller']:<16}  {text_preview}")
    print(f"\nTotal: {len(rows)} example(s)")


def cmd_stats(args: argparse.Namespace, store: LabelledExampleStore) -> None:
    counts = store.class_counts()
    total = sum(counts.values())
    train_df, eval_df = store.get_split()

    print(f"{'='*40}")
    print(f"  Labelled Example Store Statistics")
    print(f"{'='*40}")
    print(f"  Total examples : {total}")
    print(f"  Train split    : {len(train_df)}")
    print(f"  Eval split     : {len(eval_df)}")
    print(f"{'─'*40}")
    for label, count in sorted(counts.items()):
        pct = (count / total * 100) if total else 0.0
        print(f"  {label:<12}  {count:>5}  ({pct:5.1f}%)")
    print(f"{'='*40}")


def cmd_export(args: argparse.Namespace, store: LabelledExampleStore) -> None:
    output_path = Path(args.output)
    df = store.to_dataframe()
    df.to_csv(output_path, index=False, quoting=csv.QUOTE_ALL)
    print(f"Exported {len(df)} example(s) to {output_path}")


# ---------------------------------------------------------------------------
# Argument parser
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="label_examples.py",
        description="Manage the human-labelled sentiment example store.",
    )
    parser.add_argument(
        "--store",
        default=_DEFAULT_PATH,
        metavar="PATH",
        help="Path to the JSONL example store (default: %(default)s)",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # ── add ────────────────────────────────────────────────────────────────
    p_add = sub.add_parser("add", help="Add a new labelled example")
    p_add.add_argument("--text", required=True, help="Raw input text to label")
    p_add.add_argument(
        "--label",
        required=True,
        choices=sorted(VALID_LABELS),
        help="Sentiment label",
    )
    p_add.add_argument("--labeller", default="cli-user", help="Name of the labeller")
    p_add.add_argument(
        "--split",
        choices=sorted(VALID_SPLITS),
        default=None,
        help="Force train or eval split (auto-assigned if omitted)",
    )
    p_add.add_argument("--notes", default="", help="Optional annotation notes")

    # ── correct ────────────────────────────────────────────────────────────
    p_correct = sub.add_parser("correct", help="Correct the label on an existing example")
    p_correct.add_argument("--id", required=True, help="Example UUID to correct")
    p_correct.add_argument(
        "--label",
        required=True,
        choices=sorted(VALID_LABELS),
        help="New sentiment label",
    )
    p_correct.add_argument("--labeller", default="cli-user", help="Name of the corrector")
    p_correct.add_argument("--notes", default="", help="Optional reason for correction")

    # ── delete ─────────────────────────────────────────────────────────────
    p_delete = sub.add_parser("delete", help="Delete an example from the store")
    p_delete.add_argument("--id", required=True, help="Example UUID to delete")

    # ── list ───────────────────────────────────────────────────────────────
    p_list = sub.add_parser("list", help="List stored examples")
    p_list.add_argument("--split", choices=sorted(VALID_SPLITS), help="Filter by split")
    p_list.add_argument("--label", choices=sorted(VALID_LABELS), help="Filter by label")

    # ── stats ──────────────────────────────────────────────────────────────
    sub.add_parser("stats", help="Show class balance and split statistics")

    # ── export ─────────────────────────────────────────────────────────────
    p_export = sub.add_parser("export", help="Export all examples to CSV")
    p_export.add_argument(
        "--output",
        default="labelled_examples_export.csv",
        help="Output CSV file path (default: %(default)s)",
    )

    return parser


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    store = LabelledExampleStore(args.store)
    dispatch = {
        "add": cmd_add,
        "correct": cmd_correct,
        "delete": cmd_delete,
        "list": cmd_list,
        "stats": cmd_stats,
        "export": cmd_export,
    }
    dispatch[args.command](args, store)


if __name__ == "__main__":
    main()
