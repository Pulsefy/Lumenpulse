"""Tests for the code-validated operational dataset registry."""

from __future__ import annotations

import copy
from dataclasses import replace

from scripts.validate_lineage import load_manifest
from src.lineage.dataset_registry import validate_dataset_registry
from src.pipeline_topology import PIPELINE_STAGES


def test_committed_dataset_registry_is_valid():
    assert validate_dataset_registry(load_manifest()) == []


def test_pipeline_reference_to_unregistered_dataset_fails():
    stages = [
        replace(
            stage,
            consumes_datasets=stage.consumes_datasets + ("removed_dataset",),
        )
        if stage.id == "market_analyzer_hourly"
        else stage
        for stage in PIPELINE_STAGES
    ]

    errors = validate_dataset_registry(load_manifest(), stages=stages)

    assert any(
        "Pipeline stage 'market_analyzer_hourly' references unregistered dataset "
        "'removed_dataset'" in error
        for error in errors
    )


def test_ingestion_sla_dataset_must_be_registered():
    manifest = copy.deepcopy(load_manifest())
    manifest["datasets"] = [
        dataset
        for dataset in manifest["datasets"]
        if dataset["id"] != "analytics_records"
    ]

    errors = validate_dataset_registry(manifest)

    assert any(
        "Ingestion SLA target references unregistered dataset 'analytics_records'"
        in error
        for error in errors
    )


def test_lineage_entries_must_have_registry_records():
    manifest = copy.deepcopy(load_manifest())
    manifest["datasets"] = [
        dataset
        for dataset in manifest["datasets"]
        if dataset["id"] != "market_health_score"
    ]

    errors = validate_dataset_registry(manifest)

    assert any(
        "Lineage entry 'market_health_score' has no dataset registry record"
        in error
        for error in errors
    )


def test_unknown_pipeline_consumer_in_manifest_fails():
    manifest = copy.deepcopy(load_manifest())
    manifest["datasets"][0]["pipeline_stages"].append("removed_pipeline_stage")

    errors = validate_dataset_registry(manifest)

    assert any(
        "unknown pipeline stage 'removed_pipeline_stage'" in error
        for error in errors
    )
    assert any("does not match code-declared consumers" in error for error in errors)


def test_missing_operational_metadata_fails():
    manifest = copy.deepcopy(load_manifest())
    del manifest["datasets"][0]["retention"]

    errors = validate_dataset_registry(manifest)

    assert any("Missing required field: 'retention'" in error for error in errors)


def test_unknown_model_consumer_fails():
    manifest = copy.deepcopy(load_manifest())
    manifest["datasets"][0]["model_consumers"] = ["unknown_model"]

    errors = validate_dataset_registry(manifest)

    assert any("References unknown model 'unknown_model'" in error for error in errors)


def test_malformed_consumer_lists_return_validation_errors():
    manifest = copy.deepcopy(load_manifest())
    manifest["datasets"][0]["model_consumers"] = [{"not": "a model id"}]
    manifest["datasets"][0]["pipeline_stages"] = [{"not": "a stage id"}]

    errors = validate_dataset_registry(manifest)

    assert any(
        "'model_consumers' must be a list of strings" in error for error in errors
    )
    assert any(
        "'pipeline_stages' must be a list of strings" in error for error in errors
    )
