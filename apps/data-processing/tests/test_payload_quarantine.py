"""
tests/test_payload_quarantine.py

Unit tests for the payload quarantine module (issue #879).

Covers:
- Malformed payloads are quarantined with context (quarantine_id, source, reason,
  error_detail, timestamp, original payload).
- Healthy payloads continue processing; the pipeline is NOT interrupted.
- Maintainers can inspect quarantined items (list_entries / iter_entries).
- Replay path: replay() attempts re-processing and records results.
- Thread-safety: concurrent writes do not corrupt the JSONL log.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import List

import pytest

from src.ingestion.payload_quarantine import (
    QuarantinedPayload,
    QuarantineStore,
    process_with_quarantine,
    quarantine_on_error,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def store(tmp_path: Path) -> QuarantineStore:
    """Return a QuarantineStore backed by a temp file."""
    return QuarantineStore(quarantine_path=str(tmp_path / "quarantine.jsonl"))


# ---------------------------------------------------------------------------
# 1. Malformed payloads are quarantined with context
# ---------------------------------------------------------------------------

class TestQuarantineAdd:
    def test_entry_is_written_to_file(self, store: QuarantineStore) -> None:
        payload = {"metric_id": None, "value": "bad"}
        store.add(payload, reason="validation_failed", source="stellar_fetcher")
        assert store.path.exists()
        lines = store.path.read_text().strip().splitlines()
        assert len(lines) == 1

    def test_entry_has_required_fields(self, store: QuarantineStore) -> None:
        payload = {"bad": True}
        entry = store.add(
            payload,
            reason="missing_required_field",
            source="news_fetcher",
            error_detail="title is required",
        )
        assert entry.quarantine_id  # non-empty UUID
        assert entry.source == "news_fetcher"
        assert entry.reason == "missing_required_field"
        assert entry.error_detail == "title is required"
        assert entry.payload == payload
        assert entry.quarantined_at  # ISO timestamp

    def test_entry_payload_is_preserved_exactly(self, store: QuarantineStore) -> None:
        payload = {"metric_id": "m1", "value": None, "chain": "stellar", "nested": {"x": 1}}
        entry = store.add(payload, reason="validation_failed", source="stellar_fetcher")
        assert entry.payload == payload

    def test_tags_are_stored(self, store: QuarantineStore) -> None:
        entry = store.add(
            {"x": 1},
            reason="unexpected_exception",
            source="price_fetcher",
            tags=["stellar", "testnet"],
        )
        assert "stellar" in entry.tags
        assert "testnet" in entry.tags

    def test_multiple_entries_append_correctly(self, store: QuarantineStore) -> None:
        for i in range(5):
            store.add({"i": i}, reason="validation_failed", source="test")
        assert store.count() == 5

    def test_quarantine_id_is_unique_per_entry(self, store: QuarantineStore) -> None:
        ids = [
            store.add({"n": i}, reason="r", source="s").quarantine_id for i in range(10)
        ]
        assert len(set(ids)) == 10


# ---------------------------------------------------------------------------
# 2. Healthy payloads continue processing (pipeline not interrupted)
# ---------------------------------------------------------------------------

class TestHealthyPayloadsContinue:
    def test_process_with_quarantine_healthy_payloads_all_processed(
        self, store: QuarantineStore
    ) -> None:
        results: List[int] = []

        def processor(payload):
            results.append(payload["value"])

        payloads = [{"value": i} for i in range(5)]
        stats = process_with_quarantine(payloads, processor, store, source="test")

        assert stats["processed"] == 5
        assert stats["quarantined"] == 0
        assert results == list(range(5))

    def test_process_with_quarantine_bad_payloads_dont_stop_pipeline(
        self, store: QuarantineStore
    ) -> None:
        results: List[int] = []

        def processor(payload):
            if payload.get("bad"):
                raise ValueError("malformed")
            results.append(payload["value"])

        payloads = [
            {"value": 0},
            {"bad": True},        # will be quarantined
            {"value": 1},
            {"bad": True},        # will be quarantined
            {"value": 2},
        ]
        stats = process_with_quarantine(payloads, processor, store, source="stellar_fetcher")

        assert stats["processed"] == 3
        assert stats["quarantined"] == 2
        assert results == [0, 1, 2]

    def test_quarantine_on_error_suppresses_exception(
        self, store: QuarantineStore
    ) -> None:
        executed_after = False
        payload = {"broken": True}

        with quarantine_on_error(store, payload, source="news_fetcher"):
            raise RuntimeError("boom")

        executed_after = True  # should be reached
        assert executed_after
        assert store.count() == 1

    def test_quarantine_on_error_healthy_path_no_quarantine(
        self, store: QuarantineStore
    ) -> None:
        payload = {"metric_id": "ok", "value": 1.0}
        processed = []

        with quarantine_on_error(store, payload, source="stellar_fetcher"):
            processed.append(payload)

        assert len(processed) == 1
        assert store.count() == 0

    def test_mixed_batch_correct_quarantine_count(
        self, store: QuarantineStore
    ) -> None:
        good = [{"v": i} for i in range(10)]
        bad = [{"bad": True} for _ in range(3)]
        all_payloads = good + bad

        def processor(p):
            if p.get("bad"):
                raise ValueError("bad payload")

        stats = process_with_quarantine(all_payloads, processor, store, source="test")
        assert stats["processed"] == 10
        assert stats["quarantined"] == 3


# ---------------------------------------------------------------------------
# 3. Maintainers can inspect quarantined items
# ---------------------------------------------------------------------------

class TestInspection:
    def test_list_entries_returns_all(self, store: QuarantineStore) -> None:
        store.add({"a": 1}, reason="r1", source="s1")
        store.add({"b": 2}, reason="r2", source="s2")
        entries = store.list_entries()
        assert len(entries) == 2

    def test_list_entries_filter_by_source(self, store: QuarantineStore) -> None:
        store.add({}, reason="r", source="stellar_fetcher")
        store.add({}, reason="r", source="news_fetcher")
        store.add({}, reason="r", source="stellar_fetcher")
        entries = store.list_entries(source="stellar_fetcher")
        assert len(entries) == 2
        assert all(e.source == "stellar_fetcher" for e in entries)

    def test_list_entries_filter_by_reason(self, store: QuarantineStore) -> None:
        store.add({}, reason="validation_failed", source="s")
        store.add({}, reason="unexpected_exception", source="s")
        entries = store.list_entries(reason="validation_failed")
        assert len(entries) == 1
        assert entries[0].reason == "validation_failed"

    def test_list_entries_filter_replayed(self, store: QuarantineStore) -> None:
        store.add({}, reason="r", source="s")
        pending = store.list_entries(replayed=False)
        assert len(pending) == 1

    def test_iter_entries_yields_correct_type(self, store: QuarantineStore) -> None:
        store.add({"x": 1}, reason="r", source="s")
        entries = list(store.iter_entries())
        assert isinstance(entries[0], QuarantinedPayload)

    def test_count_empty_store(self, store: QuarantineStore) -> None:
        assert store.count() == 0

    def test_count_after_additions(self, store: QuarantineStore) -> None:
        store.add({}, reason="r", source="s")
        store.add({}, reason="r", source="s")
        assert store.count() == 2

    def test_list_entries_on_empty_store(self, store: QuarantineStore) -> None:
        assert store.list_entries() == []

    def test_persisted_jsonl_is_valid(self, store: QuarantineStore) -> None:
        store.add({"k": "v"}, reason="r", source="s")
        lines = store.path.read_text().strip().splitlines()
        for line in lines:
            data = json.loads(line)
            assert "quarantine_id" in data
            assert "source" in data
            assert "reason" in data
            assert "payload" in data
            assert "quarantined_at" in data


# ---------------------------------------------------------------------------
# 4. Replay path
# ---------------------------------------------------------------------------

class TestReplay:
    def test_replay_succeeds_for_fixed_payloads(
        self, store: QuarantineStore
    ) -> None:
        store.add({"value": 1}, reason="validation_failed", source="s")
        store.add({"value": 2}, reason="validation_failed", source="s")

        processed = []

        def processor(payload):
            processed.append(payload["value"])

        entries = store.list_entries()
        result = store.replay(entries, processor)

        assert result["attempted"] == 2
        assert result["succeeded"] == 2
        assert result["failed"] == 0
        assert sorted(processed) == [1, 2]

    def test_replay_records_failures(self, store: QuarantineStore) -> None:
        store.add({"bad": True}, reason="r", source="s")

        def processor(payload):
            raise ValueError("still broken")

        entries = store.list_entries()
        result = store.replay(entries, processor)

        assert result["attempted"] == 1
        assert result["succeeded"] == 0
        assert result["failed"] == 1
        assert result["errors"][0]["quarantine_id"]

    def test_replay_writes_sidecar_for_successes(
        self, store: QuarantineStore
    ) -> None:
        store.add({"ok": True}, reason="r", source="s")

        def processor(payload):
            pass  # success

        entries = store.list_entries()
        store.replay(entries, processor, mark_replayed=True)

        sidecar = store.path.with_suffix(".replayed.jsonl")
        assert sidecar.exists()
        lines = sidecar.read_text().strip().splitlines()
        assert len(lines) == 1
        data = json.loads(lines[0])
        assert data["replayed"] is True

    def test_replay_partial_success(self, store: QuarantineStore) -> None:
        store.add({"good": True}, reason="r", source="s")
        store.add({"bad": True}, reason="r", source="s")

        def processor(payload):
            if payload.get("bad"):
                raise ValueError("bad")

        entries = store.list_entries()
        result = store.replay(entries, processor)

        assert result["succeeded"] == 1
        assert result["failed"] == 1


# ---------------------------------------------------------------------------
# 5. Thread-safety
# ---------------------------------------------------------------------------

class TestThreadSafety:
    def test_concurrent_writes_produce_correct_count(
        self, store: QuarantineStore
    ) -> None:
        n_threads = 20
        writes_per_thread = 10
        errors: List[Exception] = []

        def writer():
            try:
                for i in range(writes_per_thread):
                    store.add({"i": i}, reason="r", source="thread_test")
            except Exception as exc:
                errors.append(exc)

        threads = [threading.Thread(target=writer) for _ in range(n_threads)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert not errors
        assert store.count() == n_threads * writes_per_thread

    def test_concurrent_writes_each_line_valid_json(
        self, store: QuarantineStore
    ) -> None:
        def writer():
            for i in range(5):
                store.add({"i": i}, reason="r", source="t")

        threads = [threading.Thread(target=writer) for _ in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        lines = store.path.read_text().strip().splitlines()
        for line in lines:
            json.loads(line)  # must not raise