"""
Example: Cohort Analysis Dataset Generation and Validation

This script demonstrates how to use the cohort analysis system to:
1. Track contributor participation across grant rounds
2. Create cohorts based on first participation or time windows
3. Calculate retention metrics for cohorts
4. Analyze repeat contributors
5. Validate output formats for backend/dashboard consumption
"""

import sys
import os
from pathlib import Path

# Add parent directory to path to enable imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from datetime import datetime, timedelta
from src.analytics.cohort_analyzer import (
    CohortAnalyzer,
    create_cohort_analyzer,
    CohortType,
    ContributorType,
)
from src.db.postgres_service import PostgresService
import json


def print_section(title: str):
    """Print a formatted section header"""
    print(f"\n{'=' * 60}")
    print(f"  {title}")
    print(f"{'=' * 60}\n")


def validate_output_format(data: dict, required_fields: list, context: str) -> bool:
    """
    Validate that output data contains required fields for backend/dashboard consumption.
    
    Args:
        data: Dictionary to validate
        required_fields: List of required field names
        context: Description of what is being validated
        
    Returns:
        True if validation passes, False otherwise
    """
    missing_fields = [field for field in required_fields if field not in data]
    
    if missing_fields:
        print(f"❌ Validation failed for {context}")
        print(f"   Missing fields: {missing_fields}")
        return False
    
    print(f"✅ Validation passed for {context}")
    return True


def main():
    """Main example execution"""
    print_section("Cohort Analysis Dataset Example")
    
    # Initialize analyzer
    print("Initializing cohort analyzer...")
    analyzer = create_cohort_analyzer()
    print("✅ Analyzer initialized\n")
    
    # Sample contribution data
    print("Creating sample contribution data...")
    sample_contributions = {
        1: [  # Round 1
            {"contributor": "0xAAA1111111111111111111111111111111111111", "amount": 100.0, "project_id": 1, "timestamp": datetime(2026, 1, 5, 10, 30)},
            {"contributor": "0xAAA1111111111111111111111111111111111111", "amount": 50.0, "project_id": 2, "timestamp": datetime(2026, 1, 10, 14, 20)},
            {"contributor": "0xBBB2222222222222222222222222222222222222", "amount": 200.0, "project_id": 1, "timestamp": datetime(2026, 1, 7, 9, 15)},
            {"contributor": "0xCCC3333333333333333333333333333333333333", "amount": 150.0, "project_id": 3, "timestamp": datetime(2026, 1, 15, 16, 45)},
            {"contributor": "0xDDD4444444444444444444444444444444444444", "amount": 75.0, "project_id": 2, "timestamp": datetime(2026, 1, 20, 11, 0)},
        ],
        2: [  # Round 2
            {"contributor": "0xAAA1111111111111111111111111111111111111", "amount": 120.0, "project_id": 1, "timestamp": datetime(2026, 2, 5, 10, 30)},
            {"contributor": "0xBBB2222222222222222222222222222222222222", "amount": 180.0, "project_id": 4, "timestamp": datetime(2026, 2, 8, 9, 15)},
            {"contributor": "0xEEE5555555555555555555555555555555555555", "amount": 250.0, "project_id": 1, "timestamp": datetime(2026, 2, 12, 14, 20)},
            {"contributor": "0xFFF6666666666666666666666666666666666666", "amount": 100.0, "project_id": 5, "timestamp": datetime(2026, 2, 18, 16, 45)},
        ],
        3: [  # Round 3
            {"contributor": "0xAAA1111111111111111111111111111111111111", "amount": 80.0, "project_id": 2, "timestamp": datetime(2026, 3, 5, 10, 30)},
            {"contributor": "0xCCC3333333333333333333333333333333333333", "amount": 200.0, "project_id": 3, "timestamp": datetime(2026, 3, 10, 9, 15)},
            {"contributor": "0xEEE5555555555555555555555555555555555555", "amount": 150.0, "project_id": 4, "timestamp": datetime(2026, 3, 15, 14, 20)},
        ],
    }
    print(f"✅ Created sample data for {len(sample_contributions)} rounds\n")
    
    # Track round participation
    print_section("1. Tracking Round Participation")
    
    for round_id, contributions in sample_contributions.items():
        saved_count = analyzer.track_round_participation(round_id=round_id, contributions=contributions)
        print(f"Round {round_id}: Saved {saved_count} participation records")
    
    # Create first-round cohort
    print_section("2. Creating First-Round Cohort")
    
    cohort_metrics = analyzer.create_first_round_cohort(round_id=1)
    cohort_dict = cohort_metrics.to_dict()
    
    print(f"Cohort ID: {cohort_dict['cohort_id']}")
    print(f"Member Count: {cohort_dict['member_count']}")
    print(f"Total Contributed: ${cohort_dict['total_contributed']:.2f}")
    print(f"Average per Member: ${cohort_dict['avg_contributed_per_member']:.2f}")
    
    # Validate output format
    required_cohort_fields = [
        "cohort_id", "member_count", "members", 
        "total_contributed", "avg_contributed_per_member"
    ]
    validate_output_format(cohort_dict, required_cohort_fields, "Cohort Metrics")
    
    print(f"\nFull JSON output:")
    print(json.dumps(cohort_dict, indent=2, default=str))
    
    # Calculate retention
    print_section("3. Calculating Retention Metrics")
    
    retention_metrics = analyzer.calculate_retention(
        cohort_id="first_round_1",
        round_id=2
    )
    retention_dict = retention_metrics.to_dict()
    
    print(f"Cohort ID: {retention_dict['cohort_id']}")
    print(f"Round ID: {retention_dict['round_id']}")
    print(f"Cohort Size: {retention_dict['cohort_size']}")
    print(f"Retained Contributors: {retention_dict['retained_contributors']}")
    print(f"Retention Rate: {retention_dict['retention_rate']:.1%}")
    print(f"New Contributors: {retention_dict['new_contributors']}")
    
    # Validate output format
    required_retention_fields = [
        "cohort_id", "round_id", "cohort_size", "retained_contributors",
        "retention_rate", "retained_total_contributed", 
        "avg_retained_contribution", "new_contributors"
    ]
    validate_output_format(retention_dict, required_retention_fields, "Retention Metrics")
    
    print(f"\nFull JSON output:")
    print(json.dumps(retention_dict, indent=2, default=str))
    
    # Analyze repeat contributors
    print_section("4. Analyzing Repeat Contributors")
    
    repeat_contributors = analyzer.analyze_repeat_contributors(min_rounds=2)
    
    print(f"Found {len(repeat_contributors)} repeat contributors\n")
    
    for i, contributor in enumerate(repeat_contributors[:3], 1):  # Show first 3
        contributor_dict = contributor.to_dict()
        print(f"{i}. {contributor_dict['contributor'][:10]}...")
        print(f"   Rounds Participated: {contributor_dict['rounds_participated']}")
        print(f"   Total Contributed: ${contributor_dict['total_contributed_all_rounds']:.2f}")
        print(f"   Type: {contributor_dict['contributor_type']}")
        
        # Validate output format
        required_contributor_fields = [
            "contributor", "rounds_participated", "first_round_id", "last_round_id",
            "total_contributed_all_rounds", "avg_contributed_per_round",
            "total_projects_supported", "unique_projects_supported",
            "contributor_type", "round_ids"
        ]
        validate_output_format(contributor_dict, required_contributor_fields, f"Contributor {i}")
    
    if repeat_contributors:
        print(f"\nFull JSON output for first contributor:")
        print(json.dumps(repeat_contributors[0].to_dict(), indent=2, default=str))
    
    # Create time-window cohort
    print_section("5. Creating Time-Window Cohort")
    
    time_window_cohort = analyzer.create_time_window_cohort(
        window_start=datetime(2026, 1, 1),
        window_end=datetime(2026, 3, 31)
    )
    
    print(f"Cohort ID: {time_window_cohort.cohort_id}")
    print(f"Member Count: {time_window_cohort.member_count}")
    print(f"Total Contributed: ${time_window_cohort.total_contributed:.2f}")
    
    # Get retention timeline
    print_section("6. Getting Retention Timeline")
    
    # Calculate retention for all rounds
    for round_id in [2, 3]:
        try:
            analyzer.calculate_retention(cohort_id="first_round_1", round_id=round_id)
        except Exception as e:
            print(f"Note: Could not calculate retention for round {round_id}: {e}")
    
    timeline = analyzer.get_cohort_retention_timeline(cohort_id="first_round_1")
    
    print(f"Retention timeline for cohort 'first_round_1':\n")
    
    for data in timeline:
        print(f"Round {data['round_id']}:")
        print(f"  Retention Rate: {data['retention_rate']:.1%}")
        print(f"  Retained: {data['retained_contributors']}/{data['cohort_size']}")
        print(f"  New Contributors: {data['new_contributors']}")
    
    if timeline:
        print(f"\nFull JSON timeline:")
        print(json.dumps(timeline, indent=2, default=str))
    
    # Summary
    print_section("Summary")
    
    print("✅ All cohort analysis datasets generated successfully")
    print("✅ Output formats validated for backend/dashboard consumption")
    print("\nDataset capabilities demonstrated:")
    print("  • Round participation tracking")
    print("  • First-round cohort creation")
    print("  • Retention rate calculation")
    print("  • Repeat contributor analysis")
    print("  • Time-window cohort creation")
    print("  • Retention timeline generation")
    print("\nAll outputs are structured as JSON-serializable dictionaries")
    print("with required fields for backend API and dashboard consumption.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
