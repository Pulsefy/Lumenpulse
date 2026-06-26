"""
Unit tests for RPCProviderBenchmark (#884).
"""

import importlib.util
import os
import sys
import unittest
from unittest.mock import Mock, patch

# Import rpc_benchmark directly from its file to avoid triggering
# src/ingestion/__init__.py (which has heavy optional dependencies).
_mod_path = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "src", "ingestion", "rpc_benchmark.py")
)
_spec = importlib.util.spec_from_file_location("rpc_benchmark", _mod_path)
_rpc_mod = importlib.util.module_from_spec(_spec)
sys.modules["rpc_benchmark"] = _rpc_mod  # register so dataclass __module__ resolves
_spec.loader.exec_module(_rpc_mod)

RPCProviderBenchmark = _rpc_mod.RPCProviderBenchmark
ProviderResult = _rpc_mod.ProviderResult
BenchmarkReport = _rpc_mod.BenchmarkReport
DEFAULT_PROVIDERS = _rpc_mod.DEFAULT_PROVIDERS


def _make_response(status_code: int) -> Mock:
    resp = Mock()
    resp.status_code = status_code
    return resp


class TestProviderResult(unittest.TestCase):

    def test_to_dict_success(self):
        r = ProviderResult(
            url="https://horizon.stellar.org",
            latency_ms=42.5,
            success=True,
            status_code=200,
        )
        d = r.to_dict()
        self.assertEqual(d["url"], "https://horizon.stellar.org")
        self.assertAlmostEqual(d["latency_ms"], 42.5)
        self.assertTrue(d["success"])
        self.assertEqual(d["status_code"], 200)
        self.assertIsNone(d["error"])

    def test_to_dict_failure(self):
        r = ProviderResult(
            url="https://bad.example",
            latency_ms=None,
            success=False,
            status_code=None,
            error="timeout",
        )
        d = r.to_dict()
        self.assertFalse(d["success"])
        self.assertIsNone(d["latency_ms"])
        self.assertEqual(d["error"], "timeout")


class TestRPCProviderBenchmark(unittest.TestCase):

    def setUp(self):
        self.bench = RPCProviderBenchmark(
            providers=["https://a.example", "https://b.example"],
            timeout=5.0,
        )

    @patch("rpc_benchmark.requests.get")
    def test_probe_success(self, mock_get):
        mock_get.return_value = _make_response(200)
        result = self.bench.probe("https://a.example")

        self.assertTrue(result.success)
        self.assertEqual(result.status_code, 200)
        self.assertIsNotNone(result.latency_ms)
        self.assertGreaterEqual(result.latency_ms, 0)

    @patch("rpc_benchmark.requests.get")
    def test_probe_server_error_not_success(self, mock_get):
        mock_get.return_value = _make_response(500)
        result = self.bench.probe("https://a.example")
        self.assertFalse(result.success)
        self.assertEqual(result.status_code, 500)

    @patch("rpc_benchmark.requests.get")
    def test_probe_timeout(self, mock_get):
        import requests as req_lib
        mock_get.side_effect = req_lib.exceptions.Timeout()
        result = self.bench.probe("https://a.example")

        self.assertFalse(result.success)
        self.assertEqual(result.error, "timeout")
        self.assertIsNotNone(result.latency_ms)  # elapsed time recorded

    @patch("rpc_benchmark.requests.get")
    def test_probe_connection_error(self, mock_get):
        import requests as req_lib
        mock_get.side_effect = req_lib.exceptions.ConnectionError("refused")
        result = self.bench.probe("https://a.example")

        self.assertFalse(result.success)
        self.assertIsNone(result.latency_ms)
        self.assertIsNotNone(result.error)

    @patch("rpc_benchmark.requests.get")
    def test_run_picks_best_provider(self, mock_get):
        # a.example: fast (200), b.example: slow (200)
        def side_effect(url, timeout):
            import time
            if "a.example" in url:
                time.sleep(0.0)
                return _make_response(200)
            time.sleep(0.0)
            return _make_response(200)

        # Patch probe instead so we can control latency deterministically
        with patch.object(self.bench, "probe") as mock_probe:
            mock_probe.side_effect = [
                ProviderResult("https://a.example", latency_ms=10.0, success=True, status_code=200),
                ProviderResult("https://b.example", latency_ms=50.0, success=True, status_code=200),
            ]
            report = self.bench.run()

        self.assertEqual(report.best_provider, "https://a.example")
        self.assertEqual(len(report.providers), 2)

    @patch("rpc_benchmark.requests.get")
    def test_run_all_fail_best_is_none(self, mock_get):
        import requests as req_lib
        mock_get.side_effect = req_lib.exceptions.ConnectionError("down")
        report = self.bench.run()

        self.assertIsNone(report.best_provider)
        self.assertTrue(all(not p.success for p in report.providers))

    @patch("rpc_benchmark.requests.get")
    def test_run_partial_failure(self, mock_get):
        with patch.object(self.bench, "probe") as mock_probe:
            mock_probe.side_effect = [
                ProviderResult("https://a.example", latency_ms=None, success=False, status_code=None, error="down"),
                ProviderResult("https://b.example", latency_ms=20.0, success=True, status_code=200),
            ]
            report = self.bench.run()

        self.assertEqual(report.best_provider, "https://b.example")

    def test_default_providers_populated(self):
        bench = RPCProviderBenchmark()
        self.assertEqual(bench.providers, DEFAULT_PROVIDERS)

    def test_benchmark_report_to_dict(self):
        report = BenchmarkReport(
            providers=[
                ProviderResult("https://a.example", 15.0, True, 200),
            ],
            best_provider="https://a.example",
            timestamp_utc="2024-01-01T12:00:00+00:00",
        )
        d = report.to_dict()
        self.assertIn("providers", d)
        self.assertIn("best_provider", d)
        self.assertIn("timestamp_utc", d)
        self.assertEqual(d["best_provider"], "https://a.example")


if __name__ == "__main__":
    unittest.main()
