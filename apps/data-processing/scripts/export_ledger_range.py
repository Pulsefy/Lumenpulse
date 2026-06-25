#!/usr/bin/env python3
"""
Export raw and normalized ledger data for incident debugging — Issue #883.

Usage:
    python scripts/export_ledger_range.py --start-ledger 1000 --end-ledger 2000
    python scripts/export_ledger_range.py --start-ledger 1000 --end-ledger 2000 \
        --output-dir /tmp/incident_exports
    python scripts/export_ledger_range.py --start-ledger 500 --end-ledger 500
"""

import argparse
import json
import logging
import sys
from pathlib import Path

# Allow running from repo root or scripts/ directory
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export ledger-range data (raw events + normalized state) for incident debugging"
    )
    parser.add_argument(
        "--start-ledger", type=int, required=True, help="First ledger (inclusive)"
    )
    parser.add_argument(
        "--end-ledger", type=int, required=True, help="Last ledger (inclusive)"
    )
    parser.add_argument(
        "--output-dir",
        default="exports/ledger",
        help="Directory to write the export file (default: exports/ledger)",
    )
    parser.add_argument(
        "--database-url", default=None, help="Override DATABASE_URL env var"
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    from src.ledger_export import LedgerRangeExporter, _validate_ledger_range

    try:
        _validate_ledger_range(args.start_ledger, args.end_ledger)
    except (TypeError, ValueError) as exc:
        logger.error("Invalid ledger range: %s", exc)
        sys.exit(1)

    exporter = LedgerRangeExporter(
        start_ledger=args.start_ledger,
        end_ledger=args.end_ledger,
        output_dir=args.output_dir,
        database_url=args.database_url,
    )

    result = exporter.export()
    print(json.dumps(result.to_dict(), indent=2))


if __name__ == "__main__":
    main()
