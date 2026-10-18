"""Load and validate the operational dataset registry."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, Optional

from src.ingestion.dataset_sla import DATASET_SLA_TARGETS
from src.pipeline_topology import PIPELINE_STAGES, StageSpec

from .manifest import load_manifest

_REQUIRED_FIELDS = {
    "id",
    "display_name",
    "description",
    "owner",
    "schema",
    "update_cadence",
    "retention",
    "model_consumers",
    "pipeline_stages",
}


def validate_dataset_registry(
    manifest: dict[str, Any],
    stages: Optional[Sequence[StageSpec]] = None,
) -> list[str]:
    """Return registry contract errors, including pipeline-to-dataset drift."""
    errors: list[str] = []
    datasets = manifest.get("datasets")
    if not isinstance(datasets, list) or not datasets:
        return ["'datasets' is empty or missing — at least one dataset is required."]

    entries: dict[str, dict[str, Any]] = {}
    for index, entry in enumerate(datasets):
        if not isinstance(entry, dict):
            errors.append(f"[datasets/{index}] Entry must be a mapping.")
            continue
        dataset_id = entry.get("id")
        label = str(dataset_id or index)
        for field in _REQUIRED_FIELDS:
            value = entry.get(field)
            missing = field not in entry or value is None or value == ""
            if field not in {"model_consumers", "pipeline_stages"}:
                missing = missing or value == [] or value == {}
            if missing:
                errors.append(f"[datasets/{label}] Missing required field: '{field}'.")
        if not isinstance(dataset_id, str) or not dataset_id:
            continue
        for field in (
            "display_name",
            "description",
            "owner",
            "update_cadence",
            "retention",
        ):
            if not isinstance(entry.get(field), str) or not entry[field].strip():
                errors.append(
                    f"[datasets/{dataset_id}] '{field}' must be a non-empty string."
                )
        if dataset_id in entries:
            errors.append(f"Duplicate dataset id: '{dataset_id}'.")
        entries[dataset_id] = entry
        schema = entry.get("schema")
        if not isinstance(schema, dict) or not schema or not all(
            isinstance(name, str) and isinstance(value, str) and value
            for name, value in schema.items()
        ):
            errors.append(
                f"[datasets/{dataset_id}] 'schema' must map field names "
                "to type strings."
            )
        for field in ("model_consumers", "pipeline_stages"):
            values = entry.get(field)
            if not isinstance(values, list) or not all(
                isinstance(value, str) for value in values
            ):
                errors.append(
                    f"[datasets/{dataset_id}] '{field}' must be a list of strings."
                )

    feature_sets = manifest.get("ml_feature_sets") or []
    model_ids = {
        entry.get("registry_key")
        for entry in feature_sets
        if isinstance(entry, dict) and isinstance(entry.get("registry_key"), str)
    }
    declared_stage_consumers: dict[str, set[str]] = {
        dataset_id: set() for dataset_id in entries
    }
    known_stages = list(stages if stages is not None else PIPELINE_STAGES)
    for stage in known_stages:
        for dataset_id in stage.consumes_datasets:
            if dataset_id not in entries:
                errors.append(
                    f"Pipeline stage '{stage.id}' references unregistered dataset "
                    f"'{dataset_id}'."
                )
            else:
                declared_stage_consumers[dataset_id].add(stage.id)

    for target in DATASET_SLA_TARGETS:
        if target.dataset not in entries:
            errors.append(
                f"Ingestion SLA target references unregistered dataset "
                f"'{target.dataset}'."
            )

    lineage_ids = {
        entry.get("id")
        for section in ("ml_feature_sets", "kpi_datasets")
        for entry in (manifest.get(section) or [])
        if isinstance(entry, dict) and isinstance(entry.get("id"), str)
    }
    for dataset_id in sorted(lineage_ids - entries.keys()):
        errors.append(
            f"Lineage entry '{dataset_id}' has no dataset registry record."
        )

    for dataset_id, entry in entries.items():
        model_consumers = entry.get("model_consumers")
        if isinstance(model_consumers, list) and all(
            isinstance(model_id, str) for model_id in model_consumers
        ):
            for model_id in model_consumers:
                if model_id not in model_ids:
                    errors.append(
                        f"[datasets/{dataset_id}] References unknown model "
                        f"'{model_id}'."
                    )
        pipeline_stages = entry.get("pipeline_stages")
        if isinstance(pipeline_stages, list) and all(
            isinstance(stage_id, str) for stage_id in pipeline_stages
        ):
            unknown = set(pipeline_stages) - {stage.id for stage in known_stages}
            for stage_id in sorted(unknown):
                errors.append(
                    f"[datasets/{dataset_id}] References unknown pipeline stage "
                    f"'{stage_id}'."
                )
            expected = declared_stage_consumers[dataset_id]
            actual = set(pipeline_stages)
            if actual != expected:
                errors.append(
                    f"[datasets/{dataset_id}] 'pipeline_stages' does not match "
                    f"code-declared consumers (expected {sorted(expected)}, "
                    f"got {sorted(actual)})."
                )

    return errors


def get_registered_datasets() -> list[dict[str, Any]]:
    """Return validated dataset metadata from the canonical lineage manifest."""
    manifest = load_manifest()
    errors = validate_dataset_registry(manifest)
    if errors:
        raise ValueError("Invalid dataset registry: " + "; ".join(errors))
    return manifest["datasets"]
