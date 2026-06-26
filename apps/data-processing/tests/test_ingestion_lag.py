import pytest
from unittest.mock import MagicMock, patch
from datetime import datetime, timezone
from fastapi.testclient import TestClient
from prometheus_client import REGISTRY

from src.utils.metrics import (
    INGESTION_LAG_LEDGERS,
    INGESTION_LAG_SECONDS,
    update_ingestion_lag_metrics,
)
from src.db.models import StellarSyncCheckpoint


class MockCheckpoint:
    def __init__(self, type_name, cursor, updatedAt=None):
        self.type = type_name
        self.cursor = cursor
        self.updatedAt = updatedAt or datetime.now(timezone.utc)


@pytest.fixture
def mock_db_service():
    service = MagicMock()
    session = MagicMock()
    service.get_session.return_value.__enter__.return_value = session
    return service, session


@patch("src.utils.metrics.get_latest_ledger_sequence")
def test_update_ingestion_lag_metrics(mock_get_seq, mock_db_service):
    service, session = mock_db_service
    mock_get_seq.return_value = 1000100

    checkpoints = [
        MockCheckpoint("registry", "1000000"),
        MockCheckpoint("vault", "1000050"),
        MockCheckpoint("matching_pool", "1000080"),
        MockCheckpoint("treasury", "1000090"),
        MockCheckpoint("vesting", "1000095"),
    ]
    
    session.query.return_value.filter_by.side_effect = lambda type: MagicMock(
        first=lambda: next((c for c in checkpoints if c.type == type), None)
    )

    update_ingestion_lag_metrics(service)

    # Assert Prometheus metrics are updated correctly
    assert REGISTRY.get_sample_value('lumenpulse_ingestion_lag_ledgers', {'domain': 'registry'}) == 100.0
    assert REGISTRY.get_sample_value('lumenpulse_ingestion_lag_ledgers', {'domain': 'vault'}) == 50.0
    assert REGISTRY.get_sample_value('lumenpulse_ingestion_lag_ledgers', {'domain': 'matching_pool'}) == 20.0
    assert REGISTRY.get_sample_value('lumenpulse_ingestion_lag_ledgers', {'domain': 'treasury'}) == 10.0
    assert REGISTRY.get_sample_value('lumenpulse_ingestion_lag_ledgers', {'domain': 'vesting'}) == 5.0


@patch("src.utils.metrics.get_latest_ledger_sequence")
def test_update_ingestion_lag_seeding(mock_get_seq, mock_db_service):
    service, session = mock_db_service
    mock_get_seq.return_value = 1000100

    session.query.return_value.filter_by.return_value.first.return_value = None

    update_ingestion_lag_metrics(service)

    # Verify session.add was called for seeding
    assert session.add.call_count == 5


def test_ingestion_lag_endpoint():
    mock_db = MagicMock()
    session = MagicMock()
    mock_db.get_session.return_value.__enter__.return_value = session

    checkpoints = [
        MockCheckpoint("registry", "1000000"),
        MockCheckpoint("vault", "1000050"),
        MockCheckpoint("matching_pool", "1000080"),
        MockCheckpoint("treasury", "1000090"),
        MockCheckpoint("vesting", "1000095"),
    ]
    
    session.query.return_value.filter_by.side_effect = lambda type: MagicMock(
        first=lambda: next((c for c in checkpoints if c.type == type), None)
    )

    with (
        patch("src.api.server.postgres_service", mock_db),
        patch("src.utils.metrics.get_latest_ledger_sequence", return_value=1000100),
        patch("src.api.server.security_config") as mock_sec,
        patch("src.api.server.setup_security_middleware"),
        patch("src.api.server.setup_rate_limiter"),
    ):
        mock_sec.limiter = None
        
        import src.api.server as srv_module
        from importlib import reload
        reload(srv_module)
        
        client = TestClient(srv_module.app)
        response = client.get("/ingestion/lag")
        
        assert response.status_code == 200
        data = response.json()
        assert data["latest_ledger"] == 1000100
        assert data["lags"]["registry"]["lag_ledgers"] == 100
        assert data["lags"]["vault"]["lag_ledgers"] == 50
        assert data["lags"]["matching_pool"]["lag_ledgers"] == 20
        assert data["lags"]["treasury"]["lag_ledgers"] == 10
        assert data["lags"]["vesting"]["lag_ledgers"] == 5
