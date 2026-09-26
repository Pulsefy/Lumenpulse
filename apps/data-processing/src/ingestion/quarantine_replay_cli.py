"""
quarantine_replay_cli.py

CLI entry point for replaying quarantined ingestion payloads (issue #1453).

Usage::

    python -m src.ingestion.quarantine_replay_cli [options]

Options
-------
--since ISO8601      Replay entries quarantined at or after this timestamp (inclusive).
--until ISO8601      Replay entries quarantined at or before this timestamp (inclusive).
--source NAME        Only replay entries produced by this ingestion source.
--dry-run            Report what would be replayed without writing anything.
--limit N            Cap the number of entries processed in this run.
--quarantine-path P  Override the quarantine log path.
--sink-path P        Override the idempotent replay sink path.

Exit codes
----------
0  run completed (payloads that still fail remain quarantined by design)
1  unexpected error (I/O failure, crash)
2  invalid arguments
"""

from __future__ import annotations

import argparse
import logging
import sys
from typing import List, Optional

from src.ingestion.payload_quarantine import QuarantineStore
from src.ingestion.quarantine_replay import (
    QuarantineReplayService,
    ReplaySink,
    parse_iso8601,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="quarantine_replay",
        description=(
            "Replay quarantined ingestion payloads through the current validator."
        ),
    )
    parser.add_argument(
        "--since",
        default=None,
        metavar="ISO8601",
        help="Only replay entries quarantined at or after this timestamp (inclusive)",
    )
    parser.add_argument(
        "--until",
        default=None,
        metavar="ISO8601",
        help="Only replay entries quarantined at or before this timestamp (inclusive)",
    )
    parser.add_argument(
        "--source",
        default=None,
        help="Only replay entries produced by this ingestion source, e.g. news_fetcher",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would be replayed without writing anything",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Maximum number of entries to process in this run",
    )
    parser.add_argument(
        "--quarantine-path",
        default=None,
        help="Override the quarantine log path",
    )
    parser.add_argument(
        "--sink-path",
        default=None,
        help="Override the idempotent replay sink path",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable debug logging",
    )
    return parser


def _print_summary(summary: dict) -> None:
    mode = " (dry run)" if summary["dry_run"] else ""
    print(f"=== Quarantine Replay Summary{mode} ===")
    print(f"scanned: {summary['scanned']}")
    print(f"replayed: {summary['replayed']}")
    print(f"still failing: {summary['still_failing']}")
    print(f"errors: {summary['errors']}")
    print(f"skipped (already replayed): {summary['skipped']}")
    for detail in summary["details"]:
        line = f"- {detail['quarantine_id']}: {detail['outcome']}"
        if detail.get("detail"):
            line += f" | {detail['detail']}"
        print(line)


def main(argv: Optional[List[str]] = None) -> int:
    """Run the quarantine replay CLI and return a process exit code."""
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.limit is not None and args.limit < 0:
        print("error: --limit must be >= 0", file=sys.stderr)
        return 2

    for flag in ("since", "until"):
        raw = getattr(args, flag)
        if raw is None:
            continue
        try:
            parse_iso8601(raw)
        except ValueError:
            print(
                f"error: --{flag} must be an ISO-8601 timestamp, got {raw!r}",
                file=sys.stderr,
            )
            return 2

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    try:
        store = QuarantineStore(quarantine_path=args.quarantine_path)
        sink = ReplaySink(sink_path=args.sink_path)
        service = QuarantineReplayService(store=store, sink=sink)
        summary = service.replay(
            since=args.since,
            until=args.until,
            source=args.source,
            limit=args.limit,
            dry_run=args.dry_run,
        )
    except Exception as exc:
        logging.getLogger(__name__).error("Quarantine replay failed: %s", exc)
        print(f"error: replay failed: {exc}", file=sys.stderr)
        return 1

    _print_summary(summary)
    return 0


if __name__ == "__main__":
    sys.exit(main())
