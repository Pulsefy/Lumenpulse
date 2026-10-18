# -*- coding: utf-8 -*-
"""
Inference latency benchmark under concurrent batch load (issue #1628).

Measures how inference endpoint latency changes when the batch scheduler is
running concurrently — the core "before/after" measurement required by the
acceptance criteria for separating model serving from the batch service.

Usage
-----
Run against a *live* inference service:

    # Baseline — inference only (batch scheduler idle or not running)
    python -m src.observability.latency_benchmark \\
        --url http://localhost:8000 \\
        --concurrent-batches 0 \\
        --label before

    # Under load — kick off simulated batch work in background threads, then
    # measure inference latency at the same time.
    python -m src.observability.latency_benchmark \\
        --url http://localhost:8000 \\
        --concurrent-batches 4 \\
        --label after

Both runs write a JSON result file to ./data/benchmark_<label>.json and print
a summary table so the two can be compared side-by-side.

The benchmark can also be imported and called programmatically:

    from src.observability.latency_benchmark import run_benchmark
    result = run_benchmark(base_url="http://localhost:8000", concurrent_batches=0)
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import threading
import time
from datetime import datetime, timezone
from typing import Any

import httpx

# ---------------------------------------------------------------------------
# Configuration defaults
# ---------------------------------------------------------------------------
DEFAULT_INFERENCE_REQUESTS = 100   # Total inference probe requests per run
DEFAULT_CONCURRENCY = 10           # Parallel inference probe threads
DEFAULT_BATCH_SIZE = 50            # Items per simulated batch payload
DEFAULT_CONCURRENT_BATCHES = 4     # Background batch threads during "after" run
DEFAULT_WARMUP_REQUESTS = 5        # Requests sent before timing starts
API_KEY = os.getenv("API_KEY", "benchmark-key")
ANALYZE_PAYLOAD = {"text": "Stellar XLM breaks resistance, bullish momentum building on Lumenpulse"}


# ---------------------------------------------------------------------------
# Probe helpers
# ---------------------------------------------------------------------------

def _probe_inference(
    client: httpx.Client,
    base_url: str,
    results: list[float],
    errors: list[str],
) -> None:
    """Send one POST /analyze request and record the wall-clock latency."""
    start = time.perf_counter()
    try:
        resp = client.post(
            f"{base_url}/analyze",
            json=ANALYZE_PAYLOAD,
            headers={"X-API-Key": API_KEY},
            timeout=30.0,
        )
        latency_ms = (time.perf_counter() - start) * 1000
        if resp.status_code == 200:
            results.append(latency_ms)
        else:
            errors.append(f"HTTP {resp.status_code}: {resp.text[:120]}")
    except Exception as exc:
        errors.append(str(exc))


def _simulate_batch_load(
    client: httpx.Client,
    base_url: str,
    batch_size: int,
    stop_event: threading.Event,
) -> None:
    """
    Continuously send POST /analyze-batch requests until *stop_event* is set.
    Simulates the CPU-bound batch inference work that the batch service
    previously ran in the same process as the inference endpoints.
    """
    payload = [ANALYZE_PAYLOAD["text"]] * batch_size
    while not stop_event.is_set():
        try:
            client.post(
                f"{base_url}/analyze-batch",
                json=payload,
                headers={"X-API-Key": API_KEY},
                timeout=60.0,
            )
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Core benchmark runner
# ---------------------------------------------------------------------------

def run_benchmark(
    base_url: str = "http://localhost:8000",
    total_requests: int = DEFAULT_INFERENCE_REQUESTS,
    concurrency: int = DEFAULT_CONCURRENCY,
    batch_size: int = DEFAULT_BATCH_SIZE,
    concurrent_batches: int = DEFAULT_CONCURRENT_BATCHES,
    warmup_requests: int = DEFAULT_WARMUP_REQUESTS,
    label: str = "benchmark",
    output_dir: str = "./data",
) -> dict[str, Any]:
    """
    Run the inference latency benchmark.

    Args:
        base_url:           Base URL of the inference service.
        total_requests:     Number of timing samples to collect.
        concurrency:        Number of parallel threads sending inference probes.
        batch_size:         Number of texts per background batch request.
        concurrent_batches: Number of background threads continuously sending
                            batch requests.  Set to 0 for an idle-baseline run.
        warmup_requests:    Requests sent (sequentially) before timing begins.
        label:              Freeform label written into the result (e.g. "before"
                            / "after", or a git SHA).
        output_dir:         Directory to write ``benchmark_<label>.json``.

    Returns:
        Dict with latency percentiles, error rate, and benchmark metadata.
    """
    os.makedirs(output_dir, exist_ok=True)

    with httpx.Client() as client:
        # ── Warmup ────────────────────────────────────────────────────────
        print(f"[benchmark] Warming up ({warmup_requests} requests)…")
        for _ in range(warmup_requests):
            try:
                client.post(
                    f"{base_url}/analyze",
                    json=ANALYZE_PAYLOAD,
                    headers={"X-API-Key": API_KEY},
                    timeout=30.0,
                )
            except Exception:
                pass

        # ── Start background batch load ───────────────────────────────────
        stop_event = threading.Event()
        batch_threads: list[threading.Thread] = []

        if concurrent_batches > 0:
            print(
                f"[benchmark] Starting {concurrent_batches} background batch "
                f"thread(s) (batch_size={batch_size})…"
            )
            for i in range(concurrent_batches):
                t = threading.Thread(
                    target=_simulate_batch_load,
                    args=(client, base_url, batch_size, stop_event),
                    daemon=True,
                    name=f"batch-load-{i}",
                )
                t.start()
                batch_threads.append(t)
            # Brief settle time so load is established before timing begins.
            time.sleep(0.5)
        else:
            print("[benchmark] No background batch load (baseline run).")

        # ── Timed inference probes ────────────────────────────────────────
        print(
            f"[benchmark] Collecting {total_requests} inference samples "
            f"({concurrency} concurrent threads)…"
        )
        latencies: list[float] = []
        errors: list[str] = []
        started_at = datetime.now(timezone.utc).isoformat()
        wall_start = time.perf_counter()

        requests_per_thread, remainder = divmod(total_requests, concurrency)
        threads: list[threading.Thread] = []
        thread_results: list[list[float]] = [[] for _ in range(concurrency)]
        thread_errors: list[list[str]] = [[] for _ in range(concurrency)]

        for idx in range(concurrency):
            n = requests_per_thread + (1 if idx < remainder else 0)

            def _worker(n=n, results=thread_results[idx], errs=thread_errors[idx]):
                for _ in range(n):
                    _probe_inference(client, base_url, results, errs)

            t = threading.Thread(target=_worker, daemon=True)
            t.start()
            threads.append(t)

        for t in threads:
            t.join()

        wall_elapsed = time.perf_counter() - wall_start

        # ── Stop batch load ───────────────────────────────────────────────
        stop_event.set()

        for tl, errs in zip(thread_results, thread_errors):
            latencies.extend(tl)
            errors.extend(errs)

    # ── Compute statistics ────────────────────────────────────────────────
    if not latencies:
        print("[benchmark] ⚠️  No successful latency samples recorded!", file=sys.stderr)
        stats: dict[str, Any] = {"error": "no_samples"}
    else:
        sorted_lats = sorted(latencies)
        stats = {
            "count": len(latencies),
            "min_ms": round(sorted_lats[0], 2),
            "p50_ms": round(statistics.median(latencies), 2),
            "p90_ms": round(sorted_lats[int(len(sorted_lats) * 0.90)], 2),
            "p95_ms": round(sorted_lats[int(len(sorted_lats) * 0.95)], 2),
            "p99_ms": round(sorted_lats[min(int(len(sorted_lats) * 0.99), len(sorted_lats) - 1)], 2),
            "max_ms": round(sorted_lats[-1], 2),
            "mean_ms": round(statistics.mean(latencies), 2),
            "stdev_ms": round(statistics.stdev(latencies), 2) if len(latencies) > 1 else 0.0,
        }

    result: dict[str, Any] = {
        "label": label,
        "started_at": started_at,
        "base_url": base_url,
        "config": {
            "total_requests": total_requests,
            "concurrency": concurrency,
            "batch_size": batch_size,
            "concurrent_batches": concurrent_batches,
            "warmup_requests": warmup_requests,
        },
        "latency_ms": stats,
        "error_count": len(errors),
        "error_rate": round(len(errors) / max(total_requests, 1), 4),
        "wall_time_seconds": round(wall_elapsed, 3),
        "throughput_rps": round(len(latencies) / max(wall_elapsed, 0.001), 2),
    }
    if errors[:10]:
        result["sample_errors"] = errors[:10]

    # ── Print summary ─────────────────────────────────────────────────────
    print()
    print(f"{'─' * 50}")
    print(f"  Benchmark: {label}")
    print(f"  Concurrent batch threads: {concurrent_batches}")
    print(f"{'─' * 50}")
    if "error" not in stats:
        print(f"  Samples:    {stats['count']}")
        print(f"  Errors:     {result['error_count']}  ({result['error_rate']:.1%})")
        print(f"  Throughput: {result['throughput_rps']} req/s")
        print(f"  Latency  p50={stats['p50_ms']} ms  p90={stats['p90_ms']} ms  "
              f"p95={stats['p95_ms']} ms  p99={stats['p99_ms']} ms")
    else:
        print("  No successful samples — check service health.")
    print(f"{'─' * 50}")

    # ── Write to disk ─────────────────────────────────────────────────────
    out_path = os.path.join(output_dir, f"benchmark_{label}.json")
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2)
    print(f"[benchmark] Results written to {out_path}")

    return result


def compare_results(before_path: str, after_path: str) -> None:
    """Print a side-by-side comparison of two benchmark result files."""
    with open(before_path, encoding="utf-8") as fh:
        before = json.load(fh)
    with open(after_path, encoding="utf-8") as fh:
        after = json.load(fh)

    def _lat(r: dict, pct: str) -> float:
        return r.get("latency_ms", {}).get(pct, float("nan"))

    def _delta(b: float, a: float) -> str:
        if b == 0:
            return "N/A"
        delta = (a - b) / b * 100
        sign = "+" if delta > 0 else ""
        return f"{sign}{delta:.1f}%"

    print()
    print(f"{'Metric':<22} {'Before':>12} {'After':>12} {'Δ':>10}")
    print("─" * 60)
    for pct in ("p50_ms", "p90_ms", "p95_ms", "p99_ms", "mean_ms"):
        b = _lat(before, pct)
        a = _lat(after, pct)
        print(f"  {pct:<20} {b:>12.1f} {a:>12.1f} {_delta(b, a):>10}")

    b_thr = before.get("throughput_rps", 0)
    a_thr = after.get("throughput_rps", 0)
    print(f"  {'throughput_rps':<20} {b_thr:>12.1f} {a_thr:>12.1f} {_delta(b_thr, a_thr):>10}")
    b_err = before.get("error_rate", 0)
    a_err = after.get("error_rate", 0)
    print(f"  {'error_rate':<20} {b_err:>12.3f} {a_err:>12.3f} {_delta(b_err, a_err):>10}")
    print()
    print(f"  Batch threads — before: {before['config']['concurrent_batches']}  "
          f"after: {after['config']['concurrent_batches']}")
    print()


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def _cli() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Measure inference latency under concurrent batch load (issue #1628). "
            "Run twice — once with --concurrent-batches 0 (baseline) and once with "
            "--concurrent-batches 4 (under load) — then compare with --compare."
        )
    )
    parser.add_argument("--url", default="http://localhost:8000", help="Base URL of the inference service")
    parser.add_argument("--requests", type=int, default=DEFAULT_INFERENCE_REQUESTS, help="Number of inference probes")
    parser.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY, help="Parallel probe threads")
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE, help="Items per background batch request")
    parser.add_argument("--concurrent-batches", type=int, default=0, help="Background batch threads (0 = baseline)")
    parser.add_argument("--warmup", type=int, default=DEFAULT_WARMUP_REQUESTS, help="Warmup requests")
    parser.add_argument("--label", default="benchmark", help="Label for the result file")
    parser.add_argument("--output-dir", default="./data", help="Directory for result JSON files")
    parser.add_argument(
        "--compare",
        nargs=2,
        metavar=("BEFORE_JSON", "AFTER_JSON"),
        help="Compare two result files instead of running a benchmark",
    )
    args = parser.parse_args()

    if args.compare:
        compare_results(args.compare[0], args.compare[1])
        return

    run_benchmark(
        base_url=args.url,
        total_requests=args.requests,
        concurrency=args.concurrency,
        batch_size=args.batch_size,
        concurrent_batches=args.concurrent_batches,
        warmup_requests=args.warmup,
        label=args.label,
        output_dir=args.output_dir,
    )


if __name__ == "__main__":
    _cli()
