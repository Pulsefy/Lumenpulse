# -*- coding: utf-8 -*-
"""
src/lineage/manifest.py — Shared loader and reference-resolution helpers for
the feature/KPI lineage manifest (``feature_lineage.yaml``).

This module is the single place that knows how to:

  * parse the manifest YAML,
  * iterate its entries (``ml_feature_sets`` + ``kpi_datasets``),
  * recognise and resolve the manifest's dotted intra-file reference syntax,
    e.g. ``ml_feature_sets.price_predictor_features.sentiment_score`` or
    ``kpi_datasets.sentiment_compound``.

Both ``scripts/validate_lineage.py`` (CI validation) and
``src/lineage/graph.py`` (the lineage API) build on these helpers so the two
never drift on what counts as a valid reference.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List, NamedTuple, Optional, Tuple

import yaml

from . import MANIFEST_PATH

__all__ = [
    "MANIFEST_PATH",
    "ManifestRef",
    "load_manifest",
    "iter_entries",
    "find_entry",
    "parse_ref",
    "resolve_ref",
    "entry_feature_names",
    "ref_strings",
]

# Sections that hold lineage entries, keyed by their manifest section name.
SECTIONS: Tuple[str, ...] = ("ml_feature_sets", "kpi_datasets")

# Matches the manifest's dotted cross-reference syntax:
#   <section>.<entry_id>            e.g. kpi_datasets.sentiment_compound
#   <section>.<entry_id>.<feature>  e.g. ml_feature_sets.price_predictor_features.sentiment_score
# Anchored on the full string so free-text refs (file paths, "GET /api/x",
# "module.py::Class.method") never match — those contain '/', '::', spaces,
# or parentheses that this pattern rejects.
_REF_RE = re.compile(
    r"^(?P<section>ml_feature_sets|kpi_datasets)\.(?P<entry_id>[A-Za-z0-9_]+)"
    r"(?:\.(?P<feature>[A-Za-z0-9_]+))?$"
)


class ManifestRef(NamedTuple):
    """A parsed dotted reference into the lineage manifest."""

    section: str
    entry_id: str
    feature: Optional[str] = None

    def __str__(self) -> str:  # pragma: no cover - trivial
        return (
            f"{self.section}.{self.entry_id}.{self.feature}"
            if self.feature
            else f"{self.section}.{self.entry_id}"
        )


def load_manifest(path: Path = MANIFEST_PATH) -> Dict[str, Any]:
    """Parse and return the manifest YAML. Raises on parse error."""
    with path.open("r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
    if not isinstance(data, dict):
        raise ValueError("Manifest root must be a YAML mapping.")
    return data


def iter_entries(manifest: Dict[str, Any]) -> List[Tuple[str, Dict[str, Any]]]:
    """Return every ``(section, entry)`` pair across all sections, in order."""
    out: List[Tuple[str, Dict[str, Any]]] = []
    for section in SECTIONS:
        for entry in manifest.get(section) or []:
            out.append((section, entry))
    return out


def find_entry(
    manifest: Dict[str, Any], entry_id: str
) -> Optional[Tuple[str, Dict[str, Any]]]:
    """Look up an entry by its ``id`` across all sections."""
    for section, entry in iter_entries(manifest):
        if entry.get("id") == entry_id:
            return section, entry
    return None


def entry_feature_names(entry: Dict[str, Any]) -> List[str]:
    """
    Return the names of an entry's sub-items, if any — ``features[].name``
    for ML feature sets or ``inputs[].name`` for KPI datasets. Used to
    validate the optional third component of a dotted reference.
    """
    names: List[str] = []
    for key in ("features", "inputs"):
        for item in entry.get(key) or []:
            name = item.get("name") if isinstance(item, dict) else None
            if name:
                names.append(name)
    return names


def parse_ref(value: Any) -> Optional[ManifestRef]:
    """
    Parse ``value`` as a dotted manifest cross-reference. Returns ``None``
    if it isn't a string or doesn't match the dotted syntax (e.g. it's a
    free-text file path, API route, or module reference instead).
    """
    if not isinstance(value, str):
        return None
    m = _REF_RE.match(value.strip())
    if not m:
        return None
    return ManifestRef(
        section=m.group("section"),
        entry_id=m.group("entry_id"),
        feature=m.group("feature"),
    )


def ref_strings(entry: Dict[str, Any], field_name: str) -> List[str]:
    """
    Collect every raw string value under ``field_name`` on an entry or its
    sub-items (``inputs[]`` / ``features[]``) — a field may be a bare
    string, or a list mixing dotted manifest refs with free-text refs.
    """
    out: List[str] = []

    def _collect(value: Any) -> None:
        if isinstance(value, str):
            out.append(value)
        elif isinstance(value, list):
            for item in value:
                _collect(item)

    _collect(entry.get(field_name))
    for sub in (entry.get("inputs") or []) + (entry.get("features") or []):
        if isinstance(sub, dict):
            _collect(sub.get(field_name))
    return out


def resolve_ref(manifest: Dict[str, Any], ref: ManifestRef) -> bool:
    """
    Return ``True`` if ``ref`` resolves to an existing entry (and, when a
    feature component is present, an existing sub-item on that entry).
    """
    match = find_entry(manifest, ref.entry_id)
    if match is None:
        return False
    section, entry = match
    if section != ref.section:
        return False
    if ref.feature is None:
        return True
    return ref.feature in entry_feature_names(entry)
