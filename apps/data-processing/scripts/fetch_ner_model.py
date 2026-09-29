#!/usr/bin/env python3
"""
Fetch and vendor the pinned spaCy NER model at image build time.

This script installs the exact NER model version declared in
``src/config/ner_config.py`` so that the artifact is baked into the container
image instead of being downloaded at runtime. Containers built from this image
therefore start with no outbound network access for model resolution.

Usage:
    python scripts/fetch_ner_model.py [--check-only]

Exit codes:
    0  model present (or successfully fetched)
    1  model missing / version mismatch and could not be fixed
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
APP_ROOT = SCRIPT_DIR.parent
SRC_DIR = APP_ROOT / "src"

sys.path.insert(0, str(APP_ROOT))
sys.path.insert(0, str(SRC_DIR))

from src.config.ner_config import NERConfig  # noqa: E402


def _log(msg: str) -> None:
    print(f"[fetch_ner_model] {msg}", flush=True)


def _model_meta_path(model_dir: Path) -> Path:
    return model_dir / "meta.json"


def vendored_model_matches(cfg: NERConfig) -> bool:
    """Return True if the vendored model dir holds the exact pinned version."""
    meta_path = _model_meta_path(Path(cfg.model_dir))
    if not meta_path.is_file():
        return False
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    return meta.get("name") == cfg.shipped_version_tag


def _install_model(cfg: NERConfig) -> None:
    """Install the pinned model wheel into the image using pip.

    The wheel is installed into site-packages (mirroring what ``spacy.load``
    expects) and then copied into the vendored directory so the exact artifact
    is recorded at a stable, in-repo location.
    """
    _log(f"Installing pinned NER model {cfg.shipped_version_tag} from wheel...")
    install_target = os.environ.get(
        "NER_MODEL_INSTALL_CMD",
        f"{sys.executable} -m pip install --no-cache-dir {cfg.model_wheel_url}",
    )
    result = subprocess.run(install_target, shell=True, capture_output=True, text=True)
    if result.returncode != 0:
        _log(f"Model install failed:\n{result.stdout}\n{result.stderr}")
        raise SystemExit(1)

    _log(f"Copying installed model into {cfg.model_dir} ...")
    import importlib

    module = importlib.import_module(cfg.model_name)
    installed_root = Path(module.__file__).resolve().parent
    target = Path(cfg.model_dir)
    target.mkdir(parents=True, exist_ok=True)
    for item in installed_root.iterdir():
        dest = target / item.name
        if item.is_dir():
            import shutil

            if dest.exists():
                shutil.rmtree(dest)
            shutil.copytree(item, dest)
        else:
            shutil.copy2(item, dest)

    if not vendored_model_matches(cfg):
        _log(f"Vendored model does not match {cfg.shipped_version_tag} after install")
        raise SystemExit(1)

    _log(f"Nailed vendored model {cfg.shipped_version_tag} into {cfg.model_dir}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Vendor the pinned spaCy NER model.")
    parser.add_argument(
        "--check-only",
        action="store_true",
        help="Only verify the pinned model is already present; do not fetch.",
    )
    args = parser.parse_args()

    cfg = NERConfig.from_env()

    if vendored_model_matches(cfg):
        _log(f"Vendored NER model {cfg.shipped_version_tag} is present and up-to-date.")
        return 0

    if args.check_only:
        _log(
            f"ERROR: expected NER model {cfg.shipped_version_tag} at "
            f"{cfg.model_dir} but it is missing or mismatched."
        )
        return 1

    _install_model(cfg)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
