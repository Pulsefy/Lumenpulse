# Soroban Contract Event Backfill

This tool allows maintainers to backfill Soroban contract events for specific contract IDs within a specified ledger range. It safely fetches events from the Soroban RPC, processes them in batches, and outputs JSON files. It is fully idempotent, meaning you can safely re-run it in case of failure and it will pick up where it left off.

## Features

* **Specific Contract Targeting**: Supply one or more contract IDs to fetch events for.
* **Ledger Ranges**: Define precise start and end ledgers.
* **Batch Processing**: Configurable batch sizes to respect RPC limits.
* **Idempotent**: Resumes interrupted jobs seamlessly.
* **Summary Output**: Detailed breakdown of events fetched and failures.

## Usage

Run the script from the root of `apps/data-processing` or the project root using:

```bash
python scripts/backfill_contract_events.py \
  --contract-ids CABC123... CDEF456... \
  --start-ledger 10000 \
  --end-ledger 20000
```

### Command Line Arguments

* `--contract-ids` (Required): Space-separated list of Soroban Contract IDs.
* `--start-ledger` (Required): The starting ledger sequence number.
* `--end-ledger` (Required): The ending ledger sequence number.
* `--output-dir` (Optional): Directory to save JSON outputs. Defaults to `./data/contract_events`.
* `--rpc-url` (Optional): The Soroban RPC URL. Defaults to `https://soroban-testnet.stellar.org` or the value of `$SOROBAN_RPC_URL`.
* `--batch-size` (Optional): Number of ledgers to process per batch. Defaults to 1000.
* `--dry-run` (Optional): Print the plan without making RPC calls or writing files.

## Output Format

The output is written as JSON files in the `--output-dir`, with the naming convention:
`{contract_id}_{batch_start}_{batch_end}.json`

Example:
```json
{
  "contract_id": "CABC123...",
  "start_ledger": 10000,
  "end_ledger": 10999,
  "event_count": 5,
  "events": [...],
  "status": "completed",
  "timestamp": "2026-05-26T12:00:00+00:00"
}
```

## Idempotency

Before fetching events for a batch, the script checks if `{contract_id}_{batch_start}_{batch_end}.json` already exists and has `"status": "completed"`. If so, it skips the batch and adds the event count to the final summary.

To force a re-run for a specific range, simply delete the corresponding JSON files from the output directory.
