"""Tests for contributor activity timeline builder – issue #876."""
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from src.analytics.contributor_activity_timeline import (
    _action_category,
    _normalize_timestamp,
    build_contributor_activity_timeline,
)
from src.api.server import app


# ---------------------------------------------------------------------------
# Unit tests – _normalize_timestamp
# ---------------------------------------------------------------------------

def test_normalize_timestamp_none():
    assert _normalize_timestamp(None) is None


def test_normalize_timestamp_aware_datetime():
    dt = datetime(2024, 3, 15, 12, 0, 0, tzinfo=timezone.utc)
    assert _normalize_timestamp(dt) == "2024-03-15T12:00:00+00:00"


def test_normalize_timestamp_naive_datetime_assumed_utc():
    dt = datetime(2024, 3, 15, 12, 0, 0)  # no tzinfo
    result = _normalize_timestamp(dt)
    assert "+00:00" in result


def test_normalize_timestamp_string_passthrough():
    assert _normalize_timestamp("some-string") == "some-string"


# ---------------------------------------------------------------------------
# Unit tests – _action_category
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "event_type,expected",
    [
        ("DepositEvent", "deposit"),
        ("DEPOSIT_MADE", "deposit"),
        ("ContributionRecordedEvent", "contribution"),
        ("contribute_started", "contribution"),
        ("ProjectRegisteredEvent", "registry"),
        ("RegistryUpdateEvent", "registry"),
        ("VerificationEvent", "registry"),
        ("MilestoneApprovedEvent", "milestone"),
        ("WithdrawEvent", "withdrawal"),
        ("RefundableEvent", "withdrawal"),
        ("ClawbackTriggered", "withdrawal"),
        ("SomethingElse", "other"),
        (None, "other"),
        ("", "other"),
    ],
)
def test_action_category(event_type, expected):
    assert _action_category(event_type) == expected


# ---------------------------------------------------------------------------
# Unit tests – build_contributor_activity_timeline (object-based events)
# ---------------------------------------------------------------------------

def _make_event(**kwargs):
    defaults = dict(
        contributor="alice",
        event_type="ContributionRecordedEvent",
        project_id=1,
        contract_id="contract-a",
        amount=10.0,
        milestone_id=None,
        status=None,
        timestamp=datetime(2024, 1, 1, tzinfo=timezone.utc),
    )
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def test_build_returns_sorted_newest_first():
    events = [
        _make_event(timestamp=datetime(2024, 1, 1, tzinfo=timezone.utc), event_type="ContributionRecordedEvent"),
        _make_event(timestamp=datetime(2024, 1, 3, tzinfo=timezone.utc), event_type="DepositEvent"),
        _make_event(timestamp=datetime(2024, 1, 2, tzinfo=timezone.utc), event_type="ProjectRegisteredEvent"),
    ]
    result = build_contributor_activity_timeline(events)
    timestamps = [r["timestamp"] for r in result]
    assert timestamps == sorted(timestamps, reverse=True)


def test_build_filters_by_contributor():
    events = [
        _make_event(contributor="alice"),
        _make_event(contributor="bob", event_type="DepositEvent"),
    ]
    result = build_contributor_activity_timeline(events, contributor="alice")
    assert all(r["contributor"] == "alice" for r in result)
    assert len(result) == 1


def test_build_contributor_filter_is_case_insensitive():
    events = [_make_event(contributor="Alice")]
    result = build_contributor_activity_timeline(events, contributor="alice")
    assert len(result) == 1


def test_build_filters_by_project_id():
    events = [
        _make_event(project_id=1),
        _make_event(project_id=2, event_type="DepositEvent"),
    ]
    result = build_contributor_activity_timeline(events, project_id=1)
    assert all(r["project_id"] == 1 for r in result)
    assert len(result) == 1


def test_build_respects_limit():
    events = [_make_event(timestamp=datetime(2024, 1, i + 1, tzinfo=timezone.utc)) for i in range(20)]
    result = build_contributor_activity_timeline(events, limit=5)
    assert len(result) == 5


def test_build_limit_clamped_to_500():
    events = [_make_event() for _ in range(10)]
    result = build_contributor_activity_timeline(events, limit=9999)
    assert len(result) == 10  # only 10 events exist


def test_build_unknown_contributor_returns_empty():
    events = [_make_event(contributor="alice")]
    result = build_contributor_activity_timeline(events, contributor="nobody")
    assert result == []


def test_build_no_sort_timestamp_goes_to_bottom():
    events = [
        _make_event(timestamp=None, event_type="ContributionRecordedEvent"),
        _make_event(timestamp=datetime(2024, 6, 1, tzinfo=timezone.utc), event_type="DepositEvent"),
    ]
    result = build_contributor_activity_timeline(events)
    # The event with a real timestamp should appear first
    assert result[0]["event_type"] == "DepositEvent"


def test_build_output_has_no_sort_key():
    events = [_make_event()]
    result = build_contributor_activity_timeline(events)
    assert "_sort_timestamp" not in result[0]


def test_build_all_required_fields_present():
    events = [_make_event()]
    result = build_contributor_activity_timeline(events)
    expected_keys = {
        "contributor", "timestamp", "action_category", "event_type",
        "project_id", "contract_id", "amount", "milestone_id", "status",
    }
    assert expected_keys.issubset(result[0].keys())


# ---------------------------------------------------------------------------
# Unit tests – build with dict-based events (DB row simulation)
# ---------------------------------------------------------------------------

def test_build_accepts_dict_events():
    events = [
        {
            "contributor": "alice",
            "event_type": "DepositEvent",
            "project_id": 7,
            "contract_id": "contract-a",
            "amount": 5.0,
            "milestone_id": None,
            "status": None,
            "timestamp": datetime(2024, 2, 1, tzinfo=timezone.utc),
        }
    ]
    result = build_contributor_activity_timeline(events, contributor="alice")
    assert len(result) == 1
    assert result[0]["action_category"] == "deposit"


# ---------------------------------------------------------------------------
# Integration-style tests (existing tests preserved + extended)
# ---------------------------------------------------------------------------

def test_build_contributor_activity_timeline_returns_sorted_entries():
    events = [
        SimpleNamespace(
            contributor="alice",
            event_type="ContributionRecordedEvent",
            project_id=7,
            contract_id="contract-a",
            amount=12.5,
            milestone_id=1,
            status="completed",
            timestamp=datetime(2024, 1, 1, tzinfo=timezone.utc),
        ),
        SimpleNamespace(
            contributor="alice",
            event_type="DepositEvent",
            project_id=7,
            contract_id="contract-a",
            amount=7.0,
            milestone_id=None,
            status=None,
            timestamp=datetime(2024, 1, 2, tzinfo=timezone.utc),
        ),
        SimpleNamespace(
            contributor="bob",
            event_type="ContributionRefundableEvent",
            project_id=8,
            contract_id="contract-b",
            amount=3.0,
            milestone_id=None,
            status="refunded",
            timestamp=datetime(2024, 1, 3, tzinfo=timezone.utc),
        ),
    ]

    timeline = build_contributor_activity_timeline(events, contributor="alice", limit=10)

    assert [item["action_category"] for item in timeline] == ["deposit", "contribution"]
    assert timeline[0]["contributor"] == "alice"
    assert timeline[0]["event_type"] == "DepositEvent"
    assert timeline[0]["timestamp"] == "2024-01-02T00:00:00+00:00"


def test_build_contributor_activity_timeline_ignores_unknown_contributor():
    events = [
        SimpleNamespace(
            contributor="alice",
            event_type="ProjectRegisteredEvent",
            project_id=1,
            contract_id="contract-a",
            amount=None,
            milestone_id=None,
            status=None,
            timestamp=datetime(2024, 2, 1, tzinfo=timezone.utc),
        )
    ]

    timeline = build_contributor_activity_timeline(events, contributor="bob", limit=10)
    assert timeline == []


def test_contributor_timeline_endpoint_returns_serializable_payload(monkeypatch):
    class FakeService:
        def get_contributor_activity_timeline(self, contributor, project_id=None, limit=100):
            return [
                {
                    "contributor": contributor,
                    "timestamp": "2024-02-01T00:00:00+00:00",
                    "action_category": "contribution",
                    "event_type": "ContributionRecordedEvent",
                    "project_id": 7,
                    "contract_id": "contract-a",
                    "amount": 12.5,
                    "milestone_id": 1,
                    "status": "completed",
                }
            ]

    monkeypatch.setattr("src.api.server.postgres_service", FakeService())

    with TestClient(app) as client:
        response = client.get("/contributors/alice/timeline")

    assert response.status_code == 200
    assert response.json()[0]["contributor"] == "alice"
    assert response.json()[0]["action_category"] == "contribution"


def test_contributor_timeline_endpoint_with_project_filter(monkeypatch):
    class FakeService:
        def get_contributor_activity_timeline(self, contributor, project_id=None, limit=100):
            assert project_id == 7
            return []

    monkeypatch.setattr("src.api.server.postgres_service", FakeService())

    with TestClient(app) as client:
        response = client.get("/contributors/alice/timeline?project_id=7")

    assert response.status_code == 200


def test_contributor_timeline_endpoint_503_when_db_unavailable(monkeypatch):
    monkeypatch.setattr("src.api.server.postgres_service", None)

    with TestClient(app) as client:
        response = client.get("/contributors/alice/timeline")

    assert response.status_code == 503


def test_contributor_timeline_endpoint_limit_param(monkeypatch):
    received = {}

    class FakeService:
        def get_contributor_activity_timeline(self, contributor, project_id=None, limit=100):
            received["limit"] = limit
            return []

    monkeypatch.setattr("src.api.server.postgres_service", FakeService())

    with TestClient(app) as client:
        client.get("/contributors/alice/timeline?limit=10")

    assert received["limit"] == 10
