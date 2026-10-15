import os
import pytest
import json
import sys
from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../scripts")))

from src.db.postgres_service import PostgresService
from src.db.models import RawSorobanEvent, ContractEvent
from backfill_contract_events import BackfillContractEvents
from replay_raw_events import replay_events, process_event_payload

# Skip tests if no database URL is configured
pytestmark = pytest.mark.skipif(
    not os.getenv("DATABASE_URL"), reason="DATABASE_URL not configured"
)


@pytest.fixture
def db_service():
    """Create a PostgresService instance for testing and set up tables."""
    service = PostgresService()
    service.create_tables()
    return service


class TestRawSorobanEventsPipeline:
    """Integration test suite for raw Soroban events append-only pipeline."""

    def test_save_and_retrieve_raw_event(self, db_service):
        """Verify raw events are saved with ledger and source metadata, and can be retrieved."""
        contract_id = "CCONTRACT1234567890"
        event_id = "0000001000-00001"
        ledger = 1000
        source_rpc_url = "https://soroban-testnet.stellar.org"
        raw_payload = {
            "type": "contract",
            "ledger": 1000,
            "ledgerClosedAt": "2026-07-23T20:00:00Z",
            "id": event_id,
            "pagingToken": "token123",
            "contractId": contract_id,
            "topic": [{"xdr": "AAAAAQ=="}],
            "value": {"xdr": "AAAAAg=="},
            "inSuccessfulLedger": True,
        }

        # Clean existing just in case
        with db_service.get_session() as session:
            session.query(RawSorobanEvent).filter_by(
                contract_id=contract_id, event_id=event_id
            ).delete()
            session.commit()

        # Save raw event
        saved = db_service.save_raw_soroban_event(
            contract_id=contract_id,
            event_id=event_id,
            ledger=ledger,
            raw_payload=raw_payload,
            source_rpc_url=source_rpc_url,
            paging_token="token123",
            event_type="contract",
        )

        assert saved is not None
        assert saved.id is not None
        assert saved.contract_id == contract_id
        assert saved.event_id == event_id
        assert saved.ledger == ledger
        assert saved.source_rpc_url == source_rpc_url
        assert saved.paging_token == "token123"
        assert saved.event_type == "contract"
        assert saved.raw_payload == raw_payload

        # Retrieve event
        retrieved = db_service.get_raw_soroban_events(
            contract_id=contract_id, start_ledger=900, end_ledger=1100
        )
        assert len(retrieved) > 0
        assert any(r.event_id == event_id for r in retrieved)

    def test_idempotency_avoids_duplicates(self, db_service):
        """Verify that duplicate saves of the same event ID are avoided/deduplicated."""
        contract_id = "CCONTRACT_DUP"
        event_id = "0000001000-00002"
        ledger = 1000
        raw_payload = {"id": event_id, "ledger": ledger}

        # First save
        ev1 = db_service.save_raw_soroban_event(
            contract_id=contract_id,
            event_id=event_id,
            ledger=ledger,
            raw_payload=raw_payload,
        )
        assert ev1 is not None

        # Second save (should return existing and not insert a duplicate row)
        ev2 = db_service.save_raw_soroban_event(
            contract_id=contract_id,
            event_id=event_id,
            ledger=ledger,
            raw_payload=raw_payload,
        )
        assert ev2 is not None
        assert ev1.id == ev2.id

    def test_replay_without_mutation(self, db_service):
        """Verify that replaying raw events from DB does not mutate the database record."""
        contract_id = "CCONTRACT_REPLAY"
        event_id = "0000001000-00003"
        ledger = 1000
        raw_payload = {
            "id": event_id,
            "ledger": ledger,
            "type": "contract",
            "topic": [{"xdr": "topic_data"}],
            "value": {"xdr": "value_data"},
        }

        # Clear first
        with db_service.get_session() as session:
            session.query(RawSorobanEvent).filter_by(contract_id=contract_id).delete()
            session.commit()

        # Save
        db_service.save_raw_soroban_event(
            contract_id=contract_id,
            event_id=event_id,
            ledger=ledger,
            raw_payload=raw_payload,
        )

        # Run replay script logic
        reprocessed = replay_events(contract_id=contract_id, limit=5)
        assert reprocessed == 1

        # Check DB record is unchanged
        events = db_service.get_raw_soroban_events(contract_id=contract_id)
        assert len(events) == 1
        assert events[0].raw_payload == raw_payload

    def test_retention_strategy(self, db_service):
        """Verify that old raw events are pruned according to retention strategy."""
        contract_id = "CCONTRACT_RETENTION"

        # Save old event and new event
        old_time = datetime.utcnow() - timedelta(days=100)
        new_time = datetime.utcnow() - timedelta(days=5)

        with db_service.get_session() as session:
            session.query(RawSorobanEvent).filter_by(contract_id=contract_id).delete()

            old_event = RawSorobanEvent(
                contract_id=contract_id,
                event_id="old-event-id",
                ledger=500,
                raw_payload={"id": "old-event-id"},
                created_at=old_time,
            )
            new_event = RawSorobanEvent(
                contract_id=contract_id,
                event_id="new-event-id",
                ledger=600,
                raw_payload={"id": "new-event-id"},
                created_at=new_time,
            )
            session.add(old_event)
            session.add(new_event)
            session.commit()

        # Execute cleanup under custom environment setting (keep 90 days)
        with patch.dict(os.environ, {"RAW_EVENT_RETENTION_DAYS": "90"}):
            deleted = db_service.cleanup_old_data(days=30)
            assert deleted.get("raw_soroban_events", 0) >= 1

        # Check that old event is gone, new event remains
        events = db_service.get_raw_soroban_events(contract_id=contract_id)
        event_ids = [e.event_id for e in events]
        assert "new-event-id" in event_ids
        assert "old-event-id" not in event_ids

    @patch("backfill_contract_events.requests.post")
    def test_backfill_persistence_integration(self, mock_post, db_service, tmp_path):
        """Verify that the backfill script successfully persists raw events to the database."""
        contract_id = "CCONTRACT_BACKFILL"
        event_id = "0000001000-00004"

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "result": {
                "events": [
                    {
                        "ledger": 1000,
                        "id": event_id,
                        "pagingToken": "paging123",
                        "type": "contract",
                        "contractId": contract_id,
                    }
                ]
            }
        }
        mock_post.return_value = mock_response

        # Clear DB first
        with db_service.get_session() as session:
            session.query(RawSorobanEvent).filter_by(contract_id=contract_id).delete()
            session.commit()

        backfill = BackfillContractEvents(
            contract_ids=[contract_id],
            start_ledger=1000,
            end_ledger=1000,
            output_dir=tmp_path / "backfill_out",
            rpc_url="http://mock-rpc",
            batch_size=10,
            dry_run=False,
            db_persist=True,
        )

        stats = backfill.run()
        assert stats["total_events"] == 1

        # Verify DB has the raw event persisted
        events = db_service.get_raw_soroban_events(contract_id=contract_id)
        assert len(events) == 1
        assert events[0].event_id == event_id
