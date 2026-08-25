#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CLI script: seed the sentiment_labelled_examples table with the
bundled ground-truth examples from data/sentiment_seed_labels.json.

Usage
-----
    # Dry-run — print what would be inserted without touching the DB
    python scripts/seed_sentiment_labels.py --dry-run

    # Insert seed data (skips rows whose text already exists)
    python scripts/seed_sentiment_labels.py

    # Point to a custom JSON file
    python scripts/seed_sentiment_labels.py --file /path/to/labels.json

    # Force re-insert even if rows exist (recreates all seed rows)
    python scripts/seed_sentiment_labels.py --force

Exit codes
----------
    0  Success
    1  Error (invalid file, DB connection failure, etc.)
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path

# Allow running from project root or from scripts/ directory.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("seed_sentiment_labels")

# Default seed file location — relative to this script's repo root.
_DEFAULT_SEED_FILE = Path(__file__).resolve().parents[1] / "data" / "sentiment_seed_labels.json"


def load_seed_file(path: Path) -> list:
    """Load and validate the seed JSON file."""
    if not path.exists():
        raise FileNotFoundError(f"Seed file not found: {path}")
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, list):
        raise ValueError(f"Seed file must contain a JSON array; got {type(data).__name__}")
    return data


def build_session():
    """
    Build a SQLAlchemy Session from the DATABASE_URL env var.

    Falls back gracefully to an in-memory SQLite database when
    DATABASE_URL is absent (useful for development / CI without a live PG).
    """
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    from src.db.models import Base

    url = os.environ.get("DATABASE_URL", "sqlite:///:memory:")
    logger.info("Connecting to database: %s", url.split("@")[-1] if "@" in url else url)
    engine = create_engine(url, future=True)

    # Create the table if it does not yet exist (idempotent).
    Base.metadata.create_all(engine, checkfirst=True)
    return Session(engine)


def run(
    seed_file: Path,
    *,
    dry_run: bool = False,
    force: bool = False,
) -> int:
    """
    Main seeding logic.

    Returns the count of rows inserted (0 on dry-run).
    """
    examples = load_seed_file(seed_file)
    logger.info("Loaded %d examples from %s", len(examples), seed_file)

    if dry_run:
        logger.info("[DRY RUN] Would insert the following examples:")
        for i, ex in enumerate(examples, 1):
            logger.info(
                "  %3d. [%s|%s] %s",
                i,
                ex.get("label", "?"),
                ex.get("split", "train"),
                (ex.get("text", ""))[:60],
            )
        logger.info("[DRY RUN] No changes made.")
        return 0

    from sqlalchemy import text as sa_text
    from sqlalchemy.exc import SQLAlchemyError

    from src.db.label_store import LabelStore

    try:
        session = build_session()
    except Exception as exc:
        logger.error("Failed to connect to the database: %s", exc)
        return 1

    with session:
        store = LabelStore(session)
        inserted = 0
        skipped = 0

        try:
            for ex in examples:
                text_val = ex.get("text", "").strip()
                label_val = ex.get("label", "")
                labeller_val = ex.get("labeller", "seed")
                split_val = ex.get("split", "train")

                if not text_val or not label_val:
                    logger.warning("Skipping entry with empty text or label: %s", ex)
                    skipped += 1
                    continue

                # Check for duplicates unless --force
                if not force:
                    from src.db.models import SentimentLabelledExample
                    existing = (
                        session.query(SentimentLabelledExample)
                        .filter(SentimentLabelledExample.text == text_val)
                        .first()
                    )
                    if existing:
                        logger.debug("Skipping duplicate text (id=%d)", existing.id)
                        skipped += 1
                        continue

                store.add(
                    text=text_val,
                    label=label_val,
                    labeller=labeller_val,
                    split=split_val,
                )
                inserted += 1

            session.commit()

        except SQLAlchemyError as exc:
            session.rollback()
            logger.error("Database error during seed: %s", exc)
            return 1

    logger.info(
        "Seeding complete. Inserted=%d  Skipped=%d  Total=%d",
        inserted,
        skipped,
        len(examples),
    )
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Seed the sentiment_labelled_examples table with human-labelled ground-truth data.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--file",
        "-f",
        type=Path,
        default=_DEFAULT_SEED_FILE,
        help="Path to the seed JSON file (default: data/sentiment_seed_labels.json)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be inserted without writing to the database",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Insert all rows even if they already exist (may create duplicates)",
    )
    parser.add_argument(
        "--env",
        type=Path,
        default=None,
        help="Path to a .env file to load before connecting (defaults to .env in project root)",
    )

    args = parser.parse_args()

    # Load environment variables
    env_path = args.env or (Path(__file__).resolve().parents[1] / ".env")
    if env_path.exists():
        load_dotenv(env_path)
        logger.info("Loaded environment from %s", env_path)
    else:
        load_dotenv()

    exit_code = run(args.file, dry_run=args.dry_run, force=args.force)
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
