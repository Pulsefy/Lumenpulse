#!/usr/bin/env python3
"""
Metadata Drift Detector — manual execution entrypoint (#882)

Compares backend ProjectView/ProjectMilestone records against state
recomputed from the raw ContractEvent log and reports any drift.
Read-only: never mutates ProjectView/ProjectMilestone.

Usage:
    python scripts/detect_metadata_drift.py
    python scripts/detect_metadata_drift.py --project-id 101
    python scripts/detect_metadata_drift.py --limit 1000 --no-persist
"""

import sys
import os
import json
import argparse
import logging

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.metadata_drift_detector import MetadataDriftDetector

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Detect drift between backend records and on-chain-derived state."
    )
    parser.add_argument(
        "--project-id",
        type=int,
        default=None,
        help="Check a single project instead of all known projects.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=500,
        help="Max number of projects to check when --project-id is not given.",
    )
    parser.add_argument(
        "--no-persist",
        action="store_true",
        help="Print findings without writing them to metadata_drift_findings.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print the report as JSON instead of a human-readable summary.",
    )
    args = parser.parse_args()

    detector = MetadataDriftDetector()

    if args.no_persist:
        report = (
            detector.run_for_project(args.project_id)
            if args.project_id is not None
            else detector.run_all(limit=args.limit)
        )
    else:
        report = detector.run_and_persist(project_id=args.project_id, limit=args.limit)

    if args.json:
        print(json.dumps(report.to_dict(), indent=2))
    else:
        logger.info("=" * 60)
        logger.info("Metadata Drift Detection Report")
        logger.info("=" * 60)
        logger.info(f"Run ID:             {report.run_id}")
        logger.info(f"Projects checked:   {report.projects_checked}")
        logger.info(f"Projects with drift: {report.projects_with_drift}")
        logger.info(f"Total findings:     {len(report.findings)}")
        for finding in report.findings:
            logger.info(
                "  [%s] project=%s %s%s: backend=%r chain_derived=%r",
                finding.severity.upper(),
                finding.project_id,
                finding.scope,
                f" milestone={finding.milestone_id}" if finding.milestone_id is not None else "",
                finding.backend_value,
                finding.chain_derived_value,
            )

    return 1 if report.drift_detected else 0


if __name__ == "__main__":
    sys.exit(main())
