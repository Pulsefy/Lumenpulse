# -*- coding: utf-8 -*-
"""
Immutable training-data snapshots for reproducible retraining (Issue #1449).

Each training run freezes the exact DataFrame used to fit the model under a
content-addressed snapshot id. Replaying a recorded manifest loads that
snapshot instead of re-querying live tables, so artefacts stay identical even
when the underlying database has moved on.

Retention / cost policy is documented in TRAINING_DATA_SNAPSHOTS.md and
exposed via :func:`get_retention_policy` / :func:`estimate_storage_cost`.
"""

from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Optional, Tuple, Union

import pandas as pd

from src.utils.logger import setup_logger

logger = setup_logger(__name__)

_SNAPSHOT_ROOT = Path(
    os.getenv("TRAINING_SNAPSHOT_PATH", "./data/training_snapshots")
)

# Default retention: keep snapshots for 90 days (override via env).
_RETENTION_DAYS = int(os.getenv("TRAINING_SNAPSHOT_RETENTION_DAYS", "90"))

# Rough cost model for operators (override via env). USD / GB-month.
_COST_USD_PER_GB_MONTH = float(
    os.getenv("TRAINING_SNAPSHOT_COST_USD_PER_GB_MONTH", "0.023")
)

# Canonical CSV float formatting so hashes are stable across platforms.
_FLOAT_FORMAT = "%.10g"


def snapshot_root() -> Path:
    """Return the configured snapshot directory (created on demand)."""
    _SNAPSHOT_ROOT.mkdir(parents=True, exist_ok=True)
    return _SNAPSHOT_ROOT


def get_retention_policy() -> Dict[str, Any]:
    """
    Documented retention policy for training-data snapshots.

    Returns a JSON-serialisable dict suitable for operator runbooks and
    inclusion in model cards / manifests.
    """
    return {
        "retention_days": _RETENTION_DAYS,
        "storage_path": str(snapshot_root()),
        "content_addressed": True,
        "immutable": True,
        "deletion_policy": (
            f"Snapshots older than {_RETENTION_DAYS} days may be deleted by "
            "apply_retention(); models whose snapshot has expired cannot be "
            "bit-for-bit reproduced until the snapshot is restored from backup."
        ),
        "cost_usd_per_gb_month": _COST_USD_PER_GB_MONTH,
        "notes": (
            "Snapshots are content-addressed (sha256 of canonical CSV). "
            "Identical datasets share one object; retention applies to the "
            "manifest mtime of each snapshot id."
        ),
    }


def estimate_storage_cost(
    *,
    bytes_used: int,
    retention_days: Optional[int] = None,
    usd_per_gb_month: Optional[float] = None,
) -> Dict[str, Any]:
    """Estimate monthly storage cost for a given snapshot footprint."""
    days = retention_days if retention_days is not None else _RETENTION_DAYS
    rate = (
        usd_per_gb_month
        if usd_per_gb_month is not None
        else _COST_USD_PER_GB_MONTH
    )
    gb = bytes_used / (1024 ** 3)
    # Prorate monthly rate by retention window (month ≈ 30 days).
    months = max(days, 1) / 30.0
    monthly = gb * rate
    retention_window_cost = monthly * months
    return {
        "bytes_used": bytes_used,
        "gib_used": round(gb, 6),
        "usd_per_gb_month": rate,
        "estimated_usd_per_month": round(monthly, 6),
        "retention_days": days,
        "estimated_usd_over_retention": round(retention_window_cost, 6),
    }


def _canonical_csv_bytes(df: pd.DataFrame) -> bytes:
    """Serialize a DataFrame to a deterministic CSV byte string."""
    ordered = df.copy()
    # Stable column order + row order for hashing.
    ordered = ordered.reindex(sorted(ordered.columns), axis=1)
    ordered = ordered.reset_index(drop=True)
    csv_text = ordered.to_csv(index=False, float_format=_FLOAT_FORMAT, lineterminator="\n")
    return csv_text.encode("utf-8")


def _content_hash(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _snapshot_id(content_hash: str) -> str:
    return f"tds_{content_hash[:16]}"


def _paths_for(snapshot_id: str) -> Tuple[Path, Path]:
    root = snapshot_root()
    return root / f"{snapshot_id}.csv", root / f"{snapshot_id}.manifest.json"


def write_snapshot(
    df: pd.DataFrame,
    *,
    source: str = "unknown",
    query_bounds: Optional[Dict[str, Any]] = None,
    seed: Optional[int] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Persist an immutable training-data snapshot and return its reference.

    The reference is content-addressed: identical frames share the same
    ``snapshot_id``. Existing files are never overwritten with different bytes.
    """
    if df is None or df.empty:
        raise ValueError("Cannot snapshot an empty training DataFrame")

    payload = _canonical_csv_bytes(df)
    digest = _content_hash(payload)
    sid = _snapshot_id(digest)
    csv_path, manifest_path = _paths_for(sid)

    if csv_path.exists():
        existing = csv_path.read_bytes()
        if existing != payload:
            raise RuntimeError(
                f"Snapshot collision for {sid}: content hash conflict"
            )
        logger.info("Reusing existing training snapshot %s (%d bytes)", sid, len(payload))
    else:
        tmp = csv_path.with_suffix(".csv.tmp")
        tmp.write_bytes(payload)
        os.replace(tmp, csv_path)
        logger.info("Wrote training snapshot %s (%d bytes, %d rows)", sid, len(payload), len(df))

    ref: Dict[str, Any] = {
        "snapshot_id": sid,
        "content_hash": digest,
        "uri": f"file://{csv_path.resolve()}",
        "relative_path": str(csv_path),
        "row_count": int(len(df)),
        "column_names": sorted(str(c) for c in df.columns),
        "source": source,
        "seed": seed,
        "data_query_bounds": query_bounds or {},
        "created_at": datetime.now(timezone.utc).isoformat(),
        "retention_days": _RETENTION_DAYS,
        "bytes": len(payload),
        "cost_estimate": estimate_storage_cost(bytes_used=len(payload)),
    }
    if extra:
        ref["extra"] = extra

    # Manifest is rewritten with latest metadata but never changes the CSV.
    manifest_path.write_text(
        json.dumps(ref, indent=2, sort_keys=True, default=str),
        encoding="utf-8",
    )
    return ref


def load_snapshot(
    snapshot_ref: Union[str, Dict[str, Any]],
) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    """
    Load a previously written snapshot by id or reference dict.

    Returns ``(dataframe, manifest)``. Raises ``FileNotFoundError`` when the
    snapshot CSV is missing (e.g. purged by retention).
    """
    if isinstance(snapshot_ref, dict):
        sid = snapshot_ref.get("snapshot_id") or snapshot_ref.get("id")
        if not sid:
            raise ValueError("snapshot_ref dict missing snapshot_id")
    else:
        sid = str(snapshot_ref)

    csv_path, manifest_path = _paths_for(sid)
    if not csv_path.exists():
        raise FileNotFoundError(
            f"Training snapshot '{sid}' not found at {csv_path}. "
            "It may have been purged by retention policy."
        )

    df = pd.read_csv(csv_path)
    manifest: Dict[str, Any] = {}
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    else:
        payload = csv_path.read_bytes()
        manifest = {
            "snapshot_id": sid,
            "content_hash": _content_hash(payload),
            "uri": f"file://{csv_path.resolve()}",
            "row_count": int(len(df)),
            "relative_path": str(csv_path),
        }

    # Integrity check when hash is known.
    expected = manifest.get("content_hash")
    if expected:
        actual = _content_hash(csv_path.read_bytes())
        if actual != expected:
            raise RuntimeError(
                f"Snapshot {sid} failed integrity check "
                f"(expected {expected[:12]}…, got {actual[:12]}…)"
            )

    logger.info("Loaded training snapshot %s (%d rows)", sid, len(df))
    return df, manifest


def apply_retention(
    *,
    retention_days: Optional[int] = None,
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    """
    Delete snapshot files whose manifest ``created_at`` is older than retention.

    Returns a summary of deleted / kept ids. Safe to run from a cron job.
    """
    days = retention_days if retention_days is not None else _RETENTION_DAYS
    cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=days)
    deleted: list[str] = []
    kept: list[str] = []

    root = snapshot_root()
    for manifest_path in root.glob("*.manifest.json"):
        try:
            data = json.loads(manifest_path.read_text(encoding="utf-8"))
            created = datetime.fromisoformat(data["created_at"])
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
        except (KeyError, ValueError, json.JSONDecodeError, OSError):
            # Fall back to file mtime when manifest is incomplete.
            created = datetime.fromtimestamp(
                manifest_path.stat().st_mtime, tz=timezone.utc
            )

        sid = data.get("snapshot_id") if isinstance(data, dict) else None
        sid = sid or manifest_path.stem.replace(".manifest", "")
        csv_path = root / f"{sid}.csv"

        if created < cutoff:
            for path in (csv_path, manifest_path):
                try:
                    path.unlink()
                except FileNotFoundError:
                    pass
            deleted.append(sid)
        else:
            kept.append(sid)

    summary = {
        "retention_days": days,
        "cutoff": cutoff.isoformat(),
        "deleted": deleted,
        "kept": kept,
        "deleted_count": len(deleted),
        "kept_count": len(kept),
    }
    logger.info(
        "Snapshot retention: deleted=%d kept=%d (>%d days)",
        len(deleted),
        len(kept),
        days,
    )
    return summary


def total_snapshot_bytes() -> int:
    """Sum byte size of all snapshot CSV objects currently on disk."""
    root = snapshot_root()
    return sum(p.stat().st_size for p in root.glob("*.csv") if p.is_file())
