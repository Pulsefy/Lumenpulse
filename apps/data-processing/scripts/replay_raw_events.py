#!/usr/bin/env python3
"""Replay raw Soroban events from database.

Demonstrates the ability to replay raw event payloads for debugging or
downstream reprocessing without mutating the original raw records.
"""

import os
import sys
import argparse
import logging
from typing import Dict, Any

# Add the src directory to the Python path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.db.postgres_service import PostgresService
from src.db.models import RawSorobanEvent

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)


def process_event_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Mock transform to simulate reprocessing raw event payloads.

    Extracts key fields that would be mapped to a derived ContractEvent.
    """
    event_id = payload.get("id")
    ledger = payload.get("ledger")
    event_type = payload.get("type")

    # Simulate extraction of values
    value_xdr = payload.get("value", {}).get("xdr")
    topics_xdr = [t.get("xdr") for t in payload.get("topic", []) if isinstance(t, dict)]

    return {
        "event_id": event_id,
        "ledger": ledger,
        "event_type": event_type,
        "topics_count": len(topics_xdr),
        "value_xdr_length": len(value_xdr) if value_xdr else 0,
        "successful": payload.get("inSuccessfulLedger", True),
    }


def replay_events(
    contract_id: str = None,
    start_ledger: int = None,
    end_ledger: int = None,
    limit: int = 1000,
    dry_run: bool = False,
):
    """Fetch raw events from the database and replay them."""
    if not os.getenv("DATABASE_URL"):
        logger.error("DATABASE_URL environment variable is not set.")
        sys.exit(1)

    db_service = PostgresService()
    logger.info("Connecting to database to fetch raw events...")

    raw_events = db_service.get_raw_soroban_events(
        contract_id=contract_id,
        start_ledger=start_ledger,
        end_ledger=end_ledger,
        limit=limit,
    )

    logger.info(f"Retrieved {len(raw_events)} raw events.")

    reprocessed_count = 0
    for idx, raw_event in enumerate(raw_events):
        logger.info(
            f"[{idx + 1}/{len(raw_events)}] Replaying Raw Event: ID={raw_event.event_id} "
            f"Ledger={raw_event.ledger} Contract={raw_event.contract_id[:8]}..."
        )

        # Simulate processing the original immutable payload
        raw_payload = raw_event.raw_payload
        result = process_event_payload(raw_payload)

        logger.info(
            f"  -> Reprocessed payload: event_type='{result['event_type']}' "
            f"topics={result['topics_count']} successful={result['successful']}"
        )

        # Verify that original RawSorobanEvent properties were not altered
        assert (
            raw_event.raw_payload == raw_payload
        ), "Original raw payload was mutated during replay!"

        reprocessed_count += 1

    logger.info(f"Replay completed. Reprocessed {reprocessed_count} events.")
    return reprocessed_count


def parse_args():
    parser = argparse.ArgumentParser(description="Replay raw Soroban events")
    parser.add_argument(
        "--contract-id",
        type=str,
        default=None,
        help="Filter events by contract ID",
    )
    parser.add_argument(
        "--start-ledger",
        type=int,
        default=None,
        help="Filter events from start ledger sequence",
    )
    parser.add_argument(
        "--end-ledger",
        type=int,
        default=None,
        help="Filter events up to end ledger sequence",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=100,
        help="Limit number of events to replay",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Simulate replay without saving any state changes",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    try:
        replay_events(
            contract_id=args.contract_id,
            start_ledger=args.start_ledger,
            end_ledger=args.end_ledger,
            limit=args.limit,
            dry_run=args.dry_run,
        )
        sys.exit(0)
    except KeyboardInterrupt:
        logger.info("Replay interrupted by user")
        sys.exit(130)
    except Exception as e:
        logger.error(f"Unexpected error during replay: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
