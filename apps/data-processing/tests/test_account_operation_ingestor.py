"""
Unit tests for AccountOperationIngestor.
"""

import unittest
from unittest.mock import Mock, patch
from datetime import datetime, timezone

from src.ingestion.account_operation_ingestor import (
    AccountOperationIngestor,
    AccountOperation,
    IngestionStats,
    ingest_account_operations,
    get_ingestion_status,
)


class TestAccountOperation(unittest.TestCase):
    """Test AccountOperation dataclass."""
    
    def test_account_operation_creation(self):
        op = AccountOperation(
            id="12345",
            tx_id="tx_abc",
            source_account="GABC123",
            operation_type="payment",
            created_at=datetime(2024, 1, 1, 12, 0, 0, tzinfo=timezone.utc),
            ledger=100,
            paging_token="100-1",
            amount=100.5,
            asset_code="XLM",
            asset_issuer=None,
            to_account="GDEF456",
            from_account="GABC123",
        )
        
        self.assertEqual(op.id, "12345")
        self.assertEqual(op.tx_id, "tx_abc")
        self.assertEqual(op.source_account, "GABC123")
        self.assertEqual(op.operation_type, "payment")
        self.assertEqual(op.amount, 100.5)
        self.assertEqual(op.asset_code, "XLM")
    
    def test_account_operation_to_dict(self):
        op = AccountOperation(
            id="12345",
            tx_id="tx_abc",
            source_account="GABC123",
            operation_type="payment",
            created_at=datetime(2024, 1, 1, 12, 0, 0, tzinfo=timezone.utc),
            ledger=100,
            paging_token="100-1",
            amount=100.5,
            asset_code="XLM",
        )
        
        d = op.to_dict()
        self.assertEqual(d["id"], "12345")
        self.assertEqual(d["amount"], 100.5)
        self.assertEqual(d["asset_code"], "XLM")
        self.assertIn("created_at", d)


class TestIngestionStats(unittest.TestCase):
    """Test IngestionStats dataclass."""
    
    def test_ingestion_stats_to_dict(self):
        stats = IngestionStats(
            operations_processed=100,
            operations_ingested=95,
            operations_duplicate=3,
            operations_failed=2,
            start_ledger=100,
            end_ledger=200,
            start_time=datetime(2024, 1, 1, 12, 0, 0, tzinfo=timezone.utc),
            end_time=datetime(2024, 1, 1, 12, 5, 0, tzinfo=timezone.utc),
        )
        
        d = stats.to_dict()
        self.assertEqual(d["operations_processed"], 100)
        self.assertEqual(d["operations_ingested"], 95)
        self.assertEqual(d["operations_duplicate"], 3)
        self.assertEqual(d["operations_failed"], 2)
        self.assertEqual(d["duration_seconds"], 300.0)


class TestAccountOperationIngestor(unittest.TestCase):
    """Test AccountOperationIngestor class."""

    def setUp(self):
        # Every test constructs AccountOperationIngestor() with no args, which
        # would otherwise try to open a real Postgres connection.
        # Note: self.enterContext() requires Python 3.11+; CI runs 3.9, so we
        # use the patch().start()/addCleanup(patch.stop) pattern instead.
        for target in (
            "src.ingestion.account_operation_ingestor.PostgresService",
            "src.ingestion.account_operation_ingestor.LedgerCursorStore",
            "src.ingestion.account_operation_ingestor.StellarDataFetcher",
        ):
            patcher = patch(target)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_init(self):
        ingestor = AccountOperationIngestor(
            horizon_url="https://horizon-testnet.stellar.org",
            batch_size=100,
            rate_limit_sleep=0.1,
        )
        
        self.assertEqual(ingestor.horizon_url, "https://horizon-testnet.stellar.org")
        self.assertEqual(ingestor.batch_size, 100)
        self.assertEqual(ingestor.rate_limit_sleep, 0.1)
    
    def test_get_stream_id(self):
        ingestor = AccountOperationIngestor()
        
        # Global stream
        stream_id = ingestor._get_stream_id()
        self.assertEqual(stream_id, "account_ops:global")
        
        # Account-specific stream
        stream_id = ingestor._get_stream_id("GABC123")
        self.assertEqual(stream_id, "account_ops:GABC123")
    
    def test_parse_operation_payment(self):
        ingestor = AccountOperationIngestor()
        
        raw_op = {
            "id": "12345",
            "transaction_hash": "tx_abc",
            "source_account": "GABC123",
            "type": "payment",
            "created_at": "2024-01-01T12:00:00Z",
            "paging_token": "100-1",
            "ledger": 100,
            "amount": "100.5",
            "asset_code": "XLM",
            "asset_issuer": None,
            "to": "GDEF456",
            "from": "GABC123",
        }
        
        op = ingestor._parse_operation(raw_op)
        
        self.assertIsNotNone(op)
        self.assertEqual(op.id, "12345")
        self.assertEqual(op.operation_type, "payment")
        self.assertEqual(op.amount, 100.5)
        self.assertEqual(op.asset_code, "XLM")
        self.assertEqual(op.to_account, "GDEF456")
    
    def test_parse_operation_unknown_type(self):
        ingestor = AccountOperationIngestor()
        
        raw_op = {
            "id": "12345",
            "transaction_hash": "tx_abc",
            "source_account": "GABC123",
            "type": "unknown_type",
            "created_at": "2024-01-01T12:00:00Z",
            "paging_token": "100-1",
            "ledger": 100,
        }
        
        op = ingestor._parse_operation(raw_op)
        
        self.assertIsNotNone(op)
        self.assertEqual(op.operation_type, "unknown_type")
        self.assertIsNone(op.amount)
    
    def test_parse_operation_missing_id(self):
        ingestor = AccountOperationIngestor()
        
        raw_op = {
            "transaction_hash": "tx_abc",
            "source_account": "GABC123",
        }
        
        op = ingestor._parse_operation(raw_op)
        self.assertIsNone(op)
    
    @patch("src.ingestion.account_operation_ingestor.AccountOperationIngestor._fetch_operations_with_retry")
    def test_ingest_incremental_no_ops(self, mock_fetch):
        ingestor = AccountOperationIngestor()
        
        # Mock empty response
        mock_fetch.return_value = ([], None)
        
        # Mock cursor store
        mock_cursor = Mock()
        mock_cursor.last_ingested_ledger = 0
        mock_cursor.last_event_id = None
        ingestor.cursor_store.get_or_create = Mock(return_value=mock_cursor)
        ingestor.cursor_store.begin_batch = Mock(return_value=0)
        
        stats = ingestor.ingest_incremental()
        
        self.assertEqual(stats.operations_processed, 0)
        self.assertEqual(stats.operations_ingested, 0)
    
    @patch("src.ingestion.account_operation_ingestor.AccountOperationIngestor._fetch_operations_with_retry")
    def test_ingest_incremental_with_ops(self, mock_fetch):
        ingestor = AccountOperationIngestor()
        
        # Mock operations
        raw_op = {
            "id": "12345",
            "transaction_hash": "tx_abc",
            "source_account": "GABC123",
            "type": "payment",
            "created_at": "2024-01-01T12:00:00Z",
            "paging_token": "100-1",
            "ledger": 100,
            "amount": "100.5",
            "asset_code": "XLM",
        }
        
        mock_fetch.return_value = ([raw_op], None)
        
        # Mock cursor store
        mock_cursor = Mock()
        mock_cursor.last_ingested_ledger = 0
        mock_cursor.last_event_id = None
        ingestor.cursor_store.get_or_create = Mock(return_value=mock_cursor)
        ingestor.cursor_store.begin_batch = Mock(return_value=0)
        
        # Mock database operations
        ingestor._persist_operation = Mock(return_value=True)
        
        stats = ingestor.ingest_incremental(max_operations=1)
        
        self.assertEqual(stats.operations_processed, 1)
        self.assertEqual(stats.operations_ingested, 1)
        self.assertEqual(stats.operations_duplicate, 0)
    
    def test_backfill_validation(self):
        ingestor = AccountOperationIngestor()
        
        # Test with from_ledger
        with patch.object(ingestor, '_fetch_operations_with_retry') as mock_fetch:
            mock_fetch.return_value = ([], None)
            
            mock_cursor = Mock()
            mock_cursor.last_ingested_ledger = 0
            ingestor.cursor_store.get_or_create = Mock(return_value=mock_cursor)
            ingestor.cursor_store.begin_batch = Mock(return_value=0)
            
            stats = ingestor.backfill(from_ledger=50, max_operations=1)
            
            self.assertEqual(stats.start_ledger, 50)
    
    def test_get_ingestion_status(self):
        ingestor = AccountOperationIngestor()
        
        mock_cursor = {
            "stream_id": "account_ops:global",
            "last_ingested_ledger": 100,
            "safe_ledger": 100,
            "last_event_id": "12345",
            "status": "idle",
            "error_message": None,
            "updated_at": "2024-01-01T12:00:00Z",
        }
        ingestor.cursor_store.get_cursor = Mock(return_value=mock_cursor)
        
        status = ingestor.get_ingestion_status()
        
        self.assertEqual(status["stream_id"], "account_ops:global")
        self.assertEqual(status["last_ingested_ledger"], 100)
        self.assertEqual(status["status"], "idle")
    
    def test_get_ingestion_status_not_initialized(self):
        ingestor = AccountOperationIngestor()
        
        ingestor.cursor_store.get_cursor = Mock(return_value=None)
        
        status = ingestor.get_ingestion_status()
        
        self.assertEqual(status["status"], "not_initialized")
        self.assertIn("No cursor found", status["message"])


class TestConvenienceFunctions(unittest.TestCase):
    """Test convenience functions."""
    
    @patch("src.ingestion.account_operation_ingestor.AccountOperationIngestor")
    def test_ingest_account_operations_incremental(self, mock_ingestor_class):
        mock_ingestor = Mock()
        mock_ingestor_class.return_value = mock_ingestor
        
        stats = Mock()
        stats.to_dict.return_value = {"operations_processed": 10}
        mock_ingestor.ingest_incremental.return_value = stats
        
        result = ingest_account_operations()
        
        self.assertEqual(result["operations_processed"], 10)
        mock_ingestor.ingest_incremental.assert_called_once()
    
    @patch("src.ingestion.account_operation_ingestor.AccountOperationIngestor")
    def test_ingest_account_operations_backfill(self, mock_ingestor_class):
        mock_ingestor = Mock()
        mock_ingestor_class.return_value = mock_ingestor
        
        stats = Mock()
        stats.to_dict.return_value = {"operations_processed": 50}
        mock_ingestor.backfill.return_value = stats
        
        result = ingest_account_operations(from_ledger=100)
        
        self.assertEqual(result["operations_processed"], 50)
        mock_ingestor.backfill.assert_called_once_with(
            account_id=None,
            from_ledger=100,
            to_ledger=None,
            max_operations=None,
        )
    
    @patch("src.ingestion.account_operation_ingestor.AccountOperationIngestor")
    def test_get_ingestion_status(self, mock_ingestor_class):
        mock_ingestor = Mock()
        mock_ingestor_class.return_value = mock_ingestor
        mock_ingestor.get_ingestion_status.return_value = {"status": "idle"}
        
        result = get_ingestion_status()
        
        self.assertEqual(result["status"], "idle")
        mock_ingestor.get_ingestion_status.assert_called_once()


if __name__ == "__main__":
    unittest.main()