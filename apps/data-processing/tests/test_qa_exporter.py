"""
Tests for QAExporter (issue #742).
"""

import json
import sys
import os
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Stub out heavy dependencies before importing our module
# ---------------------------------------------------------------------------
for _mod in [
    "sqlalchemy",
    "sqlalchemy.orm",
    "sqlalchemy.dialects",
    "sqlalchemy.dialects.postgresql",
    "src.db",
    "src.db.models",
]:
    if _mod not in sys.modules:
        sys.modules[_mod] = MagicMock()

# Provide the specific names qa_exporter imports from sqlalchemy
import sqlalchemy as _sa
_sa.create_engine = MagicMock()
_sa.select = MagicMock(return_value=MagicMock())
_sa.and_ = MagicMock()

import sqlalchemy.orm as _orm
_orm.sessionmaker = MagicMock()

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

# Stub the db models
_models_mock = sys.modules["src.db.models"]
_models_mock.AnalyticsRecord = MagicMock()
_models_mock.Article = MagicMock()
_models_mock.AssetTrend = MagicMock()
_models_mock.SocialPost = MagicMock()

from src.qa_exporter import QAExporter, ExportResult  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_exporter(tmp_path, start=1000, end=2000):
    with patch("src.qa_exporter.create_engine"), patch("src.qa_exporter.sessionmaker"):
        exporter = QAExporter(
            start_ledger=start,
            end_ledger=end,
            output_dir=str(tmp_path),
            database_url="postgresql://mock/mock",
        )
    return exporter


def _mock_session(exporter, side_effect=None, return_value=None):
    """Attach a mock session context manager to exporter.Session."""
    mock_session = MagicMock()
    mock_session.__enter__ = MagicMock(return_value=mock_session)
    mock_session.__exit__ = MagicMock(return_value=False)
    if side_effect is not None:
        mock_session.execute.return_value.scalars.return_value.all.side_effect = side_effect
    else:
        mock_session.execute.return_value.scalars.return_value.all.return_value = (
            return_value if return_value is not None else []
        )
    exporter.Session = MagicMock(return_value=mock_session)
    return mock_session


def _fake_analytics_record():
    r = MagicMock()
    r.id = 1
    r.record_type = "event"
    r.asset = "XLM"
    r.metric_name = "contract_call"
    r.window = None
    r.value = 1.0
    r.previous_value = None
    r.change_percentage = None
    r.trend_direction = None
    r.extra_data = {"ledger": 1500}
    r.timestamp = datetime(2024, 1, 1, tzinfo=timezone.utc)
    return r


def _fake_asset_trend():
    r = MagicMock()
    r.id = 1
    r.asset = "XLM"
    r.metric_name = "sentiment_score"
    r.window = "24h"
    r.trend_direction = "up"
    r.score = 0.8
    r.current_value = 0.5
    r.previous_value = 0.3
    r.change_percentage = 66.7
    r.extra_data = {}
    r.timestamp = datetime(2024, 1, 1, tzinfo=timezone.utc)
    return r


def _fake_article():
    a = MagicMock()
    a.article_id = "art-1"
    a.title = "XLM surges"
    a.source = "cryptonews"
    a.primary_asset = "XLM"
    a.sentiment_score = 0.7
    a.sentiment_label = "positive"
    a.published_at = datetime(2024, 1, 1, tzinfo=timezone.utc)
    return a


def _fake_social_post():
    p = MagicMock()
    p.post_id = "post-1"
    p.platform = "twitter"
    p.primary_asset = "XLM"
    p.sentiment_score = 0.5
    p.sentiment_label = "positive"
    p.posted_at = datetime(2024, 1, 1, tzinfo=timezone.utc)
    return p


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestExportResult:
    def test_to_dict(self):
        r = ExportResult("events", "/tmp/events_1000_2000.json", 5, "completed")
        assert r.to_dict() == {
            "dataset": "events",
            "path": "/tmp/events_1000_2000.json",
            "count": 5,
            "status": "completed",
        }


class TestQAExporterInit:
    def test_output_dir_created(self, tmp_path):
        out = tmp_path / "nested" / "qa"
        with patch("src.qa_exporter.create_engine"), patch("src.qa_exporter.sessionmaker"):
            QAExporter(1000, 2000, str(out), database_url="postgresql://mock/mock")
        assert out.exists()

    def test_ledger_range_stored(self, tmp_path):
        exporter = _make_exporter(tmp_path, start=500, end=999)
        assert exporter.start_ledger == 500
        assert exporter.end_ledger == 999


class TestExportEvents:
    def test_writes_json_file_with_envelope(self, tmp_path):
        exporter = _make_exporter(tmp_path)
        _mock_session(exporter, return_value=[_fake_analytics_record()])

        exporter.export_events()

        data = json.loads((tmp_path / "events_1000_2000.json").read_text())
        assert data["status"] == "completed"
        assert data["start_ledger"] == 1000
        assert data["end_ledger"] == 2000
        assert data["dataset"] == "events"
        assert data["count"] == 1
        assert data["records"][0]["asset"] == "XLM"

    def test_returns_export_result(self, tmp_path):
        exporter = _make_exporter(tmp_path)
        _mock_session(exporter, return_value=[])

        result = exporter.export_events()

        assert isinstance(result, ExportResult)
        assert result.dataset == "events"
        assert result.status == "completed"

    def test_empty_range_exports_zero_records(self, tmp_path):
        exporter = _make_exporter(tmp_path, start=9000, end=9001)
        _mock_session(exporter, return_value=[])

        result = exporter.export_events()
        assert result.count == 0


class TestExportKPIs:
    def test_writes_kpi_file(self, tmp_path):
        exporter = _make_exporter(tmp_path)
        _mock_session(exporter, return_value=[_fake_asset_trend()])

        result = exporter.export_kpis()

        data = json.loads((tmp_path / "kpis_1000_2000.json").read_text())
        assert data["dataset"] == "kpis"
        assert data["count"] == 1
        assert data["records"][0]["metric_name"] == "sentiment_score"
        assert result.status == "completed"


class TestExportViews:
    def test_writes_views_file(self, tmp_path):
        exporter = _make_exporter(tmp_path)
        # execute() called 3 times: articles, social_posts, analytics_records
        _mock_session(
            exporter,
            side_effect=[[_fake_article()], [_fake_social_post()], []],
        )

        result = exporter.export_views()

        data = json.loads((tmp_path / "views_1000_2000.json").read_text())
        assert data["dataset"] == "views"
        assert len(data["records"]["articles"]) == 1
        assert len(data["records"]["social_posts"]) == 1
        assert data["records"]["articles"][0]["title"] == "XLM surges"
        assert result.status == "completed"


class TestRunAll:
    def test_run_returns_three_results(self, tmp_path):
        exporter = _make_exporter(tmp_path)
        mock_session = MagicMock()
        mock_session.__enter__ = MagicMock(return_value=mock_session)
        mock_session.__exit__ = MagicMock(return_value=False)
        # run() calls export_events, export_views (3 queries), export_kpis
        mock_session.execute.return_value.scalars.return_value.all.return_value = []
        exporter.Session = MagicMock(return_value=mock_session)

        results = exporter.run()

        assert len(results) == 3
        assert {r.dataset for r in results} == {"events", "views", "kpis"}
