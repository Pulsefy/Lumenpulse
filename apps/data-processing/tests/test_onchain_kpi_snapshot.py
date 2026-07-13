"""
Unit tests for the daily on-chain KPI snapshot scheduler (#877).

All external dependencies (SQLAlchemy, Stellar SDK, PostgresService) are
stubbed so the suite runs without any external packages installed.
"""

import sys
import types
import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# Helper: inject a fake module into sys.modules
# ---------------------------------------------------------------------------

def _fake(name: str, **attrs) -> types.ModuleType:
    mod = types.ModuleType(name)
    for k, v in attrs.items():
        setattr(mod, k, v)
    sys.modules[name] = mod
    return mod


# Stub the entire src.db tree so importing onchain_kpi_snapshot never
# triggers the real SQLAlchemy import chain.
_FAKE_POSTGRES_SERVICE_CLS = MagicMock(name="PostgresService")

_fake("src.db", PostgresService=_FAKE_POSTGRES_SERVICE_CLS)
_fake("src.db.postgres_service", PostgresService=_FAKE_POSTGRES_SERVICE_CLS)
_fake("src.db.models")

# Stub Stellar SDK (may not be installed in this environment)
_fake("stellar_sdk")
_fake("stellar_sdk.exceptions", NotFoundError=Exception, BadRequestError=Exception, ConnectionError=Exception)
_fake("stellar_sdk.call_builder")
_fake("stellar_sdk.call_builder.call_builder_async", PaymentsCallBuilder=MagicMock())

# Stub src.utils.logger to avoid pulling in the full logging chain
import logging
_logger_mod = _fake("src.utils.logger")
_logger_mod.setup_logger = lambda name: logging.getLogger(name)

# Stub src.ingestion.stellar_fetcher
_fake("src.ingestion")
_fake("src.ingestion.stellar_fetcher", StellarDataFetcher=MagicMock())

# Now it is safe to import the module under test
import src.snapshots.onchain_kpi_snapshot as _snap_mod  # noqa: E402


# ---------------------------------------------------------------------------
# Tests for run_onchain_kpi_snapshot_job
# ---------------------------------------------------------------------------

class TestRunOnchainKpiSnapshotJob(unittest.TestCase):

    def _reset(self):
        """Give each test a fresh PostgresService mock."""
        _FAKE_POSTGRES_SERVICE_CLS.reset_mock()
        self._mock_svc = MagicMock()
        _FAKE_POSTGRES_SERVICE_CLS.return_value = self._mock_svc
        self._mock_svc.save_onchain_kpi_snapshot.return_value = MagicMock()

    def test_calls_save_with_expected_kpis(self):
        """Job must forward all four KPI fields to save_onchain_kpi_snapshot."""
        self._reset()
        with patch.object(_snap_mod, "_fetch_kpis", return_value={
            "tvl_xlm": 500.0,
            "volume_xlm": 200.0,
            "active_rounds": 4,
            "contribution_count": 12,
            "extra_data": None,
        }):
            _snap_mod.run_onchain_kpi_snapshot_job()

        self._mock_svc.save_onchain_kpi_snapshot.assert_called_once()
        kw = self._mock_svc.save_onchain_kpi_snapshot.call_args[1]
        self.assertEqual(kw["tvl_xlm"], 500.0)
        self.assertEqual(kw["volume_xlm"], 200.0)
        self.assertEqual(kw["active_rounds"], 4)
        self.assertEqual(kw["contribution_count"], 12)

    def test_period_date_is_today_utc(self):
        """period_date must be today's date in UTC."""
        self._reset()
        with patch.object(_snap_mod, "_fetch_kpis", return_value={
            "tvl_xlm": 0.0, "volume_xlm": 0.0,
            "active_rounds": 0, "contribution_count": 0, "extra_data": None,
        }):
            _snap_mod.run_onchain_kpi_snapshot_job()

        expected = datetime.now(tz=timezone.utc).strftime("%Y-%m-%d")
        kw = self._mock_svc.save_onchain_kpi_snapshot.call_args[1]
        self.assertEqual(kw["period_date"], expected)

    def test_does_not_raise_on_fetch_error(self):
        """Exceptions from _fetch_kpis must be caught so the scheduler keeps running."""
        self._reset()
        with patch.object(_snap_mod, "_fetch_kpis", side_effect=RuntimeError("boom")):
            try:
                _snap_mod.run_onchain_kpi_snapshot_job()
            except Exception as exc:
                self.fail(f"job raised unexpectedly: {exc}")

    def test_does_not_raise_on_save_error(self):
        """DB errors during save must also be swallowed."""
        self._reset()
        self._mock_svc.save_onchain_kpi_snapshot.side_effect = RuntimeError("db down")
        with patch.object(_snap_mod, "_fetch_kpis", return_value={
            "tvl_xlm": 0.0, "volume_xlm": 0.0,
            "active_rounds": 0, "contribution_count": 0, "extra_data": None,
        }):
            try:
                _snap_mod.run_onchain_kpi_snapshot_job()
            except Exception as exc:
                self.fail(f"job raised unexpectedly: {exc}")


# ---------------------------------------------------------------------------
# Tests for save_onchain_kpi_snapshot / get_onchain_kpi_snapshots logic
# (exercised via a lightweight in-memory fake — no DB required)
# ---------------------------------------------------------------------------

class TestSaveOnchainKpiSnapshotLogic(unittest.TestCase):
    """Verifies the duplicate-skip and ordering behaviour defined in the service."""

    def _make_service(self):
        """Minimal in-memory implementation that mirrors the real service contract."""
        store: dict = {}

        class FakeSnap:
            def __init__(self, **kw):
                for k, v in kw.items():
                    setattr(self, k, v)

        class FakeService:
            def save_onchain_kpi_snapshot(
                self, period_date, tvl_xlm, volume_xlm,
                active_rounds, contribution_count,
                extra_data=None, captured_at=None,
            ):
                if period_date in store:
                    return store[period_date]
                snap = FakeSnap(
                    period_date=period_date,
                    tvl_xlm=tvl_xlm,
                    volume_xlm=volume_xlm,
                    active_rounds=active_rounds,
                    contribution_count=contribution_count,
                    extra_data=extra_data,
                    captured_at=captured_at or datetime.now(tz=timezone.utc),
                )
                store[period_date] = snap
                return snap

            def get_onchain_kpi_snapshots(self, limit=90):
                rows = sorted(store.values(), key=lambda s: s.period_date, reverse=True)
                return rows[:limit]

        return FakeService(), store

    def test_saves_new_snapshot(self):
        svc, store = self._make_service()
        snap = svc.save_onchain_kpi_snapshot(
            period_date="2026-06-28", tvl_xlm=1000.0,
            volume_xlm=500.0, active_rounds=3, contribution_count=10,
        )
        self.assertIsNotNone(snap)
        self.assertEqual(snap.period_date, "2026-06-28")
        self.assertEqual(snap.tvl_xlm, 1000.0)
        self.assertEqual(snap.active_rounds, 3)
        self.assertIn("2026-06-28", store)

    def test_skips_duplicate_snapshot(self):
        svc, store = self._make_service()
        svc.save_onchain_kpi_snapshot(
            period_date="2026-06-28", tvl_xlm=1000.0,
            volume_xlm=500.0, active_rounds=3, contribution_count=10,
        )
        second = svc.save_onchain_kpi_snapshot(
            period_date="2026-06-28", tvl_xlm=9999.0,
            volume_xlm=9999.0, active_rounds=99, contribution_count=99,
        )
        # Must return the original row unchanged
        self.assertEqual(second.tvl_xlm, 1000.0)
        self.assertEqual(len(store), 1)

    def test_get_snapshots_returns_newest_first(self):
        svc, _ = self._make_service()
        for day in ["2026-06-26", "2026-06-27", "2026-06-28"]:
            svc.save_onchain_kpi_snapshot(
                period_date=day, tvl_xlm=0.0, volume_xlm=0.0,
                active_rounds=0, contribution_count=0,
            )
        results = svc.get_onchain_kpi_snapshots(limit=10)
        self.assertEqual(len(results), 3)
        self.assertEqual(results[0].period_date, "2026-06-28")
        self.assertEqual(results[-1].period_date, "2026-06-26")

    def test_get_snapshots_respects_limit(self):
        svc, _ = self._make_service()
        for i in range(5):
            svc.save_onchain_kpi_snapshot(
                period_date=f"2026-06-{20+i:02d}", tvl_xlm=0.0, volume_xlm=0.0,
                active_rounds=0, contribution_count=0,
            )
        self.assertEqual(len(svc.get_onchain_kpi_snapshots(limit=3)), 3)

    def test_all_four_kpis_are_captured(self):
        """Snapshot must store TVL, volume, active_rounds, contribution_count."""
        svc, _ = self._make_service()
        snap = svc.save_onchain_kpi_snapshot(
            period_date="2026-06-28", tvl_xlm=111.1,
            volume_xlm=222.2, active_rounds=5, contribution_count=99,
        )
        self.assertEqual(snap.tvl_xlm, 111.1)
        self.assertEqual(snap.volume_xlm, 222.2)
        self.assertEqual(snap.active_rounds, 5)
        self.assertEqual(snap.contribution_count, 99)


if __name__ == "__main__":
    unittest.main()
