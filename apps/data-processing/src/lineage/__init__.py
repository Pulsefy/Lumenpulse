# -*- coding: utf-8 -*-
"""
src/lineage — Feature and KPI lineage manifest package.

The canonical lineage manifest lives in ``feature_lineage.yaml`` (this
directory). Use the ``load_manifest()`` helper to parse and validate it
programmatically, or run the CLI validator:

    python scripts/validate_lineage.py

For schema and contributor guidance see ``LINEAGE.md`` in the root of the
data-processing module.
"""

from pathlib import Path
from typing import Any, Dict

import yaml

MANIFEST_PATH: Path = Path(__file__).parent / "feature_lineage.yaml"


def load_manifest(path: Path = MANIFEST_PATH) -> Dict[str, Any]:
    """Parse and return the lineage YAML manifest.

    This is the canonical loader used by both the CLI validator
    (scripts/validate_lineage.py) and the lineage API routes.
    """
    with path.open("r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
    if not isinstance(data, dict):
        raise ValueError("Manifest root must be a YAML mapping.")
    return data


__all__ = ["MANIFEST_PATH", "load_manifest"]
