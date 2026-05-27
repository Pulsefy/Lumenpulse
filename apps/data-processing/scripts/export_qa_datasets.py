#!/usr/bin/env python3
"""
Export QA datasets (events, views, KPIs) for a Stellar ledger range.

Usage:
    python scripts/export_qa_datasets.py --start-ledger 1000 --end-ledger 2000
    python scripts/export_qa_datasets.py --start-ledger 1000 --end-ledger 2000 --output-dir /tmp/qa_export
    python scripts/export_qa_datasets.py --start-ledger 1000 --end-ledger 2000 --datasets events kpis
"""

import argparse
import json
import logging
import sys
import os
from pathlib import Path

# Allow running from repo root or scripts/ directory
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)


def parse_args():
    parser = argparse.ArgumentParser(description="Export QA datasets for a ledger range")
    parser.add_argument("--start-ledger", type=int, required=True, help="First ledger (inclusive)")
    parser.add_argument("--end-ledger", type=int, required=True, help="Last ledger (inclusive)")
    parser.add_argument(
        "--output-dir",
        default="exports/qa",
        help="Directory to write JSON files (default: exports/qa)",
    )
    parser.add_argument(
        "--datasets",
        nargs="+",
        choices=["events", "views", "kpis"],
        default=["events", "views", "kpis"],
        help="Which datasets to export (default: all)",
    )
    parser.add_argument("--database-url", default=None, help="Override DATABASE_URL env var")
    return parser.parse_args()


def main():
    args = parse_args()

    if args.start_ledger > args.end_ledger:
        logger.error("--start-ledger must be <= --end-ledger")
        sys.exit(1)

    from src.qa_exporter import QAExporter

    exporter = QAExporter(
        start_ledger=args.start_ledger,
        end_ledger=args.end_ledger,
        output_dir=args.output_dir,
        database_url=args.database_url,
    )

    dispatch = {
        "events": exporter.export_events,
        "views": exporter.export_views,
        "kpis": exporter.export_kpis,
    }

    results = []
    for dataset in args.datasets:
        result = dispatch[dataset]()
        results.append(result.to_dict())

    summary = {
        "status": "completed",
        "start_ledger": args.start_ledger,
        "end_ledger": args.end_ledger,
        "exports": results,
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
