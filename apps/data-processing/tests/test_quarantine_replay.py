"""
tests/test_quarantine_replay.py

Unit tests for the quarantine replay service (issue #1453).

Covers:
- Happy path: a quarantined payload that now passes validation is written
  downstream and marked replayed.
- Still failing: a payload that fails validation again remains quarantined
  with an updated error detail and last_attempted_at.
- Idempotency: replaying twice produces exactly one downstream record.
- Dry run: reports counts and makes no changes to the database/files.
- Filters: since/until/source narrow the selection.
- Empty result: no matching payloads returns a clean summary with zeros.
- Sink failure: a downstream write error leaves the quarantine row unchanged.
"""

from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path

import pytest

from src.ingestion.payload_quarantine import (
    REPLAY_STATUS_PENDING,
    REPLAY_STATUS_REPLAYED,
    QuarantineStore,
)
from src.ingestion.quarantine_replay import (
    QuarantineReplayService,
    ReplaySink,
    parse_iso8601,
    payload_fingerprint,
    select_entries,
    select_validator,
    validator_failure_message,
)


@pytest.fixture()
def store(tmp_path: Path) -> QuarantineStore:
    """Return a QuarantineStore backed by a temp file."""
    return QuarantineStore(quarantine_path=str(tmp_path / "quarantine.jsonl"))


@pytest.fixture()
def sink_path(tmp_path: Path) -> str:
    """Return a temp sink path."""
    return str(tmp_path / "replay_sink.jsonl")


@pytest.fixture()
def service(store: QuarantineStore, sink_path: str) -> QuarantineReplayService:
    """Return a replay service wired to temp storage."""
    return QuarantineReplayService(store=store, sink=ReplaySink(sink_path=sink_path))


def _add_entry(
    store: QuarantineStore,
    payload,
    *,
    source: str = "news_fetcher",
    reason: str = "validation_failed",
    quarantined_at: str,
):
    entry = store.add(
        payload,
        reason=reason,
        source=source,
        error_detail="original failure",
    )
    store.update_entry(entry.quarantine_id, quarantined_at=quarantined_at)
    return entry


def _valid_news_payload(n: int = 1) -> dict:
    return {
        "id": f"n{n}",
        "title": f"Title {n}",
        "content": "Body",
        "published_at": "2026-01-01T00:00:00+00:00",
        "source": "unit-test",
        "url": "https://example.com/a",
    }


def _invalid_news_payload() -> dict:
    return {
        "id": "bad",
        "content": "missing title",
        "published_at": "",
    }


# ---------------------------------------------------------------------------
# Validator selection and failure messages
# ---------------------------------------------------------------------------


class TestValidatorSelection:
    def test_news_source_maps_to_news_validator(self):
        assert select_validator("news_fetcher") is not None

    def test_stellar_source_maps_to_onchain_validator(self):
        assert select_validator("stellar_fetcher") is not None

    def test_unknown_source_has_no_validator(self):
        assert select_validator("mystery_source") is None

    def test_failure_message_uses_validator_error_text(self):
        message = validator_failure_message(
            select_validator("news_fetcher"), _invalid_news_payload()
        )
        assert message
        assert "title" in message.lower()

    def test_failure_message_empty_for_valid_payload(self):
        message = validator_failure_message(
            select_validator("news_fetcher"), _valid_news_payload()
        )
        assert message == ""


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


class TestHappyPath:
    def test_fixed_payload_is_written_downstream_and_marked_replayed(
        self, store, sink_path, service
    ):
        _add_entry(
            store, _valid_news_payload(), quarantined_at="2026-01-01T00:00:00+00:00"
        )

        summary = service.replay()

        assert summary["scanned"] == 1
        assert summary["replayed"] == 1
        assert summary["still_failing"] == 0
        assert summary["errors"] == 0

        sink_lines = Path(sink_path).read_text().strip().splitlines()
        assert len(sink_lines) == 1
        record = json.loads(sink_lines[0])
        assert record["payload"] == _valid_news_payload()

        updated = store.list_entries()[0]
        assert updated.status == REPLAY_STATUS_REPLAYED
        assert updated.replayed is True
        assert updated.replayed_at is not None
        assert updated.last_attempted_at is not None

    def test_fingerprint_is_stable_and_order_insensitive(self):
        a = payload_fingerprint({"x": 1, "y": [1, 2]})
        b = payload_fingerprint({"y": [1, 2], "x": 1})
        assert a == b
        assert a != payload_fingerprint({"x": 2, "y": [1, 2]})


# ---------------------------------------------------------------------------
# Still failing
# ---------------------------------------------------------------------------


class TestStillFailing:
    def test_still_failing_payload_stays_quarantined_with_updated_reason(
        self, store, service, sink_path
    ):
        _add_entry(
            store, _invalid_news_payload(), quarantined_at="2026-01-01T00:00:00+00:00"
        )

        summary = service.replay()

        assert summary["replayed"] == 0
        assert summary["still_failing"] == 1
        assert Path(sink_path).exists() is False

        updated = store.list_entries()[0]
        assert updated.status == REPLAY_STATUS_PENDING
        assert updated.replayed is False
        assert updated.replayed_at is None
        assert updated.last_attempted_at is not None
        assert "title" in (updated.error_detail or "").lower()
        assert updated.error_detail != "original failure"

    def test_reason_is_overwritten_not_appended(self, store, service):
        _add_entry(
            store, _invalid_news_payload(), quarantined_at="2026-01-01T00:00:00+00:00"
        )

        service.replay()
        first_reason = store.list_entries()[0].error_detail
        service.replay()
        second_reason = store.list_entries()[0].error_detail

        assert first_reason == second_reason


# ---------------------------------------------------------------------------
# Idempotency
# ---------------------------------------------------------------------------


class TestIdempotency:
    def test_replay_twice_produces_exactly_one_downstream_record(
        self, store, service, sink_path
    ):
        store.add(
            _valid_news_payload(), reason="validation_failed", source="news_fetcher"
        )

        first = service.replay()
        second = service.replay()

        assert first["replayed"] == 1
        assert second["scanned"] == 0
        assert second["replayed"] == 0

        sink_lines = Path(sink_path).read_text().strip().splitlines()
        assert len(sink_lines) == 1

    def test_second_replay_marks_entry_skipped_not_replayed(self, store, service):
        store.add(
            _valid_news_payload(), reason="validation_failed", source="news_fetcher"
        )

        service.replay()
        summary = service.replay()

        assert summary["skipped"] == 0
        assert summary["scanned"] == 0

    def test_duplicate_fingerprint_in_sink_is_not_rewritten(self, sink_path):
        sink = ReplaySink(sink_path=sink_path)
        payload = {"a": 1}
        fingerprint = payload_fingerprint(payload)

        assert sink.write(payload, fingerprint) is True
        assert sink.write(payload, fingerprint) is False

        lines = Path(sink_path).read_text().strip().splitlines()
        assert len(lines) == 1


# ---------------------------------------------------------------------------
# Dry run
# ---------------------------------------------------------------------------


class TestDryRun:
    def test_dry_run_reports_counts_without_writes(self, store, service, sink_path):
        store.add(
            _valid_news_payload(), reason="validation_failed", source="news_fetcher"
        )
        store.add(
            _invalid_news_payload(),
            reason="validation_failed",
            source="news_fetcher",
        )

        summary = service.replay(dry_run=True)

        assert summary["dry_run"] is True
        assert summary["scanned"] == 2
        assert summary["replayed"] == 1
        assert summary["still_failing"] == 1

        assert not Path(sink_path).exists()
        for entry in store.list_entries():
            assert entry.status is None
            assert entry.replayed is False
            assert entry.replayed_at is None
            assert entry.last_attempted_at is None

    def test_dry_run_does_not_change_error_detail(self, store, service):
        entry = _add_entry(
            store, _invalid_news_payload(), quarantined_at="2026-01-01T00:00:00+00:00"
        )

        service.replay(dry_run=True)

        updated = store.list_entries()[0]
        assert updated.error_detail == "original failure"
        assert updated.last_attempted_at is None
        assert updated.quarantine_id == entry.quarantine_id


# ---------------------------------------------------------------------------
# Filters
# ---------------------------------------------------------------------------


class TestFilters:
    def test_since_filters_older_entries(self, store):
        _add_entry(
            store, _valid_news_payload(1), quarantined_at="2026-01-01T00:00:00+00:00"
        )
        _add_entry(
            store, _valid_news_payload(2), quarantined_at="2026-06-01T00:00:00+00:00"
        )

        entries = select_entries(store, since="2026-03-01T00:00:00+00:00")

        assert len(entries) == 1
        assert entries[0].payload["id"] == "n2"

    def test_until_filters_newer_entries(self, store):
        _add_entry(
            store, _valid_news_payload(1), quarantined_at="2026-01-01T00:00:00+00:00"
        )
        _add_entry(
            store, _valid_news_payload(2), quarantined_at="2026-06-01T00:00:00+00:00"
        )

        entries = select_entries(store, until="2026-03-01T00:00:00+00:00")

        assert len(entries) == 1
        assert entries[0].payload["id"] == "n1"

    def test_since_and_until_bounds_are_inclusive(self, store):
        _add_entry(
            store, _valid_news_payload(1), quarantined_at="2026-03-01T00:00:00+00:00"
        )
        _add_entry(
            store, _valid_news_payload(2), quarantined_at="2026-03-31T00:00:00+00:00"
        )
        _add_entry(
            store, _valid_news_payload(3), quarantined_at="2026-04-15T00:00:00+00:00"
        )

        entries = select_entries(
            store,
            since="2026-03-01T00:00:00+00:00",
            until="2026-03-31T00:00:00+00:00",
        )

        assert {e.payload["id"] for e in entries} == {"n1", "n2"}

    def test_source_filter_narrows_selection(self, store):
        _add_entry(
            store,
            _valid_news_payload(1),
            source="news_fetcher",
            quarantined_at="2026-01-01T00:00:00+00:00",
        )
        _add_entry(
            store,
            _valid_news_payload(2),
            source="stellar_fetcher",
            quarantined_at="2026-01-02T00:00:00+00:00",
        )

        entries = select_entries(store, source="stellar_fetcher")

        assert len(entries) == 1
        assert entries[0].source == "stellar_fetcher"

    def test_replayed_entries_are_excluded_by_default(self, store, service):
        store.add(
            _valid_news_payload(), reason="validation_failed", source="news_fetcher"
        )
        service.replay()

        entries = select_entries(store)

        assert entries == []

    def test_entries_with_unparseable_timestamp_are_dropped_when_filtered(self, store):
        _add_entry(store, _valid_news_payload(1), quarantined_at="not-a-timestamp")

        assert select_entries(store, since="2026-01-01T00:00:00+00:00") == []
        assert len(select_entries(store)) == 1


# ---------------------------------------------------------------------------
# Empty result
# ---------------------------------------------------------------------------


class TestEmptyResult:
    def test_no_matching_entries_returns_clean_summary(self, service):
        summary = service.replay()

        assert summary["scanned"] == 0
        assert summary["replayed"] == 0
        assert summary["still_failing"] == 0
        assert summary["errors"] == 0
        assert summary["skipped"] == 0
        assert summary["details"] == []

    def test_limit_zero_processes_nothing(self, store, service, sink_path):
        store.add(
            _valid_news_payload(), reason="validation_failed", source="news_fetcher"
        )

        summary = service.replay(limit=0)

        assert summary["scanned"] == 0
        assert not Path(sink_path).exists()


# ---------------------------------------------------------------------------
# Error handling
# ---------------------------------------------------------------------------


class TestErrorHandling:
    def test_non_dict_payload_is_reported_as_error(self, store, service):
        _add_entry(store, [1, 2, 3], quarantined_at="2026-01-01T00:00:00+00:00")

        summary = service.replay()

        assert summary["errors"] == 1
        assert summary["details"][0]["outcome"] == "error"

    def test_unknown_source_is_reported_as_error(self, store, service):
        _add_entry(
            store,
            {"anything": True},
            source="mystery_source",
            quarantined_at="2026-01-01T00:00:00+00:00",
        )

        summary = service.replay()

        assert summary["errors"] == 1
        assert "mystery_source" in summary["details"][0]["detail"]

    def test_sink_write_failure_leaves_quarantine_entry_unchanged(
        self, store, sink_path
    ):
        class FailingSink:
            def write(self, payload, fingerprint):
                raise OSError("disk full")

        failing_service = QuarantineReplayService(store=store, sink=FailingSink())
        _add_entry(
            store, _valid_news_payload(), quarantined_at="2026-01-01T00:00:00+00:00"
        )

        summary = failing_service.replay()

        assert summary["errors"] == 1
        assert summary["replayed"] == 0

        entry = store.list_entries()[0]
        assert entry.status is None
        assert entry.replayed is False
        assert entry.replayed_at is None
        assert entry.error_detail == "original failure"


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------


class TestParsing:
    def test_parse_iso8601_accepts_z_suffix(self):
        parsed = parse_iso8601("2026-01-01T00:00:00Z")
        assert parsed.tzinfo is not None

    def test_parse_iso8601_naive_is_treated_as_utc(self):
        parsed = parse_iso8601("2026-01-01T00:00:00")
        assert parsed.utcoffset() == timedelta(0)

    def test_parse_iso8601_rejects_garbage(self):
        with pytest.raises(ValueError):
            parse_iso8601("not-a-timestamp")

    def test_parse_iso8601_rejects_none(self):
        with pytest.raises(TypeError):
            parse_iso8601(None)

    def test_quarantined_at_can_be_updated_in_place(self, store):
        entry = store.add({}, reason="r", source="s")
        store.update_entry(
            entry.quarantine_id, quarantined_at="2026-01-01T00:00:00+00:00"
        )
        assert store.list_entries()[0].quarantined_at == "2026-01-01T00:00:00+00:00"

    def test_update_entry_syncs_legacy_replayed_flag(self, store):
        entry = store.add({}, reason="r", source="s")
        store.update_entry(entry.quarantine_id, status=REPLAY_STATUS_REPLAYED)
        assert store.list_entries()[0].replayed is True
        store.update_entry(entry.quarantine_id, status=REPLAY_STATUS_PENDING)
        assert store.list_entries()[0].replayed is False

    def test_update_entry_rejects_unknown_fields(self, store):
        entry = store.add({}, reason="r", source="s")
        with pytest.raises(ValueError):
            store.update_entry(entry.quarantine_id, not_a_field=1)

    def test_update_entry_returns_none_for_missing_id(self, store):
        assert store.update_entry("missing-id", reason="x") is None
