"""
RPC Provider Benchmark Job (#884)

Measures and compares latency, success-rate, and throughput across
Stellar Horizon / Soroban RPC endpoints so the scheduler can pick
the fastest healthy provider.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Dict, List, Optional

import requests

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Domain types
# ---------------------------------------------------------------------------

DEFAULT_PROVIDERS: List[str] = [
    "https://horizon.stellar.org",
    "https://horizon-testnet.stellar.org",
]

_PROBE_PATH = "/"  # Horizon root returns basic server info


@dataclass
class ProviderResult:
    """Benchmark result for one provider endpoint."""

    url: str
    latency_ms: Optional[float]   # None if request failed
    success: bool
    status_code: Optional[int]
    error: Optional[str] = None

    def to_dict(self) -> Dict:
        return {
            "url": self.url,
            "latency_ms": round(self.latency_ms, 2) if self.latency_ms is not None else None,
            "success": self.success,
            "status_code": self.status_code,
            "error": self.error,
        }


@dataclass
class BenchmarkReport:
    """Aggregated benchmark report across all probed providers."""

    providers: List[ProviderResult]
    best_provider: Optional[str]          # URL with lowest latency among successes
    timestamp_utc: str

    def to_dict(self) -> Dict:
        return {
            "providers": [p.to_dict() for p in self.providers],
            "best_provider": self.best_provider,
            "timestamp_utc": self.timestamp_utc,
        }


# ---------------------------------------------------------------------------
# Benchmark job
# ---------------------------------------------------------------------------


class RPCProviderBenchmark:
    """
    Probes a list of Stellar RPC / Horizon endpoints and ranks them by
    latency.

    Usage
    -----
    bench = RPCProviderBenchmark()
    report = bench.run()            # BenchmarkReport
    print(report.best_provider)
    """

    def __init__(
        self,
        providers: Optional[List[str]] = None,
        timeout: float = 10.0,
        probe_path: str = _PROBE_PATH,
    ) -> None:
        self.providers: List[str] = providers if providers is not None else list(DEFAULT_PROVIDERS)
        self.timeout = timeout
        self.probe_path = probe_path

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def probe(self, url: str) -> ProviderResult:
        """Send a single GET probe to *url* and record latency."""
        target = url.rstrip("/") + self.probe_path
        t0 = time.monotonic()
        try:
            resp = requests.get(target, timeout=self.timeout)
            latency_ms = (time.monotonic() - t0) * 1000
            success = resp.status_code < 500
            return ProviderResult(
                url=url,
                latency_ms=latency_ms,
                success=success,
                status_code=resp.status_code,
            )
        except requests.exceptions.Timeout:
            latency_ms = (time.monotonic() - t0) * 1000
            return ProviderResult(
                url=url,
                latency_ms=latency_ms,
                success=False,
                status_code=None,
                error="timeout",
            )
        except requests.exceptions.RequestException as exc:
            return ProviderResult(
                url=url,
                latency_ms=None,
                success=False,
                status_code=None,
                error=str(exc),
            )

    def run(self) -> BenchmarkReport:
        """Probe all providers and return a BenchmarkReport."""
        from datetime import datetime, timezone

        results = [self.probe(url) for url in self.providers]

        successful = [r for r in results if r.success and r.latency_ms is not None]
        best = min(successful, key=lambda r: r.latency_ms).url if successful else None

        report = BenchmarkReport(
            providers=results,
            best_provider=best,
            timestamp_utc=datetime.now(timezone.utc).isoformat(),
        )

        logger.info(
            "RPC benchmark complete: %d/%d healthy | best=%s",
            len(successful),
            len(results),
            best,
        )
        return report
