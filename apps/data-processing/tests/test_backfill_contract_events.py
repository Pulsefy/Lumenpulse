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
