from src.ingestion.project_materialized_views import (
    build_data_quality_checks,
    refresh_project_materialized_views,
)


SAMPLE_EVENTS = [
    {
        "ledger": 100,
        "event_type": "ProjectCreatedEvent",
        "project_id": 42,
        "owner": "GOWNER",
    },
    {
        "ledger": 101,
        "event_type": "DepositEvent",
        "project_id": 42,
        "contributor": "GCONTRIB_A",
        "amount": 100,
    },
    {
        "ledger": 102,
        "event_type": "DepositEvent",
        "project_id": 42,
        "contributor": "GCONTRIB_B",
        "amount": 50,
    },
    {
        "ledger": 103,
        "event_type": "DepositEvent",
        "project_id": 42,
        "contributor": "GCONTRIB_A",
        "amount": 25,
    },
    {
        "ledger": 104,
        "event_type": "MilestoneApprovedEvent",
        "project_id": 42,
        "admin": "GADMIN",
    },
]


def test_refresh_project_materialized_views_tracks_totals_and_contributors() -> None:
    rows, checks = refresh_project_materialized_views(SAMPLE_EVENTS, existing_rows={})

    assert len(rows) == 1
    row = rows[0]
    assert row["project_id"] == 42
    assert row["total_contributed"] == 175
    assert row["contributor_count"] == 2
    assert row["milestone_approved"] is True
    assert row["last_processed_ledger"] == 104
    assert set(row["contributors"]) == {"GCONTRIB_A", "GCONTRIB_B"}

    assert checks["project_total_crosscheck"]["passed"] is True
    assert checks["project_total_crosscheck"]["details"]["project_totals"] == {42: 175}


def test_refresh_project_materialized_views_skips_processed_ledger_and_reports_drift() -> None:
    existing_rows = {
        42: {
            "project_id": 42,
            "total_contributed": 175,
            "contributor_count": 2,
            "milestone_approved": True,
            "contributors": {"GCONTRIB_A", "GCONTRIB_B"},
            "last_processed_ledger": 104,
        }
    }

    duplicate_event = {
        "ledger": 104,
        "event_type": "DepositEvent",
        "project_id": 42,
        "contributor": "GCONTRIB_A",
        "amount": 25,
    }

    rows, checks = refresh_project_materialized_views([duplicate_event], existing_rows=existing_rows)

    assert len(rows) == 1
    assert rows[0]["project_id"] == 42
    assert rows[0]["total_contributed"] == 175
    assert rows[0]["contributor_count"] == 2
    assert rows[0]["last_processed_ledger"] == 104
    assert rows[0]["contributors"] == ["GCONTRIB_A", "GCONTRIB_B"]
    assert checks["project_total_crosscheck"]["passed"] is True

    drift_checks = build_data_quality_checks(
        rows_by_project={42: {"total_contributed": 100}},
        raw_totals={42: 175},
    )

    assert drift_checks["project_total_crosscheck"]["passed"] is False
    assert drift_checks["project_total_crosscheck"]["details"]["raw_total"] == {42: 175}
    assert drift_checks["project_total_crosscheck"]["details"]["materialized_total"] == {42: 100}
