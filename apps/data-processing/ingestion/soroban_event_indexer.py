"""
Soroban Event Indexer for incremental sync
Polls Soroban RPC for new events and sends them to backend for processing
"""

import os
import time
import json
import logging
from pathlib import Path
from datetime import datetime, timezone
import requests
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)

class SorobanEventIndexer:
    def __init__(
        self,
        rpc_url: str,
        backend_url: str,
        ingest_secret: str,
        contract_ids: Optional[List[str]] = None,
        state_file: str = "./data/soroban_indexer_state.json",
        poll_interval: int = 30
    ):
        self.rpc_url = rpc_url
        self.backend_url = backend_url
        self.ingest_secret = ingest_secret
        self.contract_ids = contract_ids or []
        self.state_file = Path(state_file)
        self.poll_interval = poll_interval
        self.last_ledger: int = self._load_last_ledger()

    def _load_last_ledger(self) -> int:
        """Load last processed ledger from state file"""
        if self.state_file.exists():
            try:
                with open(self.state_file, 'r') as f:
                    state = json.load(f)
                    return state.get("last_ledger", 0)
            except (json.JSONDecodeError, KeyError):
                logger.warning("Failed to load state file, starting from ledger 0")
        return 0

    def _save_last_ledger(self, ledger: int):
        """Save last processed ledger to state file"""
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self.state_file, 'w') as f:
            json.dump({"last_ledger": ledger, "timestamp": datetime.now(timezone.utc).isoformat()}, f)
        self.last_ledger = ledger

    def fetch_latest_ledger(self) -> int:
        """Get the latest ledger sequence from Soroban RPC"""
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getLatestLedger"
        }
        
        try:
            response = requests.post(self.rpc_url, json=payload, timeout=30)
            response.raise_for_status()
            data = response.json()
            return int(data.get("result", {}).get("sequence", 0))
        except Exception as e:
            logger.error(f"Failed to fetch latest ledger: {e}")
            raise

    def fetch_events_since(self, start_ledger: int) -> List[Dict]:
        """Fetch events from Soroban RPC starting at the given ledger"""
        all_events = []
        cursor = None

        while True:
            filters = []
            if self.contract_ids:
                filters.append({
                    "type": "contract",
                    "contractIds": self.contract_ids
                })

            payload = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "getEvents",
                "params": {
                    "startLedger": start_ledger,
                    "filters": filters,
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
            all_events.extend(events)

            # Check if we need to paginate
            if len(events) < 100:
                break

            # Get cursor from last event
            if events:
                cursor = events[-1].get("pagingToken")
            
            if not cursor:
                break

            time.sleep(0.5)  # Rate limiting

        return all_events

    def send_event_to_backend(self, event: Dict, event_index: int) -> bool:
        """Send a single event to the backend ingest endpoint"""
        tx_hash = event.get("transactionHash", "")
        ledger_sequence = int(event.get("ledger", 0))
        contract_id = event.get("contractId")
        event_type = event.get("type")
        raw_payload = event

        ingest_payload = {
            "txHash": tx_hash,
            "eventIndex": event_index,
            "ledgerSequence": ledger_sequence,
            "contractId": contract_id,
            "eventType": event_type,
            "rawPayload": raw_payload
        }

        headers = {
            "Content-Type": "application/json",
            "x-ingest-secret": self.ingest_secret
        }

        try:
            response = requests.post(
                f"{self.backend_url}/soroban-events/ingest",
                json=ingest_payload,
                headers=headers,
                timeout=30
            )
            response.raise_for_status()
            logger.debug(f"Successfully sent event {tx_hash}:{event_index} to backend")
            return True
        except Exception as e:
            logger.error(f"Failed to send event {tx_hash}:{event_index} to backend: {e}")
            return False

    def run_once(self) -> Dict:
        """Run one iteration of the indexer"""
        logger.info("=" * 60)
        logger.info("SOROBAN EVENT INDEXER - INCREMENTAL SYNC")
        logger.info("=" * 60)
        
        try:
            latest_ledger = self.fetch_latest_ledger()
            logger.info(f"Latest ledger: {latest_ledger}")
            logger.info(f"Last processed ledger: {self.last_ledger}")

            if latest_ledger <= self.last_ledger:
                logger.info("No new ledgers to process")
                return {"status": "no_new_ledgers", "events_processed": 0}

            start_ledger = self.last_ledger + 1
            logger.info(f"Fetching events from ledger {start_ledger} to {latest_ledger}")
            
            events = self.fetch_events_since(start_ledger)
            logger.info(f"Found {len(events)} new events")

            # Send events to backend
            sent_count = 0
            failed_count = 0
            highest_ledger = self.last_ledger

            for idx, event in enumerate(events):
                success = self.send_event_to_backend(event, idx)
                if success:
                    sent_count += 1
                else:
                    failed_count += 1
                
                # Update highest ledger seen
                event_ledger = int(event.get("ledger", 0))
                if event_ledger > highest_ledger:
                    highest_ledger = event_ledger

            # Update state to the highest ledger processed
            self._save_last_ledger(highest_ledger)

            logger.info(f"Sent {sent_count} events to backend, {failed_count} failed")
            logger.info(f"Updated last processed ledger to {highest_ledger}")
            logger.info("=" * 60)
            
            return {
                "status": "success",
                "events_found": len(events),
                "events_sent": sent_count,
                "events_failed": failed_count,
                "last_ledger": highest_ledger
            }

        except Exception as e:
            logger.error(f"Error in indexer run: {e}", exc_info=True)
            return {"status": "error", "error": str(e)}

    def run_forever(self):
        """Run the indexer continuously, polling for new events"""
        logger.info("Starting Soroban event indexer (continuous mode)")
        logger.info(f"Poll interval: {self.poll_interval} seconds")
        
        while True:
            self.run_once()
            time.sleep(self.poll_interval)

def main():
    import argparse

    parser = argparse.ArgumentParser(description="Soroban Event Indexer")
    parser.add_argument("--rpc-url", type=str, default=os.getenv("SOROBAN_RPC_URL", "https://soroban-testnet.stellar.org"), help="Soroban RPC URL")
    parser.add_argument("--backend-url", type=str, default=os.getenv("BACKEND_URL", "http://localhost:3000"), help="Backend API URL")
    parser.add_argument("--ingest-secret", type=str, default=os.getenv("SOROBAN_INGEST_SECRET", ""), help="Secret for backend ingest endpoint")
    parser.add_argument("--contract-ids", nargs="*", default=os.getenv("SOROBAN_CONTRACT_IDS", "").split(","), help="List of contract IDs to index (comma-separated)")
    parser.add_argument("--state-file", type=str, default="./data/soroban_indexer_state.json", help="Path to state file")
    parser.add_argument("--poll-interval", type=int, default=30, help="Poll interval in seconds")
    parser.add_argument("--once", action="store_true", help="Run once and exit")
    
    args = parser.parse_args()

    # Clean up contract ids
    contract_ids = [cid.strip() for cid in args.contract_ids if cid.strip()]

    indexer = SorobanEventIndexer(
        rpc_url=args.rpc_url,
        backend_url=args.backend_url,
        ingest_secret=args.ingest_secret,
        contract_ids=contract_ids,
        state_file=args.state_file,
        poll_interval=args.poll_interval
    )

    if args.once:
        indexer.run_once()
    else:
        indexer.run_forever()

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(levelname)s - %(message)s"
    )
    main()
