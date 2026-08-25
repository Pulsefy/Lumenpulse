"""
Tests for KPI Computer module.
"""

from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import MagicMock, patch

from src.kpi_computer import (
    KPIComputer,
    KPIEvent,
    KPIState,
    EventOperation,
    compute_protocol_kpis,
    get_current_kpis,
    get_kpi_history,
)


class TestKPIEvent:
    """Tests for KPIEvent dataclass."""
    
    def test_kpi_event_creation(self):
        event = KPIEvent(
            contract_id="test_contract",
            event_id="event_123",
            ledger=100,
            event_type="deposit",
            operation=EventOperation.DEPOSIT,
            project_id=1,
            contributor="GABC123",
            amount=Decimal("100.0"),
            timestamp=datetime.now(timezone.utc),
            raw_payload={},
        )
        
        assert event.contract_id == "test_contract"
        assert event.event_id == "event_123"
        assert event.ledger == 100
        assert event.operation == EventOperation.DEPOSIT
        assert event.project_id == 1
        assert event.contributor == "GABC123"
        assert event.amount == Decimal("100.0")
    
    def test_kpi_event_to_dict(self):
        event = KPIEvent(
            contract_id="test_contract",
            event_id="event_123",
            ledger=100,
            event_type="deposit",
            operation=EventOperation.DEPOSIT,
            project_id=1,
            contributor="GABC123",
            amount=Decimal("100.0"),
            timestamp=datetime(2024, 1, 1, 12, 0, 0, tzinfo=timezone.utc),
            raw_payload={},
            is_correction=True,
            correction_event_id="event_122",
        )
        
        d = event.to_dict()
        assert d["contract_id"] == "test_contract"
        assert d["event_id"] == "event_123"
        assert d["operation"] == "deposit"
        assert d["amount"] == "100.0"
        assert d["is_correction"] is True


class TestKPIState:
    """Tests for KPIState dataclass."""
    
    def test_kpi_state_creation(self):
        state = KPIState(
            timestamp=datetime.now(timezone.utc),
            tvl=Decimal("1000.0"),
            cumulative_volume=Decimal("500.0"),
            contribution_count=10,
            unique_contributors={"GABC123", "GABC456"},
            active_rounds=2,
            project_states={1: Decimal("100.0"), 2: Decimal("200.0")},
        )
        
        assert state.tvl == Decimal("1000.0")
        assert state.cumulative_volume == Decimal("500.0")
        assert state.contribution_count == 10
        assert len(state.unique_contributors) == 2
        assert state.active_rounds == 2
    
    def test_kpi_state_to_dict(self):
        state = KPIState(
            timestamp=datetime(2024, 1, 1, 12, 0, 0, tzinfo=timezone.utc),
            tvl=Decimal("1000.0"),
            cumulative_volume=Decimal("500.0"),
            contribution_count=10,
            unique_contributors={"GABC123"},
            active_rounds=2,
            project_states={1: Decimal("100.0")},
        )
        
        d = state.to_dict()
        assert d["tvl"] == 1000.0
        assert d["cumulative_volume"] == 500.0
        assert d["contribution_count"] == 10
        assert d["unique_contributors"] == 1
        assert d["active_rounds"] == 2


class TestKPIComputer:
    """Tests for KPIComputer class."""
    
    @patch("src.kpi_computer.PostgresService")
    def test_kpi_computer_init(self, mock_db_service):
        computer = KPIComputer(contract_id="test_contract")
        assert computer.contract_id == "test_contract"
        assert computer.decimals == 7
        assert computer.scaling_factor == Decimal(10 ** 7)
    
    def test_determine_operation(self):
        computer = KPIComputer()
        
        # Test direct event_type mapping
        assert computer._determine_operation("deposit", {}) == EventOperation.DEPOSIT
        assert computer._determine_operation("withdraw", {}) == EventOperation.WITHDRAW
        assert computer._determine_operation("contribution", {}) == EventOperation.CONTRIBUTION
        assert computer._determine_operation("milestone", {}) == EventOperation.MILESTONE
        
        # Test inference from raw_data
        assert computer._determine_operation("unknown", {"operation": "deposit"}) == EventOperation.DEPOSIT
        assert computer._determine_operation("unknown", {"total_deposited": 100}) == EventOperation.DEPOSIT
        
        # Test fallback
        assert computer._determine_operation("unknown", {}) is None
    
    def test_extract_amount(self):
        computer = KPIComputer()
        
        # Test direct amount field
        amount = computer._extract_amount({"amount": 1000}, EventOperation.DEPOSIT)
        assert amount == Decimal("0.0001")  # 1000 / 10^7
        
        # Test string amount
        amount = computer._extract_amount({"amount": "1000"}, EventOperation.DEPOSIT)
        assert amount == Decimal("0.0001")
        
        # Test nested data
        amount = computer._extract_amount({"data": {"amount": 1000}}, EventOperation.DEPOSIT)
        assert amount == Decimal("0.0001")
        
        # Test fallback
        amount = computer._extract_amount({}, EventOperation.DEPOSIT)
        assert amount is None
    
    def test_extract_project_id(self):
        computer = KPIComputer()
        
        # Test direct field
        project_id = computer._extract_project_id({"project_id": 42})
        assert project_id == 42
        
        # Test string project_id
        project_id = computer._extract_project_id({"project_id": "42"})
        assert project_id == 42
        
        # Test nested
        project_id = computer._extract_project_id({"data": {"project_id": 42}})
        assert project_id == 42
        
        # Test fallback
        project_id = computer._extract_project_id({})
        assert project_id is None
    
    def test_extract_contributor(self):
        computer = KPIComputer()
        
        # Test direct field
        contributor = computer._extract_contributor({"contributor": "GABC1234567890123456789012345678901234567890123456789012"})
        assert contributor == "GABC1234567890123456789012345678901234567890123456789012"
        
        # Test nested
        contributor = computer._extract_contributor({"data": {"contributor": "GABC1234567890123456789012345678901234567890123456789012"}})
        assert contributor == "GABC1234567890123456789012345678901234567890123456789012"
        
        # Test fallback (short address)
        contributor = computer._extract_contributor({"contributor": "short"})
        assert contributor is None
    
    def test_apply_event_to_state(self):
        computer = KPIComputer()
        
        # Test deposit event
        state = KPIState(
            timestamp=datetime.now(timezone.utc),
            tvl=Decimal("0"),
            cumulative_volume=Decimal("0"),
            contribution_count=0,
            unique_contributors=set(),
            active_rounds=0,
            project_states={},
        )
        
        event = KPIEvent(
            contract_id="test",
            event_id="e1",
            ledger=1,
            event_type="deposit",
            operation=EventOperation.DEPOSIT,
            project_id=1,
            contributor="GABC123",
            amount=Decimal("100.0"),
            timestamp=datetime.now(timezone.utc),
            raw_payload={},
        )
        
        computer._apply_event_to_state(state, event)
        
        assert state.tvl == Decimal("100.0")
        assert state.cumulative_volume == Decimal("100.0")
        assert state.contribution_count == 1
        assert len(state.unique_contributors) == 1
        assert state.active_rounds == 1
        assert state.project_states[1] == Decimal("100.0")
        
        # Test withdraw event
        withdraw_event = KPIEvent(
            contract_id="test",
            event_id="e2",
            ledger=2,
            event_type="withdraw",
            operation=EventOperation.WITHDRAW,
            project_id=1,
            contributor=None,
            amount=Decimal("50.0"),
            timestamp=datetime.now(timezone.utc),
            raw_payload={},
        )
        
        computer._apply_event_to_state(state, withdraw_event)
        
        assert state.tvl == Decimal("50.0")
        assert state.cumulative_volume == Decimal("100.0")  # Withdrawals don't affect volume
        assert state.active_rounds == 1
        assert state.project_states[1] == Decimal("50.0")
    
    def test_empty_state(self):
        computer = KPIComputer()
        timestamp = datetime.now(timezone.utc)
        state = computer._empty_state(timestamp)
        
        assert state.timestamp == timestamp
        assert state.tvl == Decimal("0")
        assert state.cumulative_volume == Decimal("0")
        assert state.contribution_count == 0
        assert len(state.unique_contributors) == 0
        assert state.active_rounds == 0
        assert len(state.project_states) == 0


class TestComputeFunctions:
    """Tests for convenience compute functions."""
    
    @patch("src.kpi_computer.KPIComputer")
    def test_compute_protocol_kpis(self, mock_computer_class):
        mock_computer = MagicMock()
        mock_computer_class.return_value = mock_computer
        
        mock_computer.compute_kpis.return_value = (
            KPIState(
                timestamp=datetime.now(timezone.utc),
                tvl=Decimal("1000.0"),
                cumulative_volume=Decimal("500.0"),
                contribution_count=10,
                unique_contributors=set(),
                active_rounds=2,
                project_states={},
            ),
            [],
        )
        
        final_state, series = compute_protocol_kpis()
        
        assert final_state["tvl"] == 1000.0
        assert final_state["cumulative_volume"] == 500.0
        assert final_state["contribution_count"] == 10
    
    @patch("src.kpi_computer.KPIComputer")
    def test_get_current_kpis(self, mock_computer_class):
        mock_computer = MagicMock()
        mock_computer_class.return_value = mock_computer
        
        mock_computer.get_latest_kpis.return_value = {
            "tvl": 1000.0,
            "volume": 500.0,
            "active_rounds": 2,
            "contribution_count": 10,
            "unique_contributors": 5,
            "snapshot_date": "2024-01-01",
        }
        
        result = get_current_kpis()
        assert result is not None
        assert result["tvl"] == 1000.0
    
    @patch("src.kpi_computer.KPIComputer")
    def test_get_kpi_history(self, mock_computer_class):
        mock_computer = MagicMock()
        mock_computer_class.return_value = mock_computer
        
        mock_computer.get_kpi_series.return_value = [
            {"date": "2024-01-01", "tvl": 1000.0, "volume": 500.0},
            {"date": "2024-01-02", "tvl": 1100.0, "volume": 600.0},
        ]
        
        result = get_kpi_history()
        assert len(result) == 2
        assert result[0]["tvl"] == 1000.0
        assert result[1]["tvl"] == 1100.0