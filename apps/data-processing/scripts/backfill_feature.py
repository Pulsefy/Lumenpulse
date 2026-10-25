#!/usr/bin/env python3
"""Backfill a registered feature-store feature over a historical time range."""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime
from typing import Optional

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.db.postgres_service import PostgresService  # noqa: E402
from src.ml.feature_backfill import run_feature_backfill  # noqa: E402


def _parse_time(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise argparse.ArgumentTypeError(
            "Use an ISO-8601 timestamp, for example 2025-01-01T00:00:00Z"
        ) from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise argparse.ArgumentTypeError("Timestamp must include a timezone")
    return parsed


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Compute and persist historical feature values in resumable chunks."
    )
    parser.add_argument("--asset", required=True, help="Asset code, e.g. XLM")
    parser.add_argument("--feature", required=True, help="Registered feature name")
    parser.add_argument("--start", required=True, type=_parse_time)
    parser.add_argument("--end", required=True, type=_parse_time)
    parser.add_argument(
        "--chunk-days", type=int, default=7, help="Days to process per transaction."
    )
    parser.add_argument("--dsn", default=None, help="Optional DATABASE_URL override.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Estimate source rows and memory without writing feature values.",
    )
    args = parser.parse_args(argv)

    db = PostgresService(database_url=args.dsn) if args.dsn else PostgresService()
    try:
        with db.SessionLocal() as session:
            result = run_feature_backfill(
                session,
                asset=args.asset,
                feature=args.feature,
                start_time=args.start,
                end_time=args.end,
                chunk_days=args.chunk_days,
                dry_run=args.dry_run,
            )
            if args.dry_run:
                print(
                    f"[backfill] estimate: {result['source_rows']:,} source rows; "
                    f"at most {result['output_rows_upper_bound']:,} output rows; "
                    f"approximately {result['estimated_peak_memory_bytes']:,} "
                    "bytes of in-memory feature data."
                )
                return 0

            print(
                f"[backfill] complete: {result['rows_processed']:,} values; "
                f"{result['elapsed_seconds']:.3f}s; "
                f"{result['rows_per_second'] or 0:,.3f} rows/s; "
                f"run id {result['backfill_id']}."
            )
    finally:
        db.engine.dispose()
    return 0


if __name__ == "__main__":
    sys.exit(main())
