"""CLI wrapper to run Stellar ingestion quality checks.

This exists so scheduler/API can invoke a stable entrypoint.
"""

from __future__ import annotations

import os
import sys

# Ensure local imports work when executed from repo root or app root.
HERE = os.path.dirname(__file__)
# apps/data-processing/src needs to be on sys.path so `import ingestion...` works.
# The project uses both import styles; this script uses the direct package under src.
SRC_ROOT = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, SRC_ROOT)

from ingestion.stellar_ingestion_checks import main



if __name__ == "__main__":
    raise SystemExit(
        main(
            argv=None
        )
    )

