"""Unit tests for contract lag tracking module.

Tests the contract_lag_tracker module's core functionality:
- Lag measurement
- Severity calculation
- Threshold management
- Prometheus metrics publication
"""

import pytest
import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from sqlalchemy import Column, String, Integer, BigInteger, DateTime
from sqlalchemy.orm import declarative_base

from src.ingestion.contract_lag_tracker import (
    measure_contract_lag,
    measure_all_contract_lags,
    run_contract_lag_cycle,
    _get_thresholds,
    _severity_for_lag,
    _get_default_thresholds,
    _contract_to_domain_mapping,
    _get_domain_for_contract,
    AlertSeverity,
    ContractLagSnapshot,
    CONTRACT_DOMAINS,
    get_contract_domain_config,
)


class TestThresholdManagement:
    """Test threshold configuration and retrieval."""

    def test_get_default_thresholds(self):
        """Test default thresholds for each domain."""
        # Registry: 5min warning / 15min critical
        assert _get_default_thresholds("registry") == {
            "warning": 300.0,
            "critical": 900.0,
        }
        
        # Vault: 10min warning / 30min critical
        assert _get_default_thresholds("vault") == {
            "warning": 600.0,
            "critical": 1800.0,
        }
        
        # Matching Pool: 5min warning / 20min critical
        assert _get_default_thresholds("matching_pool") == {
            "warning": 300.0,
            "critical": 1200.0,
        }
        
        # Treasury: 10min warning / 30min critical
        assert _get_default_thresholds("treasury") == {
            "warning": 600.0,
            "critical": 1800.0,
        }
        
        # Vesting: 15min warning / 45min critical
        assert _get_default_thresholds("vesting") == {
            "warning": 900.0,
            "critical": 2700.0,
        }
        
        # Unknown domain gets safe defaults
        assert _get_default_thresholds("unknown") == {
            "warning": 600.0,
            "critical": 1800.0,
        }

    @patch.dict("os.environ", {"REGISTRY_LAG_WARNING_SECONDS": "180"})
    def test_get_thresholds_with_env_override(self):
        """Test threshold override from environment variables."""
        thresholds = _get_thresholds("registry")
        assert thresholds["warning"] == 180.0
        assert thresholds["critical"] == 900.0  # Uses default

    def test_contract_domain_mapping(self):
        """Test contract ID to domain mapping."""
        with patch.dict(
            "os.environ",
            {
                "CONTRACT_REGISTRY": "CA111",
                "CONTRACT_VAULT": "CA222",
                "CONTRACT_MATCHING_POOL": "CA333",
                "CONTRACT_TREASURY": "CA444",
                "CONTRACT_VESTING": "CA555",
            },
        ):
            mapping = _contract_to_domain_mapping()
            assert mapping["CA111"] == "registry"
            assert mapping["CA222"] == "vault"
            assert mapping["CA333"] == "matching_pool"
            assert mapping["CA444"] == "treasury"
            assert mapping["CA555"] == "vesting"

    @patch.dict(
        "os.environ",
        {"CONTRACT_REGISTRY": "CA111", "CONTRACT_VAULT": "CA222"},
    )
    def test_get_domain_for_contract(self):
        """Test domain lookup by contract ID."""
        assert _get_domain_for_contract("CA111") == "registry"
        assert _get_domain_for_contract("CA222") == "vault"
        assert _get_domain_for_contract("CA999") is None


class TestSeverityCalculation:
    """Test severity assignment based on lag."""

    def test_severity_healthy(self):
        """Test healthy severity when lag is below warning threshold."""
        severity = _severity_for_lag(100, "registry")
        assert severity == AlertSeverity.HEALTHY

    def test_severity_warning(self):
        """Test warning severity when lag is between warning and critical."""
        # Registry: 300-900
        severity = _severity_for_lag(500, "registry")
        assert severity == AlertSeverity.WARNING

    def test_severity_critical(self):
        """Test critical severity when lag exceeds critical threshold."""
        severity = _severity_for_lag(1000, "registry")
        assert severity == AlertSeverity.CRITICAL

    def test_severity_boundary_warning(self):
        """Test severity at exact warning threshold."""
        severity = _severity_for_lag(300, "registry")
        assert severity == AlertSeverity.WARNING

    def test_severity_boundary_critical(self):
        """Test severity at exact critical threshold."""
        severity = _severity_for_lag(900, "registry")
        assert severity == AlertSeverity.CRITICAL


class TestContractLagSnapshot:
    """Test ContractLagSnapshot data class."""

    def test_snapshot_creation(self):
        """Test creating a lag snapshot."""
        now = datetime.now(timezone.utc)
        snapshot = ContractLagSnapshot(
            contract_domain="registry",
            lag_seconds=123.45,
            severity=AlertSeverity.HEALTHY,
            warning_threshold_seconds=300,
            critical_threshold_seconds=900,
            last_processed_ledger=12345,
            last_processed_timestamp=now,
            event_count=1000,
            details={"contract_id": "CA111"},
        )
        
        assert snapshot.contract_domain == "registry"
        assert snapshot.lag_seconds == 123.45
        assert snapshot.severity == AlertSeverity.HEALTHY
        assert snapshot.last_processed_ledger == 12345
        assert snapshot.event_count == 1000

    def test_snapshot_to_dict(self):
        """Test snapshot serialization to dictionary."""
        now = datetime.now(timezone.utc)
        snapshot = ContractLagSnapshot(
            contract_domain="vault",
            lag_seconds=600.0,
            severity=AlertSeverity.WARNING,
            warning_threshold_seconds=600,
            critical_threshold_seconds=1800,
            last_processed_ledger=54321,
            last_processed_timestamp=now,
            event_count=500,
        )
        
        data = snapshot.to_dict()
        assert data["contract_domain"] == "vault"
        assert data["lag_seconds"] == 600.0
        assert data["severity"] == "warning"
        assert data["last_processed_timestamp"] == now.isoformat()

    def test_snapshot_to_dict_no_timestamp(self):
        """Test snapshot serialization with None timestamp."""
        snapshot = ContractLagSnapshot(
            contract_domain="registry",
            lag_seconds=100.0,
            severity=AlertSeverity.HEALTHY,
            warning_threshold_seconds=300,
            critical_threshold_seconds=900,
            last_processed_ledger=0,
            last_processed_timestamp=None,
            event_count=0,
        )
        
        data = snapshot.to_dict()
        assert data["last_processed_timestamp"] is None


class TestMeasureContractLag:
    """Test contract lag measurement."""

    @pytest.mark.asyncio
    async def test_measure_lag_no_contract_configured(self):
        """Test measurement when contract address is not configured."""
        with patch.dict("os.environ", {}, clear=True):
            db_service = MagicMock()
            result = await measure_contract_lag(db_service, "registry")
            assert result is None

    @pytest.mark.asyncio
    async def test_measure_lag_no_events(self):
        """Test measurement when no events exist for contract."""
        with patch.dict("os.environ", {"CONTRACT_REGISTRY": "CA111"}):
            # Mock database service
            mock_session = AsyncMock()
            mock_result = AsyncMock()
            mock_result.scalar_one_or_none.return_value = None
            mock_session.execute = AsyncMock(return_value=mock_result)
            
            db_service = AsyncMock()
            db_service.async_session = MagicMock(return_value=mock_session)
            db_service.async_session.return_value.__aenter__ = AsyncMock(
                return_value=mock_session
            )
            db_service.async_session.return_value.__aexit__ = AsyncMock(
                return_value=None
            )
            
            result = await measure_contract_lag(db_service, "registry")
            assert result is None

    @pytest.mark.asyncio
    async def test_measure_lag_with_event(self):
        """Test successful lag measurement with event."""
        with patch.dict("os.environ", {"CONTRACT_REGISTRY": "CA111"}):
            # Create mock event
            mock_event = MagicMock()
            mock_event.contract_id = "CA111"
            mock_event.ledger = 1234567
            mock_event.event_id = "ev-123"
            mock_event.event_type = "ProjectCreated"
            
            # Event was 30 seconds ago
            now = datetime.now(timezone.utc)
            mock_event.timestamp = now - timedelta(seconds=30)
            
            # Mock database queries
            mock_session = AsyncMock()
            mock_result_event = AsyncMock()
            mock_result_event.scalar_one_or_none.return_value = mock_event
            
            mock_result_count = AsyncMock()
            mock_result_count.scalar.return_value = 100
            
            async def mock_execute(stmt):
                # Return event on first call, count on second
                if hasattr(stmt, "_from_obj"):
                    return mock_result_count
                return mock_result_event
            
            mock_session.execute = AsyncMock(side_effect=mock_execute)
            
            db_service = AsyncMock()
            db_service.async_session = MagicMock()
            db_service.async_session.return_value.__aenter__ = AsyncMock(
                return_value=mock_session
            )
            db_service.async_session.return_value.__aexit__ = AsyncMock(
                return_value=None
            )
            
            result = await measure_contract_lag(db_service, "registry")
            
            assert result is not None
            assert result.contract_domain == "registry"
            assert result.last_processed_ledger == 1234567
            assert result.event_count == 100
            assert result.severity == AlertSeverity.HEALTHY
            assert 29 < result.lag_seconds < 31  # ~30 seconds


@pytest.mark.asyncio
async def test_measure_all_contract_lags():
    """Test measuring all domains."""
    mock_snapshot = ContractLagSnapshot(
        contract_domain="registry",
        lag_seconds=100,
        severity=AlertSeverity.HEALTHY,
        warning_threshold_seconds=300,
        critical_threshold_seconds=900,
        last_processed_ledger=1000,
        last_processed_timestamp=datetime.now(timezone.utc),
        event_count=100,
    )
    
    db_service = MagicMock()
    
    with patch(
        "src.ingestion.contract_lag_tracker.measure_contract_lag",
        new_callable=AsyncMock,
        return_value=mock_snapshot,
    ):
        results = await measure_all_contract_lags(db_service)
        
        assert len(results) == len(CONTRACT_DOMAINS)
        for domain, snapshot in results.items():
            assert snapshot is not None
            assert snapshot.contract_domain == domain


@pytest.mark.asyncio
async def test_run_contract_lag_cycle():
    """Test full lag measurement cycle."""
    mock_snapshot_healthy = ContractLagSnapshot(
        contract_domain="registry",
        lag_seconds=100,
        severity=AlertSeverity.HEALTHY,
        warning_threshold_seconds=300,
        critical_threshold_seconds=900,
        last_processed_ledger=1000,
        last_processed_timestamp=datetime.now(timezone.utc),
        event_count=100,
    )
    
    mock_snapshot_critical = ContractLagSnapshot(
        contract_domain="vault",
        lag_seconds=2000,
        severity=AlertSeverity.CRITICAL,
        warning_threshold_seconds=600,
        critical_threshold_seconds=1800,
        last_processed_ledger=500,
        last_processed_timestamp=datetime.now(timezone.utc),
        event_count=50,
    )
    
    db_service = MagicMock()
    
    results = {
        "registry": mock_snapshot_healthy,
        "vault": mock_snapshot_critical,
        "matching_pool": None,
        "treasury": mock_snapshot_healthy,
        "vesting": None,
    }
    
    with patch(
        "src.ingestion.contract_lag_tracker.measure_all_contract_lags",
        new_callable=AsyncMock,
        return_value=results,
    ):
        # Should not raise
        await run_contract_lag_cycle(db_service)


def test_get_contract_domain_config():
    """Test configuration export."""
    with patch.dict(
        "os.environ",
        {
            "CONTRACT_REGISTRY": "CA111",
            "CONTRACT_VAULT": "CA222",
            "REGISTRY_LAG_WARNING_SECONDS": "180",
        },
    ):
        config = get_contract_domain_config()
        
        assert "registry" in config
        assert config["registry"]["contract_id"] == "CA111"
        assert config["registry"]["configured"] is True
        assert config["registry"]["warning_threshold_seconds"] == 180.0
        
        assert "vault" in config
        assert config["vault"]["contract_id"] == "CA222"
        assert config["vault"]["configured"] is True
        
        # Unconfigured domain
        assert "matching_pool" in config
        assert config["matching_pool"]["contract_id"] is None
        assert config["matching_pool"]["configured"] is False


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
