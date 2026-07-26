#!/usr/bin/env python3
"""
validate_lineage.py — Validate and inspect the feature/KPI lineage manifest.

Usage
-----
# Validate (exit 0 on success, 1 on error)
python scripts/validate_lineage.py

# Pretty-print a summary of all registered entries
python scripts/validate_lineage.py --summary

# Show detail for a specific entry by id
python scripts/validate_lineage.py --show market_health_score
python scripts/validate_lineage.py --show price_predictor_features

# Verify that all source_file paths referenced in the manifest exist
python scripts/validate_lineage.py --check-files

# Output as JSON (useful for CI / downstream tooling)
python scripts/validate_lineage.py --json

Validation rules
----------------
1. YAML parses without errors.
2. Top-level keys ``manifest_version``, ``project``, ``module`` are present.
3. At least one entry in ``ml_feature_sets`` and one in ``kpi_datasets``.
4. Every entry has ``id``, ``display_name``, ``description``, ``owner``,
   ``source_file``.
5. No duplicate ``id`` values across the whole manifest.
6. ``owner`` values look like an email address or a GitHub handle (``@…``).
7. (--check-files) Every ``source_file`` and ``model_file`` path resolves
   relative to the data-processing root.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    import yaml
except ImportError:
    print("ERROR: PyYAML is not installed.  Run: pip install pyyaml", file=sys.stderr)
    sys.exit(1)

# ── Paths ──────────────────────────────────────────────────────────────────

_SCRIPT_DIR = Path(__file__).resolve().parent
_ROOT = _SCRIPT_DIR.parent                          # apps/data-processing/
_MANIFEST = _ROOT / "src" / "lineage" / "feature_lineage.yaml"


# ── Helpers ────────────────────────────────────────────────────────────────

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_HANDLE_RE = re.compile(r"^@\S+$")

_REQUIRED_TOP_KEYS = {"manifest_version", "project", "module"}
_REQUIRED_ENTRY_KEYS = {"id", "display_name", "description", "owner", "source_file"}


def _looks_like_owner(value: str) -> bool:
    """Accept email addresses and GitHub-style @handles."""
    return bool(_EMAIL_RE.match(value) or _HANDLE_RE.match(value))


# ── Loader ─────────────────────────────────────────────────────────────────

def load_manifest(path: Path = _MANIFEST) -> Dict[str, Any]:
    """Parse and return the manifest YAML.  Raises on parse error."""
    with path.open("r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
    if not isinstance(data, dict):
        raise ValueError("Manifest root must be a YAML mapping.")
    return data


# ── Validation ─────────────────────────────────────────────────────────────

def _collect_errors(
    manifest: Dict[str, Any],
    check_files: bool = False,
    root: Path = _ROOT,
) -> List[str]:
    errors: List[str] = []

    # Rule 2 – required top-level keys
    for key in _REQUIRED_TOP_KEYS:
        if key not in manifest:
            errors.append(f"Missing top-level key: '{key}'")

    # Rule 3 – at least one entry in each section
    ml_sets: List[Dict] = manifest.get("ml_feature_sets") or []
    kpi_sets: List[Dict] = manifest.get("kpi_datasets") or []

    if not ml_sets:
        errors.append("'ml_feature_sets' is empty or missing — at least one entry required.")
    if not kpi_sets:
        errors.append("'kpi_datasets' is empty or missing — at least one entry required.")

    all_entries: List[Tuple[str, Dict]] = (
        [("ml_feature_sets", e) for e in ml_sets]
        + [("kpi_datasets", e) for e in kpi_sets]
    )

    # Rule 4 – required entry-level keys
    for section, entry in all_entries:
        entry_id = entry.get("id", "<unknown>")
        for key in _REQUIRED_ENTRY_KEYS:
            if key not in entry:
                errors.append(f"[{section}/{entry_id}] Missing required key: '{key}'")

    # Rule 5 – no duplicate IDs
    all_ids = [e.get("id") for _, e in all_entries if "id" in e]
    seen: set = set()
    for eid in all_ids:
        if eid in seen:
            errors.append(f"Duplicate 'id' value: '{eid}'")
        seen.add(eid)

    # Rule 6 – owner format
    for section, entry in all_entries:
        owner = entry.get("owner", "")
        if owner and not _looks_like_owner(str(owner)):
            errors.append(
                f"[{section}/{entry.get('id', '?')}] 'owner' value '{owner}' "
                "does not look like an email or @handle."
            )

    # Rule 7 – file existence (optional)
    if check_files:
        file_keys = ("source_file", "model_file")
        for section, entry in all_entries:
            entry_id = entry.get("id", "<unknown>")
            for key in file_keys:
                fpath = entry.get(key)
                if fpath and not (root / fpath).exists():
                    errors.append(
                        f"[{section}/{entry_id}] {key} not found: '{fpath}'"
                    )

    return errors


def validate(
    path: Path = _MANIFEST,
    check_files: bool = False,
) -> Tuple[bool, Dict[str, Any], List[str]]:
    """
    Validate the lineage manifest.

    Returns:
        (ok, manifest_dict, errors_list)
    """
    try:
        manifest = load_manifest(path)
    except Exception as exc:
        return False, {}, [f"YAML parse error: {exc}"]

    errors = _collect_errors(manifest, check_files=check_files)
    return len(errors) == 0, manifest, errors


# ── Display helpers ────────────────────────────────────────────────────────

def _entry_summary(entry: Dict[str, Any]) -> str:
    lines = [
        f"  id          : {entry.get('id', '-')}",
        f"  display     : {entry.get('display_name', '-')}",
        f"  owner       : {entry.get('owner', '-')}",
        f"  source_file : {entry.get('source_file', '-')}",
    ]
    desc = entry.get("description", "").strip().replace("\n", " ")
    if len(desc) > 100:
        desc = desc[:97] + "…"
    lines.append(f"  description : {desc}")
    return "\n".join(lines)


def print_summary(manifest: Dict[str, Any]) -> None:
    ml_sets = manifest.get("ml_feature_sets") or []
    kpi_sets = manifest.get("kpi_datasets") or []

    print(f"\n{'='*60}")
    print(f"  LumenPulse Feature Lineage Manifest  v{manifest.get('manifest_version', '?')}")
    print(f"  Module : {manifest.get('module', '?')}  |  Project : {manifest.get('project', '?')}")
    print(f"{'='*60}\n")

    print(f"ML Feature Sets ({len(ml_sets)})")
    print("-" * 40)
    for entry in ml_sets:
        print(_entry_summary(entry))
        print()

    print(f"KPI Datasets ({len(kpi_sets)})")
    print("-" * 40)
    for entry in kpi_sets:
        print(_entry_summary(entry))
        print()


def print_entry(manifest: Dict[str, Any], entry_id: str) -> None:
    all_entries = list(manifest.get("ml_feature_sets") or []) + list(
        manifest.get("kpi_datasets") or []
    )
    matches = [e for e in all_entries if e.get("id") == entry_id]
    if not matches:
        print(f"No entry found with id='{entry_id}'", file=sys.stderr)
        sys.exit(1)

    entry = matches[0]
    print(f"\n{'='*60}")
    print(f"  {entry.get('display_name', entry_id)}")
    print(f"{'='*60}")
    print(yaml.dump(entry, default_flow_style=False, sort_keys=False, allow_unicode=True))


# ── CLI ────────────────────────────────────────────────────────────────────

def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate and inspect the LumenPulse feature lineage manifest.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=_MANIFEST,
        help=f"Path to manifest YAML (default: {_MANIFEST})",
    )
    parser.add_argument(
        "--summary",
        action="store_true",
        help="Print a human-readable summary of all registered entries.",
    )
    parser.add_argument(
        "--show",
        metavar="ID",
        help="Print full detail for a specific entry id.",
    )
    parser.add_argument(
        "--check-files",
        action="store_true",
        help="Verify that source_file / model_file paths exist on disk.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output validation result as JSON (for CI pipelines).",
    )
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    ok, manifest, errors = validate(
        path=args.manifest,
        check_files=args.check_files,
    )

    if args.json:
        result = {
            "valid": ok,
            "manifest_path": str(args.manifest),
            "ml_feature_sets": len(manifest.get("ml_feature_sets") or []),
            "kpi_datasets": len(manifest.get("kpi_datasets") or []),
            "errors": errors,
        }
        print(json.dumps(result, indent=2))
        return 0 if ok else 1

    if not ok:
        print(f"\n❌  Manifest validation FAILED  ({len(errors)} error(s))\n")
        for i, err in enumerate(errors, 1):
            print(f"  {i}. {err}")
        print()
        return 1

    # Validation passed
    ml_count = len(manifest.get("ml_feature_sets") or [])
    kpi_count = len(manifest.get("kpi_datasets") or [])
    print(
        f"\n✅  Manifest is valid  "
        f"({ml_count} ML feature set(s), {kpi_count} KPI dataset(s))\n"
    )

    if args.summary:
        print_summary(manifest)

    if args.show:
        print_entry(manifest, args.show)

    return 0


if __name__ == "__main__":
    sys.exit(main())
