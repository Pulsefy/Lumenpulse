import os
import sys
import json
import pytest
from pathlib import Path
from sqlalchemy import inspect

# Add root directory to path to allow importing src and scripts
ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from src.db.models import AnalyticsRecord, ContractEvent
from scripts.generate_synthetic_data import (
    build_projects,
    build_project_contributors,
    build_analytics_records,
    build_contract_events,
)

FIXTURES_DIR = ROOT_DIR / "tests" / "fixtures" / "contracts"


def get_db_model_schema(model_cls):
    """Inspects an SQLAlchemy model class and returns its schema representation."""
    mapper = inspect(model_cls)
    schema = {
        "tablename": model_cls.__tablename__,
        "columns": {}
    }
    for column_prop in mapper.attrs:
        # A property might map to multiple columns, but typically one for simple models
        if not hasattr(column_prop, "columns"):
            continue
        col_obj = column_prop.columns[0]
        schema["columns"][column_prop.key] = {
            "type": str(col_obj.type),
            "nullable": col_obj.nullable,
            "primary_key": col_obj.primary_key
        }
    return schema


def validate_record_types(record, expected_schema):
    """
    Validates that a record's keys and types match the expected schema.
    Supports basic type validation and nullable fields.
    """
    for key, expected_type in expected_schema.items():
        assert key in record, f"Missing expected key: {key}"
        val = record[key]
        if val is None:
            # Check if type allows None (either explicit NoneType or nullable type)
            continue
        
        actual_type = type(val).__name__
        
        # Handle cases where multiple types are acceptable (e.g. float and int)
        if expected_type == "float" and actual_type in ("float", "int"):
            continue
        if expected_type == "int" and actual_type == "int":
            continue
        if expected_type == "str" and actual_type == "str":
            continue
        if expected_type == "dict" and actual_type == "dict":
            continue
        if expected_type == "list" and actual_type == "list":
            continue
            
        assert actual_type == expected_type, (
            f"Type mismatch for key '{key}': expected {expected_type}, got {actual_type}"
        )


class TestDatasetContracts:
    """Contract tests for derived datasets consumed by backend services."""

    def test_db_schema_contracts(self, update_contracts):
        """
        Validate that the database model schemas match the contract.
        Renaming, deleting, or modifying columns/types will fail this test.
        """
        FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
        
        models_to_test = {
            "analytics_records_db": AnalyticsRecord,
            "contract_events_db": ContractEvent,
        }
        
        for name, model_cls in models_to_test.items():
            fixture_path = FIXTURES_DIR / f"{name}_contract.json"
            current_schema = get_db_model_schema(model_cls)
            
            if update_contracts:
                # Write current schema to JSON
                with open(fixture_path, "w", encoding="utf-8") as f:
                    json.dump(current_schema, f, indent=2)
                print(f"\nUpdated DB contract fixture: {fixture_path.name}")
            else:
                # Compare current schema against JSON
                assert fixture_path.exists(), (
                    f"Contract fixture {fixture_path.name} not found. "
                    "Run with --update-contracts to create it."
                )
                with open(fixture_path, "r", encoding="utf-8") as f:
                    expected_schema = json.load(f)
                
                # Check tablename
                assert current_schema["tablename"] == expected_schema["tablename"], (
                    f"Tablename mismatch for {name}: "
                    f"expected {expected_schema['tablename']}, got {current_schema['tablename']}"
                )
                
                # Check columns
                current_cols = current_schema["columns"]
                expected_cols = expected_schema["columns"]
                
                # Check for missing columns
                missing_cols = set(expected_cols.keys()) - set(current_cols.keys())
                assert not missing_cols, f"Columns deleted or missing in model for {name}: {missing_cols}"
                
                # Check for added columns
                new_cols = set(current_cols.keys()) - set(expected_cols.keys())
                assert not new_cols, f"New columns added to model for {name}: {new_cols}. Run with --update-contracts to accept."
                
                # Check type and nullability for remaining columns
                for col_name in expected_cols:
                    curr_col = current_cols[col_name]
                    exp_col = expected_cols[col_name]
                    assert curr_col["type"] == exp_col["type"], (
                        f"Column '{col_name}' type mismatch in {name}: "
                        f"expected {exp_col['type']}, got {curr_col['type']}"
                    )
                    assert curr_col["nullable"] == exp_col["nullable"], (
                        f"Column '{col_name}' nullability mismatch in {name}: "
                        f"expected {exp_col['nullable']}, got {curr_col['nullable']}"
                    )
                    assert curr_col["primary_key"] == exp_col["primary_key"], (
                        f"Column '{col_name}' primary key mismatch in {name}: "
                        f"expected {exp_col['primary_key']}, got {curr_col['primary_key']}"
                    )

    def test_data_shape_and_semantic_contracts(self, update_contracts):
        """
        Validate that generated pipeline outputs have a stable JSON shape and valid semantics.
        """
        FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
        
        # Generate sample pipeline outputs (using synthetic data generator functions)
        projects = build_projects(2)
        contributors = build_project_contributors(projects, 2)
        
        generated_analytics = build_analytics_records(projects, 5)
        generated_events = build_contract_events(projects, contributors, 5)
        
        assert len(generated_analytics) > 0
        assert len(generated_events) > 0
        
        # We check shape against a reference schema definition
        analytics_expected = {
            "record_type": "str",
            "asset": "str",
            "metric_name": "str",
            "window": "str",
            "value": "float",
            "previous_value": "float",
            "change_percentage": "float",
            "trend_direction": "str",
            "extra_data": "dict",
            "timestamp": "str"
        }
        
        events_expected = {
            "contract_id": "str",
            "event_id": "str",
            "ledger": "int",
            "event_type": "str",
            "project_id": "int",
            "contributor": "str",
            "amount": "float",
            "milestone_id": "int",
            "status": "str",
            "topics": "list",
            "raw_data": "dict",
            "timestamp": "str"
        }
        
        data_contracts = {
            "analytics_records_data": (generated_analytics, analytics_expected),
            "contract_events_data": (generated_events, events_expected),
        }
        
        for name, (records, expected_types) in data_contracts.items():
            fixture_path = FIXTURES_DIR / f"{name}_contract.json"
            
            if update_contracts:
                # Write expected types to JSON
                with open(fixture_path, "w", encoding="utf-8") as f:
                    json.dump(expected_types, f, indent=2)
                print(f"\nUpdated Data contract fixture: {fixture_path.name}")
            else:
                assert fixture_path.exists(), (
                    f"Contract fixture {fixture_path.name} not found. "
                    "Run with --update-contracts to create it."
                )
                with open(fixture_path, "r", encoding="utf-8") as f:
                    loaded_expected = json.load(f)
                
                # Check for key/type stability across all records
                for idx, record in enumerate(records):
                    try:
                        validate_record_types(record, loaded_expected)
                    except AssertionError as err:
                        raise AssertionError(f"Record #{idx} in {name} failed contract validation: {err}")

        # Semantic validations (testing meaning stability across calculations)
        for record in generated_analytics:
            val = record.get("value")
            prev_val = record.get("previous_value")
            pct = record.get("change_percentage")
            trend = record.get("trend_direction")
            
            # Check value semantics
            assert val is not None
            assert isinstance(val, (int, float))
            
            # Check change calculation consistency
            if pct is not None and prev_val is not None and prev_val != 0:
                expected_pct = round(((val - prev_val) / prev_val) * 100, 2)
                # Allow a small floating point tolerance
                assert abs(pct - expected_pct) < 1.0, (
                    f"Semantic inconsistency: change_percentage={pct} does not match "
                    f"calculated={expected_pct} from value={val}, previous_value={prev_val}"
                )
                
                # Check trend consistency
                if pct > 2:
                    assert trend == "up", f"Semantic mismatch: percentage={pct} but trend={trend}"
                elif pct < -2:
                    assert trend == "down", f"Semantic mismatch: percentage={pct} but trend={trend}"
                else:
                    assert trend == "stable", f"Semantic mismatch: percentage={pct} but trend={trend}"
            
        for event in generated_events:
            event_type = event.get("event_type")
            ledger = event.get("ledger")
            amount = event.get("amount")
            topics = event.get("topics")
            status = event.get("status")
            
            # Check positive ledger semantics
            assert isinstance(ledger, int) and ledger > 0, f"Semantic mismatch: ledger={ledger} must be positive int"
            
            # Check event_type correctness
            assert event_type in ["contribution", "reward_granted", "milestone_approved", "submission_minted"], (
                f"Semantic mismatch: unknown event_type={event_type}"
            )
            
            # Check status correctness
            assert status in ["completed", "approved", "pending"], f"Semantic mismatch: unknown status={status}"
            
            # Check contribution-specific semantics
            if event_type == "contribution":
                assert amount is not None and amount > 0, (
                    f"Semantic mismatch: contribution event must have positive amount, got {amount}"
                )
                assert isinstance(topics, list) and len(topics) >= 2, (
                    f"Semantic mismatch: contribution topics must contain asset and event type, got {topics}"
                )
