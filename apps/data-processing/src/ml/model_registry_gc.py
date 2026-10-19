"""
Model registry garbage collection (Issue #1457).

``save_model`` writes a new version on every retraining run. This module
removes versions that fall outside a retention policy so artefact storage
stays bounded.

Retention policy (a version is kept if ANY rule keeps it):
  * it is one of the newest ``keep_last`` versions of its model type
  * it was saved within the last ``max_age_days`` days (0 disables this rule)
  * it is protected: the live version, the previous live version (rollback
    target) or a shadow version. Protected versions are never removed.

Usage:
    python -m src.ml.model_registry_gc --dry-run
    python -m src.ml.model_registry_gc --model-type sentiment --keep-last 3
    python -m src.ml.model_registry_gc --keep-last 5 --max-age-days 30

Defaults come from ``MODEL_RETENTION_KEEP_LAST`` (5) and
``MODEL_RETENTION_MAX_AGE_DAYS`` (30). The registry root is
``MODEL_REGISTRY_PATH``, as for the rest of the registry.

Only versions named ``v<major>.<minor>`` are managed; any other file is left
alone. The GC takes the registry's in-process lock, but it cannot lock other
processes, so avoid running it during a promotion.
"""

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import src.ml.model_registry as registry
from src.utils.logger import setup_logger

logger = setup_logger(__name__)

DEFAULT_KEEP_LAST = 5
DEFAULT_MAX_AGE_DAYS = 30

_VERSION_RE = re.compile(r"^v(\d+)\.(\d+)$")
# Files that make up one saved version, next to <version>.pkl.
_ARTIFACT_SUFFIXES = (".pkl", ".meta.json", ".card.json")


@dataclass(frozen=True)
class RetentionPolicy:
    """How many versions and how much history to keep per model type."""

    keep_last: int = DEFAULT_KEEP_LAST
    max_age_days: float = DEFAULT_MAX_AGE_DAYS

    def __post_init__(self) -> None:
        if self.keep_last < 1:
            raise ValueError("keep_last must be at least 1")
        if self.max_age_days < 0:
            raise ValueError("max_age_days must be >= 0 (0 disables age retention)")

    @classmethod
    def from_env(cls) -> "RetentionPolicy":
        return cls(
            keep_last=int(os.getenv("MODEL_RETENTION_KEEP_LAST", DEFAULT_KEEP_LAST)),
            max_age_days=float(
                os.getenv("MODEL_RETENTION_MAX_AGE_DAYS", DEFAULT_MAX_AGE_DAYS)
            ),
        )


@dataclass
class VersionInfo:
    version: str
    files: list[Path]
    size_bytes: int
    saved_at: datetime


@dataclass
class ModelTypePlan:
    model_type: str
    kept: dict[str, str] = field(default_factory=dict)  # version -> reason
    remove: list[VersionInfo] = field(default_factory=list)


@dataclass
class GCReport:
    dry_run: bool
    removed: list[tuple[str, VersionInfo]] = field(default_factory=list)
    kept: dict[str, dict[str, str]] = field(default_factory=dict)
    reclaimed_bytes: int = 0
    errors: list[str] = field(default_factory=list)

    def lines(self) -> list[str]:
        verb = "Would remove" if self.dry_run else "Removed"
        out = [
            f"{verb} {v.version} of {t} ({format_bytes(v.size_bytes)}, "
            f"{len(v.files)} files)"
            for t, v in self.removed
        ]
        label = "would be reclaimed" if self.dry_run else "reclaimed"
        out.append(
            f"{len(self.removed)} version(s) {'to remove' if self.dry_run else 'removed'}, "
            f"{format_bytes(self.reclaimed_bytes)} {label}"
        )
        out.extend(f"ERROR: {e}" for e in self.errors)
        return out


def format_bytes(n: int) -> str:
    size = float(n)
    for unit in ("B", "KiB", "MiB", "GiB"):
        if size < 1024 or unit == "GiB":
            return f"{int(size)} B" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{n} B"  # pragma: no cover


# ---------------------------------------------------------------------------
# Inspection (read-only: never creates directories or migrates pointers)
# ---------------------------------------------------------------------------


def _version_key(version: str) -> Optional[tuple[int, int]]:
    m = _VERSION_RE.match(version)
    return (int(m.group(1)), int(m.group(2))) if m else None


def _read_pointer(path: Path) -> Optional[str]:
    try:
        version = json.loads(path.read_text(encoding="utf-8")).get("version")
    except (OSError, ValueError, AttributeError):
        return None
    return version if isinstance(version, str) and version else None


def _live_version(type_dir: Path) -> Optional[str]:
    version = _read_pointer(type_dir / "current.json")
    if version:
        return version
    legacy = type_dir / "current"  # legacy symlink, read without migrating
    if legacy.is_symlink():
        try:
            return legacy.resolve(strict=True).stem
        except OSError:
            return None
    return None


def _shadow_versions(model_type: str, type_dir: Path) -> set[str]:
    versions: set[str] = set()
    in_memory = registry._shadow_versions.get(model_type)
    if in_memory:
        versions.add(in_memory)
    shadow_dir = type_dir / "shadow"
    symlink = shadow_dir / "shadow_current"
    if symlink.is_symlink():
        versions.add(Path(os.readlink(symlink)).stem)
    if shadow_dir.is_dir():
        versions.update(p.stem for p in shadow_dir.glob("v*.pkl"))
    return versions


def protected_versions(
    model_type: str, sorted_versions: Optional[list[str]] = None
) -> dict[str, str]:
    """Map of version -> reason for versions that must never be removed."""
    type_dir = registry._MODELS_ROOT / model_type
    protected: dict[str, str] = {}

    live = _live_version(type_dir) or registry._live_versions.get(model_type)
    if live:
        protected[live] = "live"

    previous = _read_pointer(type_dir / "previous.json")
    if previous is None and live and sorted_versions and live in sorted_versions:
        # No recorded history (e.g. promoted before #1457): fall back to the
        # version saved just before the live one.
        idx = sorted_versions.index(live)
        previous = sorted_versions[idx - 1] if idx > 0 else None
    if previous:
        protected.setdefault(previous, "previous")

    for version in _shadow_versions(model_type, type_dir):
        protected.setdefault(version, "shadow")
    return protected


def _collect_versions(type_dir: Path) -> list[VersionInfo]:
    """Managed versions of a model type, newest first."""
    infos = []
    for pkl in type_dir.glob("v*.pkl"):
        version = pkl.stem
        if _version_key(version) is None:
            continue  # not a registry-managed name: leave untouched
        files = [
            type_dir / f"{version}{suffix}"
            for suffix in _ARTIFACT_SUFFIXES
            if (type_dir / f"{version}{suffix}").is_file()
        ]
        infos.append(
            VersionInfo(
                version=version,
                files=files,
                size_bytes=sum(f.stat().st_size for f in files),
                saved_at=datetime.fromtimestamp(pkl.stat().st_mtime, timezone.utc),
            )
        )
    return sorted(infos, key=lambda i: _version_key(i.version), reverse=True)


def plan_model_type(
    model_type: str, policy: RetentionPolicy, now: Optional[datetime] = None
) -> ModelTypePlan:
    now = now or datetime.now(timezone.utc)
    versions = _collect_versions(registry._MODELS_ROOT / model_type)
    protected = protected_versions(
        model_type, [v.version for v in reversed(versions)]
    )
    plan = ModelTypePlan(model_type)
    for index, info in enumerate(versions):
        age_days = (now - info.saved_at).total_seconds() / 86400
        if info.version in protected:
            plan.kept[info.version] = f"protected ({protected[info.version]})"
        elif index < policy.keep_last:
            plan.kept[info.version] = f"newest {policy.keep_last}"
        elif policy.max_age_days and age_days <= policy.max_age_days:
            plan.kept[info.version] = f"younger than {policy.max_age_days:g} days"
        else:
            plan.remove.append(info)
    return plan


def _model_types(only: Optional[str]) -> list[str]:
    root = registry._MODELS_ROOT
    if only:
        return [only] if (root / only).is_dir() else []
    if not root.is_dir():
        return []
    return sorted(p.name for p in root.iterdir() if p.is_dir())


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def collect_garbage(
    policy: Optional[RetentionPolicy] = None,
    model_type: Optional[str] = None,
    dry_run: bool = False,
    now: Optional[datetime] = None,
) -> GCReport:
    """Remove (or, with ``dry_run``, list) versions outside ``policy``."""
    policy = policy or RetentionPolicy.from_env()
    report = GCReport(dry_run=dry_run)

    for mtype in _model_types(model_type):
        with registry._lock:
            plan = plan_model_type(mtype, policy, now)
            report.kept[mtype] = plan.kept
            for info in plan.remove:
                if dry_run:
                    reclaimed = info.size_bytes
                else:
                    # Re-check right before deleting: a promotion in this
                    # process may have landed since planning.
                    reason = _protected_now(mtype).get(info.version)
                    if reason:
                        report.kept[mtype][info.version] = f"protected ({reason})"
                        continue
                    reclaimed = _delete(mtype, info, report)
                    if reclaimed is None:
                        continue
                report.removed.append((mtype, info))
                report.reclaimed_bytes += reclaimed
                logger.info(
                    "Model version %s: type=%s version=%s reclaimed=%s files=%d",
                    "would be removed" if dry_run else "removed",
                    mtype,
                    info.version,
                    format_bytes(reclaimed),
                    len(info.files),
                )

    logger.info(
        "Model registry GC %s: versions=%d reclaimed=%s keep_last=%d max_age_days=%g",
        "dry run" if dry_run else "complete",
        len(report.removed),
        format_bytes(report.reclaimed_bytes),
        policy.keep_last,
        policy.max_age_days,
    )
    return report


def _protected_now(model_type: str) -> dict[str, str]:
    versions = _collect_versions(registry._MODELS_ROOT / model_type)
    return protected_versions(model_type, [v.version for v in reversed(versions)])


def _delete(model_type: str, info: VersionInfo, report: GCReport) -> Optional[int]:
    """Delete a version's files; return bytes reclaimed, or None on failure."""
    reclaimed = 0
    try:
        for f in info.files:
            size = f.stat().st_size
            f.unlink()
            reclaimed += size
    except OSError as exc:
        report.errors.append(f"{model_type}@{info.version}: {exc}")
        logger.error(
            "Failed to remove model version: type=%s version=%s error=%s",
            model_type, info.version, exc,
        )
        return None
    return reclaimed


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Remove model registry versions outside the retention policy."
    )
    parser.add_argument("--dry-run", action="store_true",
                        help="list what would be deleted without deleting")
    parser.add_argument("--model-type", help="only this model type (default: all)")
    parser.add_argument("--keep-last", type=int,
                        help="newest versions to keep per type "
                             "(env MODEL_RETENTION_KEEP_LAST, default 5)")
    parser.add_argument("--max-age-days", type=float,
                        help="also keep versions newer than this; 0 disables "
                             "(env MODEL_RETENTION_MAX_AGE_DAYS, default 30)")
    args = parser.parse_args(argv)

    try:
        env_policy = RetentionPolicy.from_env()
        policy = RetentionPolicy(
            keep_last=args.keep_last if args.keep_last is not None
            else env_policy.keep_last,
            max_age_days=args.max_age_days if args.max_age_days is not None
            else env_policy.max_age_days,
        )
    except ValueError as exc:
        parser.error(str(exc))

    report = collect_garbage(policy, args.model_type, args.dry_run)
    print("\n".join(report.lines()))
    return 1 if report.errors else 0


if __name__ == "__main__":
    sys.exit(main())
