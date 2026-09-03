# -*- coding: utf-8 -*-
"""
src/lineage/graph.py — Build a traversable upstream/downstream lineage graph
from the feature/KPI lineage manifest (``feature_lineage.yaml``).

This is the engine behind ``GET /api/lineage/{feature_id}`` (issue #1254):
it reads the manifest (the single source of truth — no separate graph is
maintained), resolves the dotted cross-references entries use to point at
each other (see ``src/lineage/manifest.py``), and walks them to answer
"what feeds this, and what does this feed?" for a named feature or KPI.

Two kinds of upstream/downstream edges are recognised:

  * **Manifest edges** — a dotted reference (e.g.
    ``kpi_datasets.sentiment_compound``) found in another entry's
    ``inputs[].upstream`` or ``downstream`` field. These connect two nodes
    that both live in the manifest.
  * **External sources** — a free-text reference (a file path, module
    path, or API route) found in the same fields. These are leaves: raw
    ingestion code or endpoints that aren't themselves manifest entries,
    but are exactly the "trace a KPI back to its inputs" endpoints the
    lineage graph exists to answer, so they're included as terminal nodes.

The graph is directed: an ``upstream`` reference on entry X pointing at Y
means "Y feeds X" (edge Y → X); a ``downstream`` reference on X pointing at
Y means "X feeds Y" (edge X → Y). Both directions are indexed globally
before traversal, so a queried node's upstream/downstream is complete even
if only one side of a relationship was declared in the manifest.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple

from .manifest import (
    find_entry,
    iter_entries,
    load_manifest,
    parse_ref,
    ref_strings,
)


class LineageNotFoundError(KeyError):
    """Raised when a queried feature/dataset id has no manifest entry."""


@dataclass
class LineageNode:
    """One node in the lineage graph — a manifest entry or an external source."""

    id: str
    kind: str  # "ml_feature_set" | "kpi_dataset" | "external_source"
    display_name: str
    description: Optional[str]
    source_system: List[str]
    transformation: Optional[str]
    owning_module: Optional[str]
    owner: Optional[str]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "display_name": self.display_name,
            "description": self.description,
            "source_system": self.source_system,
            "transformation": self.transformation,
            "owning_module": self.owning_module,
            "owner": self.owner,
        }


_SECTION_KIND = {
    "ml_feature_sets": "ml_feature_set",
    "kpi_datasets": "kpi_dataset",
}


def _node_id(section: str, entry: Dict[str, Any]) -> str:
    return entry.get("id", "")


def build_node(section: str, entry: Dict[str, Any], module: Optional[str]) -> LineageNode:
    """Build the node metadata for a manifest entry."""
    source_system: List[str] = []
    for feat in entry.get("features") or []:
        table = feat.get("source_table") if isinstance(feat, dict) else None
        if table and table not in source_system:
            source_system.append(table)
    if not source_system:
        source_file = entry.get("source_file")
        if source_file:
            source_system.append(source_file)

    transformation = entry.get("formula")
    if not transformation:
        desc = entry.get("description")
        transformation = desc.strip() if isinstance(desc, str) else None

    return LineageNode(
        id=entry.get("id", ""),
        kind=_SECTION_KIND.get(section, section),
        display_name=entry.get("display_name", entry.get("id", "")),
        description=entry.get("description"),
        source_system=source_system,
        transformation=transformation,
        owning_module=module,
        owner=entry.get("owner"),
    )


def _external_node(ref: str) -> LineageNode:
    """Build a leaf node for a free-text (non-manifest) upstream/downstream ref."""
    return LineageNode(
        id=ref,
        kind="external_source",
        display_name=ref,
        description=None,
        source_system=[ref],
        transformation=None,
        owning_module=None,
        owner=None,
    )


@dataclass
class _Edge:
    src: str  # "section.entry_id" for manifest nodes, or the raw external ref
    dst: str


@dataclass
class _Graph:
    manifest: Dict[str, Any]
    module: Optional[str]
    forward: Dict[str, Set[str]] = field(default_factory=dict)  # src -> {dst}
    backward: Dict[str, Set[str]] = field(default_factory=dict)  # dst -> {src}
    nodes: Dict[str, LineageNode] = field(default_factory=dict)

    def add_edge(self, src: str, dst: str) -> None:
        self.forward.setdefault(src, set()).add(dst)
        self.backward.setdefault(dst, set()).add(src)


def _normalize_external_ref(raw: str) -> str:
    """Collapse the YAML column-alignment whitespace some free-text refs carry."""
    return re.sub(r"\s+", " ", raw.strip())


def _build_graph(manifest: Dict[str, Any]) -> _Graph:
    module = manifest.get("module")
    g = _Graph(manifest=manifest, module=module)

    for section, entry in iter_entries(manifest):
        eid = _node_id(section, entry)
        if not eid:
            continue
        g.nodes[eid] = build_node(section, entry, module)

        # `upstream` refs on this entry mean: <ref> feeds this entry.
        for raw in ref_strings(entry, "upstream"):
            ref = parse_ref(raw)
            if ref is not None:
                g.add_edge(ref.entry_id, eid)
            else:
                ext = _normalize_external_ref(raw)
                g.nodes.setdefault(ext, _external_node(ext))
                g.add_edge(ext, eid)

        # `downstream` refs on this entry mean: this entry feeds <ref>.
        for raw in ref_strings(entry, "downstream"):
            ref = parse_ref(raw)
            if ref is not None:
                g.add_edge(eid, ref.entry_id)
            else:
                ext = _normalize_external_ref(raw)
                g.nodes.setdefault(ext, _external_node(ext))
                g.add_edge(eid, ext)

    return g


def _walk(g: _Graph, start: str, adjacency: Dict[str, Set[str]]) -> List[Tuple[str, int]]:
    """BFS from ``start``, returning ``(node_id, distance)`` pairs, excluding start."""
    visited = {start}
    frontier = [start]
    distance = 0
    result: List[Tuple[str, int]] = []
    while frontier:
        distance += 1
        next_frontier: List[str] = []
        for node_id in frontier:
            for neighbour in sorted(adjacency.get(node_id, ())):
                if neighbour in visited:
                    continue
                visited.add(neighbour)
                result.append((neighbour, distance))
                next_frontier.append(neighbour)
        frontier = next_frontier
    return result


def get_lineage(feature_id: str, manifest: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Return the upstream and downstream lineage graph for ``feature_id``.

    Raises:
        LineageNotFoundError: if ``feature_id`` doesn't match any entry's
            ``id`` in either manifest section.
    """
    manifest = manifest if manifest is not None else load_manifest()
    match = find_entry(manifest, feature_id)
    if match is None:
        raise LineageNotFoundError(feature_id)
    section, entry = match

    g = _build_graph(manifest)
    node = g.nodes.get(feature_id) or build_node(section, entry, g.module)

    def _render(pairs: List[Tuple[str, int]]) -> List[Dict[str, Any]]:
        out = []
        for node_id, distance in pairs:
            n = g.nodes.get(node_id) or _external_node(node_id)
            d = n.to_dict()
            d["distance"] = distance
            out.append(d)
        return out

    upstream = _render(_walk(g, feature_id, g.backward))
    downstream = _render(_walk(g, feature_id, g.forward))

    return {
        "feature_id": feature_id,
        "node": node.to_dict(),
        "upstream": upstream,
        "downstream": downstream,
        "manifest_version": manifest.get("manifest_version"),
    }
