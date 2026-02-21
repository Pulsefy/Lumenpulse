"""
Unit tests for StellarDataFetcher.
"""

import unittest
from unittest.mock import Mock, patch, MagicMock
from datetime import datetime, timedelta
import sys
import os

# Add the src directory to the Python path
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

# Mock stellar_sdk before importing our module
try:
    from src.ingestion.stellar_fetcher import (
        StellarDataFetcher,
        VolumeData,
        TransactionRecord,
    )
except ImportError as e:
    print(f"Import error: {e}")

    # Create mock classes for testing if import fails
    class MockVolumeData:
        pass

    class MockTransactionRecord:
        pass

    class MockStellarDataFetcher:
        pass

    VolumeData = MockVolumeData
    TransactionRecord = MockTransactionRecord
    StellarDataFetcher = MockStellarDataFetcher


class TestStellarDataFetcher(unittest.TestCase):
    """Test cases for StellarDataFetcher functionality"""

    def setUp(self):
        """Set up test environment"""
        # Mock responses
        self.mock_transaction_response = {
            "_embedded": {
                "records": [
                    {
                        "id": "123",
                        "hash": "abc123",
                        "created_at": "2023-01-01T12:00:00Z",
                        "source_account": "GABC123",
                        "operation_count": 1,
                        "fee_charged": "100",
                        "memo": "test",
                        "successful": True,
                    }
                ]
            },
            "_links": {
                "next": {"href": "https://horizon.stellar.org/transactions?cursor=123"}
            },
        }

        self.mock_payment_response = {
            "_embedded": {
                "records": [
                    {
                        "id": "pay123",
                        "created_at": "2023-01-01T12:00:00Z",
                        "amount": "100.5",
                        "asset_type": "native",
                        "source_account": "GABC123",
                    }
                ]
            }
        }

    # @patch('stellar_sdk.Server')
    # def test_initialization(self, mock_server_class):
    #     """Test fetcher initialization"""
    #     # Test with default URL
    #     fetcher = StellarDataFetcher()
    #     mock_server_class.assert_called_once()

    #     # Test with testnet
    #     fetcher = StellarDataFetcher(network="testnet")
    #     self.assertTrue("testnet" in str(mock_server_class.call_args))

    def test_volume_data_to_dict(self):
        """Test VolumeData serialization"""
        now = datetime.now()
        volume_data = VolumeData(
            asset_code="XLM",
            asset_issuer=None,
            time_period_hours=24,
            total_volume=1500.5,
            transaction_count=25,
            start_time=now - timedelta(hours=24),
            end_time=now,
            volume_by_hour={"hour_0": 100.0, "hour_23": 50.0},
        )

        data_dict = volume_data.to_dict()

        self.assertIsInstance(data_dict, dict)
        self.assertEqual(data_dict["asset_code"], "XLM")
        self.assertEqual(data_dict["total_volume"], 1500.5)
        self.assertEqual(data_dict["transaction_count"], 25)
        self.assertIn("average_hourly_volume", data_dict)
        self.assertAlmostEqual(data_dict["average_hourly_volume"], 1500.5 / 24)

    def test_transaction_record_to_dict(self):
        """Test TransactionRecord serialization"""
        transaction = TransactionRecord(
            id="123",
            hash="abc123",
            created_at=datetime(2023, 1, 1, 12, 0, 0),
            source_account="GABC123",
            operation_count=1,
            total_amount=0.00001,
            fee_charged=0.00001,
            memo="test",
            successful=True,
        )

        data_dict = transaction.to_dict()

        self.assertIsInstance(data_dict, dict)
        self.assertEqual(data_dict["id"], "123")
        self.assertEqual(data_dict["hash"], "abc123")
        self.assertEqual(data_dict["source_account"], "GABC123")
        self.assertIn("created_at", data_dict)
        self.assertEqual(data_dict["created_at"], "2023-01-01T12:00:00")

    # @patch('stellar_sdk.Server')
    # def test_cache_mechanism(self, mock_server_class):
    #     """Test caching functionality"""
    #     # Skip if we can't import properly
    #     if hasattr(StellarDataFetcher, '__module__') and 'Mock' in StellarDataFetcher.__module__:
    #         self.skipTest("Skipping due to import issues")

    #     # Create mock server
    #     mock_server = Mock()
    #     mock_server_class.return_value = mock_server

    #     # Mock responses
    #     mock_server.payments.return_value = Mock()
    #     mock_server.trades.return_value = Mock()

    #     # Create fetcher
    #     fetcher = StellarDataFetcher()

    #     # Set up mock return values
    #     mock_server.payments.return_value.order.return_value.limit.return_value.for_asset.return_value = Mock()

    #     # Mock the pagination handler to return empty list
    #     with patch.object(fetcher, '_handle_pagination', return_value=[]):
    #         # First call should fetch from API
    #         volume1 = fetcher.get_asset_volume("XLM", hours=1)

    #         # Verify cache was populated
    #         self.assertGreater(len(fetcher.cache), 0)

    #         # Clear cache and fetch again
    #         fetcher.clear_cache()
    #         self.assertEqual(len(fetcher.cache), 0)


class TestVolumeData(unittest.TestCase):
    """Test VolumeData dataclass"""

    def test_volume_data_creation(self):
        """Test VolumeData instantiation"""
        now = datetime.now()
        volume_data = VolumeData(
            asset_code="XLM",
            asset_issuer=None,
            time_period_hours=24,
            total_volume=1000.5,
            transaction_count=50,
            start_time=now - timedelta(hours=24),
            end_time=now,
            volume_by_hour={"hour_0": 100.0},
        )

        self.assertEqual(volume_data.asset_code, "XLM")
        self.assertEqual(volume_data.total_volume, 1000.5)
        self.assertEqual(volume_data.transaction_count, 50)
        self.assertIn("hour_0", volume_data.volume_by_hour)


class TestTransactionRecord(unittest.TestCase):
    """Test TransactionRecord dataclass"""

    def test_transaction_record_creation(self):
        """Test TransactionRecord instantiation"""
        tx_time = datetime(2023, 1, 1, 12, 0, 0)
        transaction = TransactionRecord(
            id="tx123",
            hash="abc123",
            created_at=tx_time,
            source_account="GABC123",
            operation_count=2,
            total_amount=0.00002,
            fee_charged=0.00001,
            memo="Payment",
            successful=True,
        )

        self.assertEqual(transaction.id, "tx123")
        self.assertEqual(transaction.hash, "abc123")
        self.assertEqual(transaction.source_account, "GABC123")
        self.assertEqual(transaction.operation_count, 2)
        self.assertEqual(transaction.total_amount, 0.00002)
        self.assertEqual(transaction.fee_charged, 0.00001)
        self.assertEqual(transaction.memo, "Payment")
        self.assertTrue(transaction.successful)


if __name__ == "__main__":
    unittest.main()
