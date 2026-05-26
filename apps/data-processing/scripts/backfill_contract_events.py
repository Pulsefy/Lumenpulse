#!/usr/bin/env python3
"""
Soroban Contract Event Backfill Script

Fetches events for specific Soroban contract IDs within a given ledger range.
Saves results idempotently to allow safe re-runs.

Usage:
    python scripts/backfill_contract_events.py --contract-ids CABC... --start-ledger 1000 --end-ledger 2000
"""

import os
import sys
import json
import time
import argparse
import logging
from datetime import datetime, timezone
from pathlib import Path
import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)

class BackfillContractEvents:
    def __init__(self, contract_ids, start_ledger, end_ledger, output_dir, rpc_url, batch_size, dry_run=False):
        self.contract_ids = contract_ids
        self.start_ledger = start_ledger
        self.end_ledger = end_ledger
        self.output_dir = Path(output_dir)
        self.rpc_url = rpc_url
        self.batch_size = batch_size
        self.dry_run = dry_run
        
        if not self.dry_run:
            self.output_dir.mkdir(parents=True, exist_ok=True)

    def _get_output_filepath(self, contract_id, batch_start, batch_end):
        return self.output_dir / f"{contract_id}_{batch_start}_{batch_end}.json"

    def _is_already_processed(self, filepath):
        if filepath.exists():
            try:
                with open(filepath, 'r') as f:
                    data = json.load(f)
                    if data.get("status") == "completed":
                        return True
            except json.JSONDecodeError:
                pass
        return False

    def fetch_events_batch(self, contract_id, batch_start, batch_end):
        """Fetch a batch of events from Soroban RPC"""
        all_events = []
        cursor = None

        while True:
            payload = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "getEvents",
                "params": {
                    "startLedger": batch_start,
                    "filters": [
                        {
                            "type": "contract",
                            "contractIds": [contract_id]
                        }
                    ],
                    "pagination": {
                        "limit": 100
                    }
                }
            }
            if cursor:
                payload["params"]["pagination"]["cursor"] = cursor

            try:
                response = requests.post(self.rpc_url, json=payload, timeout=30)
                response.raise_for_status()
                data = response.json()
            except Exception as e:
                logger.error(f"RPC Request failed: {e}")
                raise

            if "error" in data:
                logger.error(f"RPC Error: {data['error']}")
                raise RuntimeError(f"RPC Error: {data['error']}")

            events = data.get("result", {}).get("events", [])
            
            # Filter events by ledger <= batch_end
            valid_events = []
            for event in events:
                ledger = int(event.get("ledger", 0))
                if ledger <= batch_end:
                    valid_events.append(event)
            
            all_events.extend(valid_events)

            # Check if we need to paginate
            # We break if we received fewer events than the limit, or if the latest event exceeds batch_end
            if len(events) < 100:
                break
                
            last_ledger = int(events[-1].get("ledger", 0))
            if last_ledger > batch_end:
                break

            cursor = data.get("result", {}).get("latestLedger") # fallback
            # Usually getEvents cursor is based on the paging token of the last event
            if events:
                cursor = events[-1].get("pagingToken")
            
            if not cursor:
                break

            time.sleep(0.5) # Rate limiting

        return all_events

    def run(self):
        logger.info("=" * 60)
        logger.info("SOROBAN CONTRACT EVENT BACKFILL")
        logger.info("=" * 60)
        logger.info(f"Target RPC: {self.rpc_url}")
        logger.info(f"Ledger Range: {self.start_ledger} to {self.end_ledger}")
        logger.info(f"Contracts: {len(self.contract_ids)}")
        logger.info(f"Batch Size: {self.batch_size}")
        
        stats = {
            "total_events": 0,
            "contracts": {},
            "batches_processed": 0,
            "batches_skipped": 0,
            "batches_failed": 0
        }

        for contract_id in self.contract_ids:
            stats["contracts"][contract_id] = {"events": 0, "failures": 0}
            logger.info(f"\nProcessing contract: {contract_id}")
            
            current_start = self.start_ledger
            while current_start <= self.end_ledger:
                current_end = min(current_start + self.batch_size - 1, self.end_ledger)
                
                filepath = self._get_output_filepath(contract_id, current_start, current_end)
                
                if self._is_already_processed(filepath) and not self.dry_run:
                    logger.info(f"  [SKIPPED] Ledgers {current_start}-{current_end} already processed")
                    stats["batches_skipped"] += 1
                    
                    # Read count to update stats
                    try:
                        with open(filepath, 'r') as f:
                            data = json.load(f)
                            count = data.get("event_count", 0)
                            stats["contracts"][contract_id]["events"] += count
                            stats["total_events"] += count
                    except:
                        pass
                else:
                    logger.info(f"  [FETCHING] Ledgers {current_start}-{current_end}")
                    
                    if self.dry_run:
                        stats["batches_processed"] += 1
                    else:
                        try:
                            events = self.fetch_events_batch(contract_id, current_start, current_end)
                            
                            # Save results
                            output_data = {
                                "contract_id": contract_id,
                                "start_ledger": current_start,
                                "end_ledger": current_end,
                                "event_count": len(events),
                                "events": events,
                                "status": "completed",
                                "timestamp": datetime.now(timezone.utc).isoformat()
                            }
                            
                            with open(filepath, 'w') as f:
                                json.dump(output_data, f, indent=2)
                                
                            stats["contracts"][contract_id]["events"] += len(events)
                            stats["total_events"] += len(events)
                            stats["batches_processed"] += 1
                            
                            logger.info(f"    Found {len(events)} events")
                        except Exception as e:
                            logger.error(f"    Failed to process batch: {e}")
                            stats["batches_failed"] += 1
                            stats["contracts"][contract_id]["failures"] += 1

                current_start = current_end + 1

        logger.info("\n" + "=" * 60)
        logger.info("BACKFILL SUMMARY")
        logger.info("=" * 60)
        logger.info(f"Total Events Found: {stats['total_events']}")
        logger.info(f"Batches Processed:  {stats['batches_processed']}")
        logger.info(f"Batches Skipped:    {stats['batches_skipped']} (Idempotent)")
        logger.info(f"Batches Failed:     {stats['batches_failed']}")
        
        for cid, c_stats in stats["contracts"].items():
            logger.info(f"Contract {cid[:8]}...: {c_stats['events']} events, {c_stats['failures']} failures")

        return stats

def parse_args():
    parser = argparse.ArgumentParser(description="Backfill Soroban contract events")
    parser.add_argument("--contract-ids", nargs="+", required=True, help="List of contract IDs to backfill")
    parser.add_argument("--start-ledger", type=int, required=True, help="Starting ledger sequence")
    parser.add_argument("--end-ledger", type=int, required=True, help="Ending ledger sequence")
    parser.add_argument("--output-dir", type=str, default="./data/contract_events", help="Directory to save output files")
    parser.add_argument("--rpc-url", type=str, default=os.getenv("SOROBAN_RPC_URL", "https://soroban-testnet.stellar.org"), help="Soroban RPC URL")
    parser.add_argument("--batch-size", type=int, default=1000, help="Number of ledgers per batch")
    parser.add_argument("--dry-run", action="store_true", help="Print operations without executing")
    
    return parser.parse_args()

def main():
    args = parse_args()
    
    if args.start_ledger > args.end_ledger:
        logger.error("start-ledger must be <= end-ledger")
        sys.exit(1)
        
    backfill = BackfillContractEvents(
        contract_ids=args.contract_ids,
        start_ledger=args.start_ledger,
        end_ledger=args.end_ledger,
        output_dir=args.output_dir,
        rpc_url=args.rpc_url,
        batch_size=args.batch_size,
        dry_run=args.dry_run
    )
    
    try:
        stats = backfill.run()
        if stats["batches_failed"] > 0:
            sys.exit(1)
        sys.exit(0)
    except KeyboardInterrupt:
        logger.info("Backfill interrupted by user")
        sys.exit(130)
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
