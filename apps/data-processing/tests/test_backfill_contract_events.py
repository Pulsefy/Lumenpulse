import pytest
import json
from pathlib import Path
from unittest.mock import patch, MagicMock

import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../scripts')))
from backfill_contract_events import BackfillContractEvents

@pytest.fixture
def temp_output_dir(tmp_path):
    return tmp_path / "contract_events"

@pytest.fixture
def backfill_instance(temp_output_dir):
    return BackfillContractEvents(
        contract_ids=["CABC123"],
        start_ledger=1000,
        end_ledger=1050,
        output_dir=temp_output_dir,
        rpc_url="http://mock-rpc",
        batch_size=20,
        dry_run=False
    )

def test_initialization(backfill_instance, temp_output_dir):
    assert backfill_instance.contract_ids == ["CABC123"]
    assert backfill_instance.start_ledger == 1000
    assert backfill_instance.end_ledger == 1050
    assert backfill_instance.output_dir == temp_output_dir
    assert backfill_instance.batch_size == 20
    assert temp_output_dir.exists()

def test_get_output_filepath(backfill_instance, temp_output_dir):
    filepath = backfill_instance._get_output_filepath("CABC123", 1000, 1019)
    assert filepath == temp_output_dir / "CABC123_1000_1019.json"

def test_is_already_processed(backfill_instance, temp_output_dir):
    filepath = temp_output_dir / "test_file.json"
    
    # Not exists
    assert not backfill_instance._is_already_processed(filepath)
    
    # Exists but incomplete
    with open(filepath, 'w') as f:
        json.dump({"status": "failed"}, f)
    assert not backfill_instance._is_already_processed(filepath)
    
    # Exists and completed
    with open(filepath, 'w') as f:
        json.dump({"status": "completed", "event_count": 5}, f)
    assert backfill_instance._is_already_processed(filepath)

@patch('backfill_contract_events.requests.post')
def test_fetch_events_batch(mock_post, backfill_instance):
    mock_response = MagicMock()
    mock_response.json.return_value = {
        "result": {
            "events": [
                {"ledger": 1005, "id": "1"},
                {"ledger": 1010, "id": "2"}
            ],
            "latestLedger": 1050
        }
    }
    mock_post.return_value = mock_response

    events = backfill_instance.fetch_events_batch("CABC123", 1000, 1019)
    
    assert len(events) == 2
    assert events[0]["id"] == "1"
    mock_post.assert_called_once()

@patch('backfill_contract_events.requests.post')
def test_fetch_events_batch_pagination(mock_post, backfill_instance):
    # First response has 100 items, meaning we should paginate
    events_page_1 = [{"ledger": 1005, "id": str(i)} for i in range(100)]
    events_page_2 = [{"ledger": 1010, "id": str(i)} for i in range(100, 105)]
    
    # Filter out paging tokens for simplicity in the mock
    for e in events_page_1:
        e["pagingToken"] = "token1"
    for e in events_page_2:
        e["pagingToken"] = "token2"
        
    mock_response_1 = MagicMock()
    mock_response_1.json.return_value = {"result": {"events": events_page_1}}
    
    mock_response_2 = MagicMock()
    mock_response_2.json.return_value = {"result": {"events": events_page_2}}
    
    mock_post.side_effect = [mock_response_1, mock_response_2]

    events = backfill_instance.fetch_events_batch("CABC123", 1000, 1019)
    
    assert len(events) == 105
    assert mock_post.call_count == 2

@patch('backfill_contract_events.BackfillContractEvents.fetch_events_batch')
def test_run(mock_fetch, backfill_instance, temp_output_dir):
    mock_fetch.return_value = [{"ledger": 1005, "id": "1"}]
    
    stats = backfill_instance.run()
    
    # 1000-1050 with batch size 20 means:
    # 1000-1019, 1020-1039, 1040-1050 (3 batches)
    assert stats["batches_processed"] == 3
    assert stats["batches_skipped"] == 0
    assert stats["total_events"] == 3
    assert mock_fetch.call_count == 3
    
    # Verify files created
    assert (temp_output_dir / "CABC123_1000_1019.json").exists()
    assert (temp_output_dir / "CABC123_1020_1039.json").exists()
    assert (temp_output_dir / "CABC123_1040_1050.json").exists()

@patch('backfill_contract_events.BackfillContractEvents.fetch_events_batch')
def test_run_idempotency(mock_fetch, backfill_instance, temp_output_dir):
    mock_fetch.return_value = [{"ledger": 1005, "id": "1"}]
    
    # Run once
    backfill_instance.run()
    assert mock_fetch.call_count == 3
    
    mock_fetch.reset_mock()
    
    # Run again, should be skipped
    stats = backfill_instance.run()
    
    assert stats["batches_processed"] == 0
    assert stats["batches_skipped"] == 3
    assert stats["total_events"] == 3 # read from file
    assert mock_fetch.call_count == 0


def test_dry_run_plan_estimates_batches_without_mutating_state(temp_output_dir):
    temp_output_dir.mkdir(parents=True, exist_ok=True)

    checkpoint_path = temp_output_dir / "checkpoint.json"
    checkpoint_path.write_text(json.dumps({"version": 1, "contracts": {}}), encoding="utf-8")
    checkpoint_content = checkpoint_path.read_text(encoding="utf-8")

    existing_output_path = temp_output_dir / "existing.json"
    existing_output_path.write_text(json.dumps({"status": "completed", "event_count": 5}), encoding="utf-8")
    existing_output_content = existing_output_path.read_text(encoding="utf-8")

    backfill = BackfillContractEvents(
        contract_ids=["CABC123"],
        start_ledger=1000,
        end_ledger=1050,
        output_dir=temp_output_dir,
        rpc_url="http://mock-rpc",
        batch_size=20,
        dry_run=True,
    )

    stats = backfill.run()

    assert stats["dry_run"] is True
    assert stats["plan"]["ledger_span"] == 51
    assert stats["plan"]["estimated_batches"] == 3
    assert stats["plan"]["estimated_output_files"] == 3
    assert stats["plan"]["estimated_duration_seconds"] > 0
    assert checkpoint_path.read_text(encoding="utf-8") == checkpoint_content
    assert existing_output_path.read_text(encoding="utf-8") == existing_output_content
    assert not (temp_output_dir / "CABC123_1000_1019.json").exists()


# ---------------------------------------------------------------------------
# Checkpoint recovery tests (TODO.md: incremental ledger checkpoint recovery)
# ---------------------------------------------------------------------------

@patch('backfill_contract_events.BackfillContractEvents.fetch_events_batch')
def test_checkpoint_written_after_each_batch(mock_fetch, temp_output_dir):
    """
    A checkpoint file must be written after every successfully processed batch
    so that an interrupted run can resume exactly where it left off.
    """
    mock_fetch.return_value = [{"ledger": 1005, "id": "ev1"}]

    backfill = BackfillContractEvents(
        contract_ids=["CABC123"],
        start_ledger=1000,
        end_ledger=1050,
        output_dir=temp_output_dir,
        rpc_url="http://mock-rpc",
        batch_size=20,
        dry_run=False,
    )
    backfill.run()

    checkpoint_path = temp_output_dir / "checkpoint.json"
    assert checkpoint_path.exists(), "checkpoint.json must exist after a completed run"

    with open(checkpoint_path) as f:
        cp = json.load(f)

    # After a full run the checkpoint should record the last batch end (1050)
    assert "CABC123" in cp["contracts"], "contract key must be present in checkpoint"
    assert cp["contracts"]["CABC123"]["last_completed_batch_end"] == 1050


@patch('backfill_contract_events.BackfillContractEvents.fetch_events_batch')
def test_resume_from_interrupted_run(mock_fetch, temp_output_dir):
    """
    When a previous run was interrupted mid-way, a new run must resume
    from the last completed batch end instead of re-fetching from
    start_ledger, and must NOT re-fetch already-completed batches.

    Scenario:
        Ledger range  : 1000 – 1050
        Batch size    : 20  →  batches 1000-1019, 1020-1039, 1040-1050
        Interrupted after first batch (1000-1019) is written.

    Second run must only process batches starting at 1020.
    """
    mock_fetch.return_value = [{"ledger": 1005, "id": "ev_seed"}]

    # ── Simulate an interrupted first run ──────────────────────────────
    # Write the first batch output as if it completed.
    temp_output_dir.mkdir(parents=True, exist_ok=True)
    first_batch_file = temp_output_dir / "CABC123_1000_1019.json"
    with open(first_batch_file, "w") as f:
        json.dump(
            {
                "contract_id": "CABC123",
                "start_ledger": 1000,
                "end_ledger": 1019,
                "event_count": 1,
                "events": [{"ledger": 1005, "id": "ev_seed"}],
                "status": "completed",
            },
            f,
        )

    # Write a checkpoint that records the first batch as done.
    checkpoint_path = temp_output_dir / "checkpoint.json"
    with open(checkpoint_path, "w") as f:
        json.dump(
            {
                "version": 1,
                "contracts": {"CABC123": {"last_completed_batch_end": 1019}},
                "updated_at": "2026-01-01T00:00:00+00:00",
            },
            f,
        )

    # ── Resume run ──────────────────────────────────────────────────────
    mock_fetch.reset_mock()
    mock_fetch.return_value = [{"ledger": 1025, "id": "ev_new"}]

    resumed = BackfillContractEvents(
        contract_ids=["CABC123"],
        start_ledger=1000,
        end_ledger=1050,
        output_dir=temp_output_dir,
        rpc_url="http://mock-rpc",
        batch_size=20,
        dry_run=False,
    )
    stats = resumed.run()

    # Only the two remaining batches (1020-1039, 1040-1050) should be fetched.
    assert mock_fetch.call_count == 2, (
        f"Expected 2 fetch calls for remaining batches; got {mock_fetch.call_count}. "
        f"First batch should have been skipped."
    )
    assert stats["batches_processed"] == 2
    assert stats["batches_skipped"] == 1  # 1000-1019 was already complete

    # Verify the checkpoint was updated to reflect the new end.
    with open(checkpoint_path) as f:
        cp = json.load(f)
    assert cp["contracts"]["CABC123"]["last_completed_batch_end"] == 1050


@patch('backfill_contract_events.BackfillContractEvents.fetch_events_batch')
def test_resume_avoids_duplicate_processing(mock_fetch, temp_output_dir):
    """
    Events in batches that were fully written before the interruption must
    not be fetched again on resume.  This validates the duplicate-avoidance
    requirement from the TODO.
    """
    mock_fetch.return_value = []

    # Pre-populate all three batch files as completed, and set checkpoint
    # to only the first two (simulating crash after second batch).
    temp_output_dir.mkdir(parents=True, exist_ok=True)
    for start, end in [(1000, 1019), (1020, 1039)]:
        p = temp_output_dir / f"CABC123_{start}_{end}.json"
        with open(p, "w") as f:
            json.dump(
                {
                    "contract_id": "CABC123",
                    "start_ledger": start,
                    "end_ledger": end,
                    "event_count": 3,
                    "events": [{"ledger": start + 1, "id": f"ev{start}"}],
                    "status": "completed",
                },
                f,
            )

    checkpoint_path = temp_output_dir / "checkpoint.json"
    with open(checkpoint_path, "w") as f:
        json.dump(
            {
                "version": 1,
                "contracts": {"CABC123": {"last_completed_batch_end": 1039}},
                "updated_at": "2026-01-01T00:00:00+00:00",
            },
            f,
        )

    mock_fetch.return_value = [{"ledger": 1045, "id": "ev_final"}]

    backfill = BackfillContractEvents(
        contract_ids=["CABC123"],
        start_ledger=1000,
        end_ledger=1050,
        output_dir=temp_output_dir,
        rpc_url="http://mock-rpc",
        batch_size=20,
        dry_run=False,
    )
    stats = backfill.run()

    # Only the final batch (1040-1050) should have been fetched.
    assert mock_fetch.call_count == 1, (
        f"Expected exactly 1 fetch call for the missing batch; got {mock_fetch.call_count}"
    )
    # The two existing batches must appear as skipped, not processed.
    assert stats["batches_skipped"] == 2
    assert stats["batches_processed"] == 1

    # Event counts from skipped batches are still tallied.
    assert stats["total_events"] == 3 + 3 + 1  # 3 + 3 from files + 1 fetched


@patch('backfill_contract_events.BackfillContractEvents.fetch_events_batch')
def test_recovery_state_logged(mock_fetch, temp_output_dir, caplog):
    """
    The backfill must emit a [RECOVERY] log line for each contract showing
    the last completed batch end and the ledger that ingestion will resume from.
    This satisfies the 'operational logs showing recovery state' TODO requirement.
    """
    import logging

    mock_fetch.return_value = [{"ledger": 1025, "id": "ev1"}]

    # Set up a partial checkpoint (first batch already done)
    temp_output_dir.mkdir(parents=True, exist_ok=True)
    first_batch = temp_output_dir / "CABC123_1000_1019.json"
    with open(first_batch, "w") as f:
        json.dump(
            {
                "contract_id": "CABC123",
                "start_ledger": 1000,
                "end_ledger": 1019,
                "event_count": 2,
                "events": [],
                "status": "completed",
            },
            f,
        )

    checkpoint_path = temp_output_dir / "checkpoint.json"
    with open(checkpoint_path, "w") as f:
        json.dump(
            {
                "version": 1,
                "contracts": {"CABC123": {"last_completed_batch_end": 1019}},
                "updated_at": "2026-01-01T00:00:00+00:00",
            },
            f,
        )

    with caplog.at_level(logging.INFO, logger="backfill_contract_events"):
        backfill = BackfillContractEvents(
            contract_ids=["CABC123"],
            start_ledger=1000,
            end_ledger=1050,
            output_dir=temp_output_dir,
            rpc_url="http://mock-rpc",
            batch_size=20,
            dry_run=False,
        )
        backfill.run()

    # There must be a RECOVERY log line for the contract.
    recovery_logs = [r.message for r in caplog.records if "[RECOVERY]" in r.message]
    assert len(recovery_logs) >= 1, (
        "Expected at least one [RECOVERY] log entry. Got: " + str([r.message for r in caplog.records])
    )

    recovery_msg = recovery_logs[0]
    assert "CABC123" in recovery_msg, "Recovery log must name the contract"
    assert "1019" in recovery_msg, "Recovery log must show last_completed_batch_end"
    assert "1020" in recovery_msg, "Recovery log must show next_ledger (resume point)"


@patch('backfill_contract_events.BackfillContractEvents.fetch_events_batch')
def test_recovery_stats_include_recovery_info(mock_fetch, temp_output_dir):
    """
    The stats dict returned by run() must include a 'recovery' key per
    contract so operators can inspect what was recovered programmatically.
    """
    mock_fetch.return_value = []

    temp_output_dir.mkdir(parents=True, exist_ok=True)

    # Write checkpoint showing ledger 1019 was the last complete batch
    checkpoint_path = temp_output_dir / "checkpoint.json"
    with open(checkpoint_path, "w") as f:
        json.dump(
            {
                "version": 1,
                "contracts": {"CABC123": {"last_completed_batch_end": 1019}},
            },
            f,
        )

    # Also write the corresponding batch file so the backfill skips it
    p = temp_output_dir / "CABC123_1000_1019.json"
    with open(p, "w") as f:
        json.dump({"status": "completed", "event_count": 0, "events": []}, f)

    mock_fetch.return_value = [{"ledger": 1025, "id": "ev1"}]

    backfill = BackfillContractEvents(
        contract_ids=["CABC123"],
        start_ledger=1000,
        end_ledger=1050,
        output_dir=temp_output_dir,
        rpc_url="http://mock-rpc",
        batch_size=20,
        dry_run=False,
    )
    stats = backfill.run()

    assert "recovery" in stats, "'recovery' key must be present in stats"
    assert "CABC123" in stats["recovery"], "Contract must appear in recovery stats"
    recovery_info = stats["recovery"]["CABC123"]
    assert "last_completed_batch_end" in recovery_info
    assert "next_ledger" in recovery_info
    assert recovery_info["last_completed_batch_end"] == 1019
    assert recovery_info["next_ledger"] == 1020


@patch('backfill_contract_events.BackfillContractEvents.fetch_events_batch')
def test_no_prior_checkpoint_starts_from_beginning(mock_fetch, temp_output_dir):
    """
    When no checkpoint file exists (first-ever run), the backfill must
    start from start_ledger and report no recovery information.
    """
    mock_fetch.return_value = [{"ledger": 1001, "id": "ev1"}]

    backfill = BackfillContractEvents(
        contract_ids=["CABC123"],
        start_ledger=1000,
        end_ledger=1020,
        output_dir=temp_output_dir,
        rpc_url="http://mock-rpc",
        batch_size=30,
        dry_run=False,
    )
    stats = backfill.run()

    # No prior checkpoint → recovery shows None for last_completed_batch_end
    assert stats["recovery"]["CABC123"]["last_completed_batch_end"] is None
    assert stats["recovery"]["CABC123"]["next_ledger"] == 1000
    # All batches should have been processed normally
    assert stats["batches_processed"] == 1
    assert stats["batches_skipped"] == 0


@patch('backfill_contract_events.BackfillContractEvents.fetch_events_batch')
def test_checkpoint_persisted_atomically(mock_fetch, temp_output_dir):
    """
    The checkpoint must be written atomically (via a .tmp file rename) so
    that a crash mid-write cannot leave a corrupt checkpoint file.
    The .tmp file must not linger after a successful batch.
    """
    mock_fetch.return_value = [{"ledger": 1005, "id": "ev1"}]

    backfill = BackfillContractEvents(
        contract_ids=["CABC123"],
        start_ledger=1000,
        end_ledger=1019,
        output_dir=temp_output_dir,
        rpc_url="http://mock-rpc",
        batch_size=20,
        dry_run=False,
    )
    backfill.run()

    # No leftover .tmp file should exist after a successful run
    tmp_file = temp_output_dir / "checkpoint.tmp"
    assert not tmp_file.exists(), "Temporary checkpoint file must be cleaned up after atomic rename"

    # The real checkpoint must be valid JSON
    checkpoint_path = temp_output_dir / "checkpoint.json"
    assert checkpoint_path.exists()
    with open(checkpoint_path) as f:
        cp = json.load(f)
    assert "contracts" in cp


@patch('backfill_contract_events.BackfillContractEvents.fetch_events_batch')
def test_multi_contract_independent_checkpoints(mock_fetch, temp_output_dir):
    """
    With multiple contracts, each contract's checkpoint is tracked independently.
    Completing batches for contract A must not affect contract B's resume point.
    """
    mock_fetch.return_value = [{"ledger": 1005, "id": "ev1"}]

    # Set up: contract A has completed first batch; contract B has none.
    temp_output_dir.mkdir(parents=True, exist_ok=True)
    first_batch_a = temp_output_dir / "CONTRACT_A_1000_1019.json"
    with open(first_batch_a, "w") as f:
        json.dump(
            {
                "contract_id": "CONTRACT_A",
                "start_ledger": 1000,
                "end_ledger": 1019,
                "event_count": 1,
                "events": [],
                "status": "completed",
            },
            f,
        )

    checkpoint_path = temp_output_dir / "checkpoint.json"
    with open(checkpoint_path, "w") as f:
        json.dump(
            {
                "version": 1,
                "contracts": {
                    "CONTRACT_A": {"last_completed_batch_end": 1019},
                    # CONTRACT_B has no entry yet
                },
            },
            f,
        )

    mock_fetch.return_value = [{"ledger": 1025, "id": "ev_new"}]
    backfill = BackfillContractEvents(
        contract_ids=["CONTRACT_A", "CONTRACT_B"],
        start_ledger=1000,
        end_ledger=1050,
        output_dir=temp_output_dir,
        rpc_url="http://mock-rpc",
        batch_size=20,
        dry_run=False,
    )
    stats = backfill.run()

    # CONTRACT_A: 1 skipped + 2 processed; CONTRACT_B: 0 skipped + 3 processed
    assert stats["batches_skipped"] == 1
    assert stats["batches_processed"] == 5  # 2 for A + 3 for B

    # Final checkpoint must record both contracts at ledger 1050
    with open(checkpoint_path) as f:
        cp = json.load(f)
    assert cp["contracts"]["CONTRACT_A"]["last_completed_batch_end"] == 1050
    assert cp["contracts"]["CONTRACT_B"]["last_completed_batch_end"] == 1050
