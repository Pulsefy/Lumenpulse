"""Resumable historical materialization for registered feature-store features."""

from __future__ import annotations

import hashlib
import json
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from src.ml.feature_schema import current_feature_schema
from src.ml.feature_store import FeatureStore
from src.pipeline_run_registry import (
    OUTCOME_FAILED,
    OUTCOME_SUCCESS,
    PipelineRunRegistry,
    get_default_registry,
)

_SOURCE_VIEWS = (
    "asset_sentiment_view",
    "asset_volume_view",
    "asset_volatility_view",
)
_BYTES_PER_SOURCE_ROW_ESTIMATE = 512


def _validate_range(start_time: datetime, end_time: datetime) -> None:
    if start_time.tzinfo is None or start_time.utcoffset() is None:
        raise ValueError("start_time must include a timezone")
    if end_time.tzinfo is None or end_time.utcoffset() is None:
        raise ValueError("end_time must include a timezone")
    if start_time >= end_time:
        raise ValueError("start_time must be earlier than end_time")


def estimate_feature_backfill(
    db_session: Session,
    asset: str,
    start_time: datetime,
    end_time: datetime,
) -> Dict[str, int]:
    """Count source rows and report a conservative output-size/memory estimate."""
    _validate_range(start_time, end_time)
    counts: Dict[str, int] = {}
    for view_name in _SOURCE_VIEWS:
        result = db_session.execute(
            text(
                f"SELECT COUNT(*) FROM {view_name} "
                "WHERE asset = :asset AND timestamp >= :start_time "
                "AND timestamp <= :end_time"
            ),
            {
                "asset": asset,
                "start_time": start_time,
                "end_time": end_time,
            },
        )
        counts[view_name] = int(result.scalar_one())
    source_rows = sum(counts.values())
    return {
        "source_rows": source_rows,
        "output_rows_upper_bound": source_rows,
        "estimated_peak_memory_bytes": (
            source_rows * _BYTES_PER_SOURCE_ROW_ESTIMATE
        ),
    }


def _backfill_id(
    asset: str,
    feature: str,
    start_time: datetime,
    end_time: datetime,
    schema_version: str,
    fingerprint: str,
) -> str:
    identity = {
        "asset": asset,
        "feature": feature,
        "start_time": start_time.isoformat(),
        "end_time": end_time.isoformat(),
        "schema_version": schema_version,
        "schema_fingerprint": fingerprint,
    }
    payload = json.dumps(identity, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _load_or_create_checkpoint(
    db_session: Session,
    backfill_id: str,
    asset: str,
    feature: str,
    start_time: datetime,
    end_time: datetime,
    schema_version: str,
    schema_fingerprint: str,
) -> tuple[datetime, int]:
    db_session.execute(
        text(
            """
            INSERT INTO feature_backfill_checkpoints (
                backfill_id, asset, feature_name, start_time, end_time,
                next_start_time, rows_processed, schema_version,
                schema_fingerprint, updated_at
            ) VALUES (
                :backfill_id, :asset, :feature_name, :start_time, :end_time,
                :start_time, 0, :schema_version, :schema_fingerprint, :updated_at
            )
            ON CONFLICT (backfill_id) DO NOTHING
            """
        ),
        {
            "backfill_id": backfill_id,
            "asset": asset,
            "feature_name": feature,
            "start_time": start_time,
            "end_time": end_time,
            "schema_version": schema_version,
            "schema_fingerprint": schema_fingerprint,
            "updated_at": datetime.now(timezone.utc),
        },
    )
    db_session.commit()
    row = db_session.execute(
        text(
            "SELECT next_start_time, rows_processed "
            "FROM feature_backfill_checkpoints WHERE backfill_id = :backfill_id"
        ),
        {"backfill_id": backfill_id},
    ).one()
    return row.next_start_time, int(row.rows_processed)


def run_feature_backfill(
    db_session: Session,
    asset: str,
    feature: str,
    start_time: datetime,
    end_time: datetime,
    chunk_days: int = 7,
    dry_run: bool = False,
    registry: Optional[PipelineRunRegistry] = None,
) -> Dict[str, Any]:
    """Backfill one registered feature in atomic, resumable time chunks."""
    if not asset.strip():
        raise ValueError("asset must not be empty")
    _validate_range(start_time, end_time)
    if chunk_days <= 0:
        raise ValueError("chunk_days must be greater than zero")

    schema = current_feature_schema()
    if feature not in schema.feature_names:
        raise ValueError(
            f"Unknown feature {feature!r}; expected one of {schema.feature_names}"
        )
    backfill_id = _backfill_id(
        asset,
        feature,
        start_time,
        end_time,
        schema.version,
        schema.fingerprint,
    )
    stage_id = f"feature_backfill:{backfill_id}"
    reg = registry or get_default_registry()
    store = FeatureStore(db_session)

    if dry_run:
        estimate = estimate_feature_backfill(db_session, asset, start_time, end_time)
        return {
            "backfill_id": backfill_id,
            "asset": asset,
            "feature": feature,
            "dry_run": True,
            **estimate,
        }

    started = time.monotonic()
    rows_this_run = 0
    reg.record_start(stage_id)
    try:
        cursor, rows_processed = _load_or_create_checkpoint(
            db_session,
            backfill_id,
            asset,
            feature,
            start_time,
            end_time,
            schema.version,
            schema.fingerprint,
        )
        reg.record_progress(
            stage_id,
            {
                "backfill_id": backfill_id,
                "asset": asset,
                "feature": feature,
                "start_time": start_time.isoformat(),
                "end_time": end_time.isoformat(),
                "rows_processed": rows_processed,
                "next_start_time": cursor.isoformat(),
            },
        )
        chunk_delta = timedelta(days=chunk_days)
        while cursor <= end_time:
            chunk_end = min(cursor + chunk_delta, end_time)
            frame = store.get_features_for_asset(
                asset,
                start_time=cursor,
                end_time=chunk_end,
                context_start_time=start_time,
                raise_on_error=True,
            )
            if feature not in frame.columns:
                raise RuntimeError(
                    f"Live feature computation did not return {feature!r}"
                )

            values = frame[["timestamp", feature]].dropna(subset=["timestamp"])
            chunk_rows = [
                {
                    "backfill_id": backfill_id,
                    "asset": asset,
                    "feature_name": feature,
                    "timestamp": row.timestamp.to_pydatetime()
                    if hasattr(row.timestamp, "to_pydatetime")
                    else row.timestamp,
                    "value": float(getattr(row, feature)),
                    "schema_version": schema.version,
                    "schema_fingerprint": schema.fingerprint,
                }
                for row in values.itertuples(index=False)
            ]
            next_cursor = (
                chunk_end + timedelta(microseconds=1)
                if chunk_end < end_time
                else end_time + timedelta(microseconds=1)
            )

            if chunk_rows:
                db_session.execute(
                    text(
                        """
                        INSERT INTO feature_backfill_values (
                            backfill_id, asset, feature_name, timestamp, value,
                            schema_version, schema_fingerprint
                        ) VALUES (
                            :backfill_id, :asset, :feature_name, :timestamp, :value,
                            :schema_version, :schema_fingerprint
                        )
                        ON CONFLICT (backfill_id, timestamp) DO UPDATE SET
                            value = EXCLUDED.value,
                            schema_version = EXCLUDED.schema_version,
                            schema_fingerprint = EXCLUDED.schema_fingerprint
                        """
                    ),
                    chunk_rows,
                )
            rows_processed += len(chunk_rows)
            rows_this_run += len(chunk_rows)
            elapsed = time.monotonic() - started
            db_session.execute(
                text(
                    """
                    UPDATE feature_backfill_checkpoints
                    SET next_start_time = :next_start_time,
                        rows_processed = :rows_processed,
                        updated_at = :updated_at
                    WHERE backfill_id = :backfill_id
                    """
                ),
                {
                    "next_start_time": next_cursor,
                    "rows_processed": rows_processed,
                    "updated_at": datetime.now(timezone.utc),
                    "backfill_id": backfill_id,
                },
            )
            db_session.commit()
            cursor = next_cursor
            reg.record_progress(
                stage_id,
                {
                    "backfill_id": backfill_id,
                    "asset": asset,
                    "feature": feature,
                    "rows_processed": rows_processed,
                    "next_start_time": cursor.isoformat(),
                    "elapsed_seconds": round(elapsed, 3),
                    "rows_this_run": rows_this_run,
                    "rows_per_second": round(rows_this_run / elapsed, 3)
                    if elapsed > 0
                    else None,
                },
            )
    except Exception as exc:
        db_session.rollback()
        reg.record_finish(stage_id, OUTCOME_FAILED, error=str(exc))
        raise

    elapsed = time.monotonic() - started
    result = {
        "backfill_id": backfill_id,
        "asset": asset,
        "feature": feature,
        "rows_processed": rows_processed,
        "rows_this_run": rows_this_run,
        "elapsed_seconds": round(elapsed, 3),
        "rows_per_second": round(rows_this_run / elapsed, 3)
        if elapsed > 0
        else None,
    }
    reg.record_progress(stage_id, result)
    reg.record_finish(stage_id, OUTCOME_SUCCESS)
    return result
