#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Smoke test for the local stack (issue #1645). Standard library only.

Waits for ``GET /health``, then sends an authenticated ``POST /analyze`` and
checks the text was actually scored. Exit code 0 = pass, 1 = fail, so the same
script works on a laptop and in CI.

    python scripts/local_smoke.py [--url http://localhost:8000]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

SAMPLE_TEXT = "Stellar adoption is growing and investors feel bullish and optimistic"


def call(url, payload=None, api_key=None, timeout=10):
    """Return ``(status, parsed_json_or_None)``; HTTP errors keep their status."""
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if api_key:
        headers["X-API-Key"] = api_key
    request = urllib.request.Request(url, data=body, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as resp:
            raw, status = resp.read(), resp.status
    except urllib.error.HTTPError as exc:
        raw, status = exc.read(), exc.code
    try:
        return status, json.loads(raw.decode("utf-8"))
    except ValueError:
        return status, None


def wait_for_health(base, timeout):
    deadline = time.monotonic() + timeout
    while True:
        try:
            status, _ = call(f"{base}/health", timeout=5)
            if status == 200:
                return True
        except OSError:  # URLError, refused/reset connections, timeouts
            pass
        if time.monotonic() >= deadline:
            return False
        time.sleep(2)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Smoke test the local stack.")
    parser.add_argument("--url", default=os.getenv("SMOKE_BASE_URL", "http://localhost:8000"))
    parser.add_argument("--api-key", default=os.getenv("API_KEY", "local-dev-key"))
    parser.add_argument("--timeout", type=int, default=int(os.getenv("SMOKE_TIMEOUT", "180")))
    args = parser.parse_args(argv)
    base = args.url.rstrip("/")

    print(f"Waiting up to {args.timeout}s for {base}/health ...")
    if not wait_for_health(base, args.timeout):
        print("FAIL: /health did not return 200 in time", file=sys.stderr)
        return 1
    print("OK   GET /health")

    try:
        status, body = call(f"{base}/analyze", {"text": SAMPLE_TEXT}, args.api_key)
    except OSError as exc:
        print(f"FAIL: POST /analyze -> {exc}", file=sys.stderr)
        return 1
    if status != 200 or not isinstance(body, dict) or body.get("scored") is not True:
        print(f"FAIL: POST /analyze -> {status} {body}", file=sys.stderr)
        return 1
    print(f"OK   POST /analyze -> {json.dumps(body)}")
    print("Smoke test passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
