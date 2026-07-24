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

MANIFEST_PATH: Path = Path(__file__).parent / "feature_lineage.yaml"

__all__ = ["MANIFEST_PATH"]
