"""
Tests for LedgerRangeExporter (issue #883).
"""

import json
import os
import sys
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Stub out heavy dependencies before importing our module
# ---------------------------------------------------------------------------
for _mod in [
    "sqlalchemy",
    "sqlalchemy.orm",
    "src.db",
    "src.db.models",
]:
    if _mod not in sys.modules:
        sys.modules[_mod] = MagicMock()

import sqlalchemy as _sa

_sa.create_engine = MagicMock()
_sa.select = MagicMock(return_value=MagicMock())
_sa.and_ = MagicMock(return_value=MagicMock())

import sqlalchemy.orm as _orm

_orm.sessionmaker = MagicMock()

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

_models_mock = sys.modules["src.db.models"]
_models_mock.ContractEvent = MagicMock()
_models_mock.ProjectView = MagicMock()
_models_mock.ProjectContributor = MagicMock()
_models_mock.ProjectMilestone = MagicMock()

from src.ledger_export import (  # noqa: E402
    EXPORT_VERSION,
    LedgerExportResult,
    LedgerRangeExporter,
    _validate_ledger_range,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_exporter(tmp_path, start=1000, end=2000):
    with patch("src.ledger_export.create_engine"), patch("src.ledger_export.sessionmaker"):
        return LedgerRangeExporter(
            start_ledger=start,
            end_ledger=end,
            output_dir=str(tmp_path),
            database_url="postgresql://mock/mock",
        )


def _mock_session(exporter, raw_rows=None, view_rows=None, contrib_rows=None, milestone_rows=None):
    """
    Attach a mock session that returns specified rows for each query and
    patch _ledger_range_filter to return a dummy MagicMock (avoids
    MagicMock comparison issues with SQLAlchemy column mocks).
    """
    mock_session = MagicMock()
    mock_session.__enter__ = MagicMock(return_value=mock_session)
    mock_session.__exit__ = MagicMock(return_value=False)

    all_results = [
        raw_rows or [],
        view_rows or [],
        contrib_rows or [],
        milestone_rows or [],
    ]
    mock_session.execute.return_value.scalars.return_value.all.side_effect = all_results
    exporter.Session = MagicMock(return_value=mock_session)
    # Bypass SQLAlchemy column comparisons entirely
    exporter._ledger_range_filter = MagicMock(return_value=MagicMock())
    return mock_session


def _fake_contract_event(ledger=1500):
    r = MagicMock()
    r.id = 1
    r.contract_id = "CABC"
    r.event_id = "evt-1"
    r.ledger = ledger
    r.event_type = "contribution"
    r.project_id = 42
    r.contributor = "GBOB"
    r.amount = 100.0
    r.milestone_id = None
    r.status = "active"
    r.topics = []
    r.raw_data = {"key": "value"}
    r.timestamp = datetime(2024, 1, 1, tzinfo=timezone.utc)
    return r


def _fake_project_view(ledger=1500):
    v = MagicMock()
    v.id = 1
    v.project_id = 42
    v.contract_id = "CABC"
    v.owner = "GALICE"
    v.total_contributions = 100.0
    v.unique_contributors = 1
    v.status = "active"
    v.last_event_ledger = ledger
    v.extra_data = {}
    return v


def _fake_contributor(ledger=1500):
    c = MagicMock()
    c.id = 1
    c.project_id = 42
    c.contributor = "GBOB"
    c.total_contributed = 100.0
    c.first_contribution_ledger = ledger
    c.last_contribution_ledger = ledger
    c.extra_data = {}
    return c


def _fake_milestone(ledger=1500):
    m = MagicMock()
    m.id = 1
    m.project_id = 42
    m.milestone_id = 1
    m.status = "pending"
    m.approved_at = None
    m.last_event_ledger = ledger
    m.extra_data = {}
    return m


# ---------------------------------------------------------------------------
# Tests: _validate_ledger_range
# ---------------------------------------------------------------------------


class TestValidateLedgerRange:
    def test_valid_range(self):
        _validate_ledger_range(1000, 2000)  # no exception

    def test_start_equals_end(self):
        _validate_ledger_range(500, 500)  # single-ledger range is valid

    def test_start_greater_than_end_raises(self):
        with pytest.raises(ValueError, match="must be <="):
            _validate_ledger_range(2000, 1000)

    def test_negative_ledger_raises(self):
        with pytest.raises(ValueError, match="non-negative"):
            _validate_ledger_range(-1, 100)

    def test_non_integer_raises(self):
        with pytest.raises(TypeError):
            _validate_ledger_range("1000", 2000)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Tests: LedgerExportResult
# ---------------------------------------------------------------------------


class TestLedgerExportResult:
    def test_to_dict(self):
        r = LedgerExportResult(
            path="/tmp/ledger_export_1000_2000.json",
            start_ledger=1000,
            end_ledger=2000,
            raw_count=3,
            normalized_counts={"project_views": 1, "project_contributors": 1, "project_milestones": 0},
            status="completed",
        )
        d = r.to_dict()
        assert d["raw_count"] == 3
        assert d["status"] == "completed"
        assert d["normalized_counts"]["project_views"] == 1


# ---------------------------------------------------------------------------
# Tests: LedgerRangeExporter initialisation
# ---------------------------------------------------------------------------


class TestLedgerRangeExporterInit:
    def test_output_dir_created(self, tmp_path):
        out = tmp_path / "nested" / "debug"
        with patch("src.ledger_export.create_engine"), patch("src.ledger_export.sessionmaker"):
            LedgerRangeExporter(1000, 2000, str(out), database_url="postgresql://mock/mock")
        assert out.exists()

    def test_ledger_range_stored(self, tmp_path):
        exporter = _make_exporter(tmp_path, start=500, end=999)
        assert exporter.start_ledger == 500
        assert exporter.end_ledger == 999

    def test_invalid_range_raises_on_init(self, tmp_path):
        with pytest.raises(ValueError):
            with patch("src.ledger_export.create_engine"), patch("src.ledger_export.sessionmaker"):
                LedgerRangeExporter(2000, 1000, str(tmp_path), database_url="postgresql://mock/mock")


# ---------------------------------------------------------------------------
# Tests: export() — output file structure
# ---------------------------------------------------------------------------


class TestExport:
    def test_writes_json_file(self, tmp_path):
        exporter = _make_exporter(tmp_path)
        _mock_session(exporter, raw_rows=[_fake_contract_event()])

        exporter.export()

        assert (tmp_path / "ledger_export_1000_2000.json").exists()

    def test_metadata_fields(self, tmp_path):
        exporter = _make_exporter(tmp_path)
        _mock_session(exporter)

        exporter.export()

        data = json.loads((tmp_path / "ledger_export_1000_2000.json").read_text())
        meta = data["metadata"]
        assert meta["startLedger"] == 1000
        assert meta["endLedger"] == 2000
        assert meta["exportVersion"] == EXPORT_VERSION
        assert "exportTimestamp" in meta

    def test_raw_section_contains_contract_events(self, tmp_path):
        exporter = _make_exporter(tmp_path)
        _mock_session(exporter, raw_rows=[_fake_contract_event(1500)])

        exporter.export()

        data = json.loads((tmp_path / "ledger_export_1000_2000.json").read_text())
        assert len(data["raw"]) == 1
        assert data["raw"][0]["ledger"] == 1500
        assert data["raw"][0]["event_type"] == "contribution"

    def test_normalized_section_structure(self, tmp_path):
        exporter = _make_exporter(tmp_path)
        _mock_session(
            exporter,
            view_rows=[_fake_project_view()],
            contrib_rows=[_fake_contributor()],
            milestone_rows=[_fake_milestone()],
        )

        exporter.export()

        data = json.loads((tmp_path / "ledger_export_1000_2000.json").read_text())
        norm = data["normalized"]
        assert "project_views" in norm
        assert "project_contributors" in norm
        assert "project_milestones" in norm
        assert len(norm["project_views"]) == 1
        assert norm["project_views"][0]["project_id"] == 42

    def test_returns_export_result(self, tmp_path):
        exporter = _make_exporter(tmp_path)
        _mock_session(exporter)

        result = exporter.export()

        assert isinstance(result, LedgerExportResult)
        assert result.status == "completed"
        assert result.start_ledger == 1000
        assert result.end_ledger == 2000

    def test_result_counts_match_data(self, tmp_path):
        exporter = _make_exporter(tmp_path)
        _mock_session(
            exporter,
            raw_rows=[_fake_contract_event(), _fake_contract_event()],
            view_rows=[_fake_project_view()],
        )

        result = exporter.export()

        assert result.raw_count == 2
        assert result.normalized_counts["project_views"] == 1
        assert result.normalized_counts["project_contributors"] == 0

    def test_empty_range_exports_zero_records(self, tmp_path):
        exporter = _make_exporter(tmp_path, start=9999, end=9999)
        _mock_session(exporter)

        result = exporter.export()

        assert result.raw_count == 0
        assert all(v == 0 for v in result.normalized_counts.values())

    def test_start_equals_end_single_ledger(self, tmp_path):
        exporter = _make_exporter(tmp_path, start=500, end=500)
        _mock_session(exporter, raw_rows=[_fake_contract_event(ledger=500)])

        result = exporter.export()

        assert result.raw_count == 1
        data = json.loads((tmp_path / "ledger_export_500_500.json").read_text())
        assert data["metadata"]["startLedger"] == 500
        assert data["metadata"]["endLedger"] == 500

    def test_repeated_execution_overwrites_file(self, tmp_path):
        """Running export twice must produce a valid file (idempotent)."""
        exporter = _make_exporter(tmp_path)

        for _ in range(2):
            _mock_session(exporter, raw_rows=[_fake_contract_event()])
            exporter.export()

        data = json.loads((tmp_path / "ledger_export_1000_2000.json").read_text())
        assert data["metadata"]["startLedger"] == 1000

    def test_missing_ledger_data_does_not_crash(self, tmp_path):
        """Empty DB (no rows) must not raise an exception."""
        exporter = _make_exporter(tmp_path)
        _mock_session(exporter)  # all side_effect lists are empty

        result = exporter.export()  # must not raise

        assert result.status == "completed"

    def test_raw_and_normalized_ledger_coverage(self, tmp_path):
        """Events and normalized state both reference the same ledger."""
        exporter = _make_exporter(tmp_path, start=1500, end=1500)
        _mock_session(
            exporter,
            raw_rows=[_fake_contract_event(ledger=1500)],
            view_rows=[_fake_project_view(ledger=1500)],
        )

        exporter.export()

        data = json.loads((tmp_path / "ledger_export_1500_1500.json").read_text())
        assert data["raw"][0]["ledger"] == 1500
        assert data["normalized"]["project_views"][0]["last_event_ledger"] == 1500
