#!/usr/bin/env python3
"""Build project contribution materialized views from backfilled on-chain events."""

import argparse
import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from dotenv import load_dotenv

from src.db import PostgresService
from src.ingestion.project_materialized_views import refresh_project_materialized_views


def load_events(path: Path) -> list:
    with path.open() as handle:
        payload = json.load(handle)

    if isinstance(payload, dict):
        events = payload.get("events")
        if isinstance(events, list):
            return events
        return []
    if isinstance(payload, list):
        return payload
    return []


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh project contribution materialized views")
    parser.add_argument("--input-dir", type=str, required=True, help="Directory containing backfilled event JSON files")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    load_dotenv(PROJECT_ROOT / ".env")

    db_service = PostgresService()
    input_dir = Path(args.input_dir)

    total_projects = 0
    total_checks = 0

    for file_path in sorted(input_dir.glob("*.json")):
        events = load_events(file_path)
        if not events:
            continue

        existing_rows = {
            row.project_id: {
                "project_id": row.project_id,
                "total_contributed": row.total_contributed,
                "contributor_count": row.contributor_count,
                "milestone_approved": bool(row.milestone_approved),
                "contributors": row.contributors or [],
                "last_processed_ledger": row.last_processed_ledger,
            }
            for row in db_service.get_project_contribution_rollups()
        }

        rows, checks = refresh_project_materialized_views(events, existing_rows=existing_rows)

        for row in rows:
            db_service.upsert_project_contribution_rollup(
                project_id=row["project_id"],
                total_contributed=row["total_contributed"],
                contributor_count=row["contributor_count"],
                milestone_approved=bool(row["milestone_approved"]),
                contributors=row["contributors"],
                last_processed_ledger=row["last_processed_ledger"],
            )
            total_projects += 1

        for check_id, check in checks.items():
            db_service.save_analytics_record(
                record_type="project_materialized_view_quality",
                metric_name=check_id,
                value=float(int(check["passed"])),
                asset="project_totals",
                extra_data=check["details"],
            )
            total_checks += 1

    print({
        "projects_materialized": total_projects,
        "quality_checks_emitted": total_checks,
    })

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
