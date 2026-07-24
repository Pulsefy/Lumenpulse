"""
Ingestion throughput and backlog benchmark.

Measures:
  - Backfill throughput  (articles/sec through dedup → validate → sentiment → persist)
  - Near-real-time queue pressure (queue depth, backlog growth, processing latency)

Results are exported as JSON to BENCHMARK_OUTPUT_DIR (default: ./benchmark-results/).

Rerunnable by any contributor — no external APIs, no Redis, no database.
Synthetic data is generated with a fixed seed so results are comparable across runs.
"""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from collections import deque
import threading
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import pytest

# ---------------------------------------------------------------------------
# Config – override via environment
# ---------------------------------------------------------------------------

_BACKFILL_COUNT = int(os.getenv("BENCHMARK_BACKFILL_ARTICLES", "2000"))
_REALTIME_EVENT_COUNT = int(os.getenv("BENCHMARK_REALTIME_EVENTS", "1000"))
_REALTIME_WORKERS = int(os.getenv("BENCHMARK_REALTIME_WORKERS", "4"))
_OUTPUT_DIR = Path(os.getenv("BENCHMARK_OUTPUT_DIR", "./benchmark-results"))
_SEED = int(os.getenv("BENCHMARK_SEED", "42"))

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Data structures for benchmark results
# ---------------------------------------------------------------------------


@dataclass
class StageTiming:
    stage: str
    items: int
    total_seconds: float
    throughput_per_sec: float = 0.0

    def __post_init__(self) -> None:
        if self.total_seconds > 0:
            self.throughput_per_sec = self.items / self.total_seconds


@dataclass
class BackfillReport:
    """Aggregated result of a single backfill benchmark run."""

    total_articles: int
    total_seconds: float
    throughput_per_sec: float
    stages: List[StageTiming]
    dedup_rate: float
    start_time: str
    end_time: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class QueueSnapshot:
    elapsed_sec: float
    queue_depth: int
    processed_count: int
    backlog_growth_rate: float  # items/sec being added


@dataclass
class RealtimeReport:
    """Aggregated result of a near-real-time queue benchmark run."""

    total_events: int
    total_seconds: float
    throughput_per_sec: float
    worker_count: int
    avg_latency_ms: float
    p99_latency_ms: float
    max_queue_depth: int
    snapshots: List[Dict[str, Any]] = field(default_factory=list)
    start_time: str = ""
    end_time: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ---------------------------------------------------------------------------
# Synthetic data generators (seeded for reproducibility)
# --------------------------------------------------------------------------


def _make_article(i: int, rng: Any) -> Dict[str, Any]:
    """Create a single synthetic news article dict."""
    titles = [
        "Bitcoin surges past resistance",
        "Ethereum upgrade draws developer interest",
        "Stellar network activity spikes",
        "Crypto regulations update from SEC",
        "DeFi total value locked reaches新高",
        "NFT market shows signs of recovery",
        "Layer 2 scaling solutions gain traction",
        "Central bank digital currency pilot expands",
        "Mining difficulty adjusts upward",
        "Altcoin season indicators flash green",
    ]
    sources = ["CoinDesk", "CoinTelegraph", "The Block", "Decrypt", "CryptoSlate"]
    title = rng.choice(titles)
    return {
        "id": f"bench_{i}",
        "title": title,
        "content": f"Synthetic content for article {i}. {title} detailed analysis.",
        "summary": f"Summary of article {i}.",
        "source": rng.choice(sources),
        "url": f"https://example.com/news/{i}",
        "published_at": datetime.now(timezone.utc).isoformat(),
        "categories": ["crypto", "blockchain"],
        "tags": ["bitcoin", "ethereum"],
    }


def _make_event(i: int, rng: Any) -> Dict[str, Any]:
    """Create a single synthetic Soroban event (as would arrive via the ingestion endpoint)."""
    event_types = ["ProjectRegistered", "VoteCast", "ProjectVerified", "ProjectRejected"]
    return {
        "txHash": f"deadbeef{i:016x}",
        "eventIndex": 0,
        "type": rng.choice(event_types),
        "projectId": str(uuid.uuid4()),
        "owner": f"G{rng.randint(10**55, 10**56 - 1)}",
        "name": f"Project-{i}",
        "ledgerSeq": 42_000_000 + i,
        "metadataCid": f"Qm{rng.randint(10**43, 10**44 - 1)}",
        "payload": json.dumps(
            {"round": i % 17, "amount": str(rng.randint(100, 1_000_000))}
        ),
    }


def _make_articles(count: int) -> List[Dict[str, Any]]:
    import random
    rng = random.Random(_SEED)
    return [_make_article(i, rng) for i in range(count)]


def _make_events(count: int) -> List[Dict[str, Any]]:
    import random
    rng = random.Random(_SEED)
    return [_make_event(i, rng) for i in range(count)]


# ---------------------------------------------------------------------------
# Simulated pipeline stages (backfill path)
# ---------------------------------------------------------------------------


class StageRunner:
    """Wraps a callable stage with timing."""

    def __init__(self, name: str, fn: Callable[[List[Dict[str, Any]]], List[Dict[str, Any]]]):
        self.name = name
        self.fn = fn

    def run(self, items: List[Dict[str, Any]]) -> StageTiming:
        start = time.perf_counter()
        result = self.fn(items)
        elapsed = time.perf_counter() - start
        return StageTiming(
            stage=self.name,
            items=len(result),
            total_seconds=elapsed,
        )


def _dedup_stage(articles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Simulate SHA-256 deduplication — speed depends on article count and size."""
    seen = set()
    out = []
    for a in articles:
        key = a["url"]
        if key not in seen:
            seen.add(key)
            out.append(a)
    return out


def _validate_stage(articles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Simulate Pydantic-like validation — fast field checks."""
    valid = []
    for a in articles:
        if a.get("id") and a.get("title"):
            valid.append(a)
    return valid


def _sentiment_stage(articles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Simulate VADER-style sentiment scoring via string length heuristic."""
    for a in articles:
        text_len = len(a.get("title", "")) + len(a.get("content", ""))
        if text_len == 0:
            a["sentiment_score"] = 0.0
        else:
            a["sentiment_score"] = (text_len % 200 - 100) / 100.0
    return articles


def _persist_stage(articles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Simulate writing to JSONL (the on-disk format already used by analytics)."""
    path = _OUTPUT_DIR / ".bench_write_test.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for a in articles:
            f.write(json.dumps(a, ensure_ascii=False, default=str) + "\n")
    return articles


# ---------------------------------------------------------------------------
# Simulated queue processor (near-real-time path)
# ---------------------------------------------------------------------------


class SimQueue:
    """A simple in-memory FIFO queue for benchmarking."""

    def __init__(self) -> None:
        self._items: deque = deque()
        self._lock = threading.Lock()

    def push(self, item: Any) -> None:
        with self._lock:
            self._items.append(item)

    def pop(self) -> Optional[Any]:
        with self._lock:
            if self._items:
                return self._items.popleft()
            return None

    def depth(self) -> int:
        with self._lock:
            return len(self._items)


class SimWorker(threading.Thread):
    """Worker that pops events from the shared queue and processes them."""

    def __init__(
        self,
        worker_id: int,
        queue: SimQueue,
        processor: Callable[[Any], None],
        latencies: List[float],
        stop_event: Any,
    ):
        super().__init__(daemon=True)
        self.worker_id = worker_id
        self.queue = queue
        self.processor = processor
        self.latencies = latencies
        self.stop_event = stop_event
        self.processed = 0

    def run(self) -> None:
        while not self.stop_event.is_set():
            event = self.queue.pop()
            if event is None:
                time.sleep(0.0001)
                continue
            start = time.perf_counter()
            self.processor(event)
            elapsed = (time.perf_counter() - start) * 1000  # ms
            self.latencies.append(elapsed)
            self.processed += 1


def _realtime_processor(event: Dict[str, Any]) -> None:
    """Simulate processing a single Soroban event — slight CPU burn."""
    _ = json.dumps(event, ensure_ascii=False, default=str)
    _ = len(event["payload"]) * sum(ord(c) for c in event.get("name", ""))


# ---------------------------------------------------------------------------
# Benchmark runners
# ---------------------------------------------------------------------------


def run_backfill_benchmark(article_count: int) -> BackfillReport:
    """Run a complete backfill benchmark: generate → dedup → validate → sentiment → persist."""
    start_ts = datetime.now(timezone.utc).isoformat()
    start_wall = time.perf_counter()

    articles = _make_articles(article_count)
    generation_elapsed = time.perf_counter() - start_wall
    logger.info("Generated %d synthetic articles in %.3fs", len(articles), generation_elapsed)

    stages = [
        StageRunner("generate", lambda xs: xs),
        StageRunner("dedup", _dedup_stage),
        StageRunner("validate", _validate_stage),
        StageRunner("sentiment", _sentiment_stage),
        StageRunner("persist", _persist_stage),
    ]

    timing_results: List[StageTiming] = []
    pipeline = articles
    for sr in stages:
        timing = sr.run(pipeline)
        timing_results.append(timing)
        pipeline = _dedup_stage(pipeline) if sr.name == "dedup" else pipeline
        logger.info(
            "  %-12s %6d items in %8.3fs  (%9.1f items/sec)",
            sr.name,
            timing.items,
            timing.total_seconds,
            timing.throughput_per_sec,
        )

    total_elapsed = time.perf_counter() - start_wall
    total_items = article_count
    dedup_in = article_count
    dedup_out = timing_results[1].items if len(timing_results) > 1 else article_count
    dedup_rate = 1 - (dedup_out / max(dedup_in, 1))

    report = BackfillReport(
        total_articles=total_items,
        total_seconds=total_elapsed,
        throughput_per_sec=total_items / total_elapsed if total_elapsed > 0 else 0.0,
        stages=timing_results,
        dedup_rate=dedup_rate,
        start_time=start_ts,
        end_time=datetime.now(timezone.utc).isoformat(),
    )
    return report


def run_realtime_benchmark(
    event_count: int,
    worker_count: int,
    snapshot_interval: float = 0.05,
) -> RealtimeReport:
    """Simulate events arriving and being processed by N workers.

    Events are added to the queue at a controlled rate to simulate backlog.
    Snapshot queue depth and processed count at regular intervals.
    """
    import random

    start_ts = datetime.now(timezone.utc).isoformat()
    start_wall = time.perf_counter()

    queue = SimQueue()
    stop_event = threading.Event()
    latencies: List[float] = []
    workers = [
        SimWorker(i, queue, _realtime_processor, latencies, stop_event)
        for i in range(worker_count)
    ]

    for w in workers:
        w.start()

    events = _make_events(event_count)
    snapshots: List[Dict[str, Any]] = []
    max_qd = 0

    # Push events in bursts to simulate real-world arrival patterns
    rng = random.Random(_SEED)
    push_complete = False

    def _publisher():
        nonlocal push_complete, max_qd
        for ev in events:
            queue.push(ev)
            qd = queue.depth()
            if qd > max_qd:
                max_qd = qd
            time.sleep(rng.uniform(0.0005, 0.003))
        push_complete = True

    pub_thread = threading.Thread(target=_publisher, daemon=True)
    pub_thread.start()

    last_processed = 0
    last_snapshot_at = time.perf_counter()

    while True:
        now = time.perf_counter()
        if now - last_snapshot_at >= snapshot_interval:
            elapsed = now - start_wall
            total_processed = sum(w.processed for w in workers)
            qd = queue.depth()
            growth_rate = (total_processed - last_processed) / (now - last_snapshot_at + 1e-9)
            snapshots.append({
                "elapsed_sec": round(elapsed, 3),
                "queue_depth": qd,
                "processed_count": total_processed,
                "backlog_growth_rate": round(growth_rate, 1),
            })
            last_processed = total_processed
            last_snapshot_at = now

        total_processed_now = sum(w.processed for w in workers)
        if push_complete and total_processed_now >= event_count:
            break
        if push_complete and queue.depth() == 0 and total_processed_now > 0:
            if time.perf_counter() - start_wall > 10:
                break
        time.sleep(0.001)

    total_elapsed = time.perf_counter() - start_wall
    stop_event.set()
    pub_thread.join(timeout=2)
    for w in workers:
        w.join(timeout=2)

    total_processed = sum(w.processed for w in workers)
    avg_lat = sum(latencies) / len(latencies) if latencies else 0.0
    sorted_lat = sorted(latencies)
    p99_lat = sorted_lat[int(len(sorted_lat) * 0.99)] if sorted_lat else 0.0

    report = RealtimeReport(
        total_events=event_count,
        total_seconds=total_elapsed,
        throughput_per_sec=total_processed / max(total_elapsed, 1e-9),
        worker_count=worker_count,
        avg_latency_ms=round(avg_lat, 2),
        p99_latency_ms=round(p99_lat, 2),
        max_queue_depth=max_qd,
        snapshots=snapshots,
        start_time=start_ts,
        end_time=datetime.now(timezone.utc).isoformat(),
    )
    return report


# ---------------------------------------------------------------------------
# Export helpers
# ---------------------------------------------------------------------------


def _export(report: Any, label: str) -> Path:
    """Serialize report to JSON in the output directory."""
    _OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    fname = f"benchmark_{label}_{datetime.now():%Y%m%d_%H%M%S}.json"
    path = _OUTPUT_DIR / fname
    path.write_text(json.dumps(report.to_dict(), indent=2, default=str), encoding="utf-8")
    logger.info("Exported %s benchmark → %s", label, path)
    return path


# ---------------------------------------------------------------------------
# Pytest fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def backfill_results() -> BackfillReport:
    report = run_backfill_benchmark(_BACKFILL_COUNT)
    _export(report, "backfill")
    return report


@pytest.fixture(scope="module")
def realtime_results() -> RealtimeReport:
    report = run_realtime_benchmark(_REALTIME_EVENT_COUNT, _REALTIME_WORKERS)
    _export(report, "realtime")
    return report


# ---------------------------------------------------------------------------
# Tests — one per benchmark path
# ---------------------------------------------------------------------------


class TestIngestionBenchmark:
    """Ingestion throughput and backlog benchmark tests."""

    def test_backfill_throughput(self, backfill_results: BackfillReport) -> None:
        assert backfill_results.total_articles == _BACKFILL_COUNT
        assert backfill_results.total_seconds > 0
        assert backfill_results.throughput_per_sec > 0
        assert len(backfill_results.stages) >= 4
        print()
        print("=" * 65)
        print("BACKFILL INGESTION BENCHMARK")
        print("=" * 65)
        print(f"  Articles:          {backfill_results.total_articles}")
        print(f"  Total time:        {backfill_results.total_seconds:.3f}s")
        print(f"  Throughput:        {backfill_results.throughput_per_sec:,.1f} articles/sec")
        print(f"  Dedup rate:        {backfill_results.dedup_rate:.2%}")
        print()
        print("  Per-stage:")
        for s in backfill_results.stages:
            print(
                f"    {s.stage:<12} {s.items:>6} items  "
                f"{s.total_seconds:>8.3f}s  {s.throughput_per_sec:>9.1f} items/sec"
            )
        print("=" * 65)

    def test_realtime_queue_pressure(self, realtime_results: RealtimeReport) -> None:
        assert realtime_results.total_events == _REALTIME_EVENT_COUNT
        assert realtime_results.total_seconds > 0
        assert realtime_results.throughput_per_sec > 0
        assert realtime_results.max_queue_depth >= 0
        assert len(realtime_results.snapshots) > 0
        print()
        print("=" * 65)
        print("NEAR-REAL-TIME QUEUE BENCHMARK")
        print("=" * 65)
        print(f"  Events:            {realtime_results.total_events}")
        print(f"  Workers:           {realtime_results.worker_count}")
        print(f"  Total time:        {realtime_results.total_seconds:.3f}s")
        print(f"  Throughput:        {realtime_results.throughput_per_sec:,.1f} events/sec")
        print(f"  Avg latency:       {realtime_results.avg_latency_ms:.2f}ms")
        print(f"  P99 latency:       {realtime_results.p99_latency_ms:.2f}ms")
        print(f"  Max queue depth:   {realtime_results.max_queue_depth}")
        print()
        print("  Queue snapshots (depth over time):")
        for snap in realtime_results.snapshots:
            print(
                f"    t={snap['elapsed_sec']:>6.3f}s  "
                f"depth={snap['queue_depth']:>4d}  "
                f"processed={snap['processed_count']:>5d}  "
                f"backlog_rate={snap['backlog_growth_rate']:>8.1f} items/s"
            )
        print("=" * 65)

    def test_backfill_benchmark_export(self, backfill_results: BackfillReport) -> None:
        out_dir = _OUTPUT_DIR
        assert out_dir.exists()
        jsons = list(out_dir.glob("benchmark_backfill_*.json"))
        assert len(jsons) >= 1

    def test_realtime_benchmark_export(self, realtime_results: RealtimeReport) -> None:
        out_dir = _OUTPUT_DIR
        assert out_dir.exists()
        jsons = list(out_dir.glob("benchmark_realtime_*.json"))
        assert len(jsons) >= 1


# ---------------------------------------------------------------------------
# CLI entry point for standalone runs (outside pytest)
# ---------------------------------------------------------------------------


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")

    print("=" * 65)
    print("LUMENPULSE INGESTION BENCHMARK")
    print("=" * 65)
    print(f"  Backfill articles:  {_BACKFILL_COUNT}")
    print(f"  Realtime events:    {_REALTIME_EVENT_COUNT}")
    print(f"  Workers:            {_REALTIME_WORKERS}")
    print(f"  Output directory:   {_OUTPUT_DIR}")
    print(f"  Seed:               {_SEED}")
    print()

    bf = run_backfill_benchmark(_BACKFILL_COUNT)
    _export(bf, "backfill")
    print()

    rt = run_realtime_benchmark(_REALTIME_EVENT_COUNT, _REALTIME_WORKERS)
    _export(rt, "realtime")
    print()

    print("Benchmark complete. Results exported to %s", _OUTPUT_DIR)