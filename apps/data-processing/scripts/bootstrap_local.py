#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Provision a fresh local stack (issue #1645).

Creates the database schema, seeds the labelled sentiment set and the sample
analytics records (only while ``analytics_records`` is empty) and makes sure
the live model registry has a promoted ``sentiment`` and ``price_predictor``
model. Idempotent: safe to run on every ``docker compose up``. Exits non-zero
when the API would not be usable afterwards, so compose never starts it.

Environment variables
---------------------
BOOTSTRAP_DB_WAIT_SECONDS  How long to wait for Postgres (default: 60).
BOOTSTRAP_MODEL_SEED       Seed for the bootstrap training run (default: 42).
"""

from __future__ import annotations

import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.utils.logger import setup_logger  # noqa: E402

logger = setup_logger(__name__)

REQUIRED_MODELS = ("sentiment", "price_predictor")
DB_WAIT_SECONDS = int(os.getenv("BOOTSTRAP_DB_WAIT_SECONDS", "60"))
MODEL_SEED = int(os.getenv("BOOTSTRAP_MODEL_SEED", "42"))
APP_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def init_database():
    """Create tables (retrying while Postgres starts) and return the service."""
    from src.db import PostgresService

    deadline = time.monotonic() + DB_WAIT_SECONDS
    while True:
        try:
            db = PostgresService()
            db.create_tables()
            logger.info("Database schema ready")
            return db
        except Exception as exc:  # noqa: BLE001
            if time.monotonic() >= deadline:
                raise
            logger.info("Waiting for database: %s", exc)
            time.sleep(2)


def seed_labels(db) -> None:
    """Seed the labelled sentiment set. Best effort: models do not need it."""
    try:
        from src.ml.sentiment_evaluation import seed_sentiment_labels

        seed_sentiment_labels(db)
        logger.info("Seeded sentiment labels")
    except Exception as exc:  # noqa: BLE001
        logger.warning("Sentiment label seeding skipped: %s", exc)


def seed_analytics(db) -> None:
    """Load data/analytics.jsonl once, only while analytics_records is empty.

    Best effort: a failure is logged but does not stop the stack.
    """
    try:
        from sqlalchemy import text

        with db.get_session() as session:
            count = session.execute(
                text("SELECT COUNT(*) FROM analytics_records")
            ).scalar()
        if count:
            logger.info("Analytics seed skipped: %s rows already present", count)
            return
        code = subprocess.call(
            [sys.executable, "scripts/migrate_jsonl_to_db.py"], cwd=APP_ROOT
        )
        if code != 0:
            logger.warning("Analytics seed exited with code %s", code)
        else:
            logger.info("Seeded analytics_records from data/analytics.jsonl")
    except Exception as exc:  # noqa: BLE001
        logger.warning("Analytics seeding skipped: %s", exc)


def missing_models() -> list:
    from src.ml.model_loader import get_model_version

    return [m for m in REQUIRED_MODELS if not get_model_version(m)]


def train_models() -> None:
    """Train and promote both models (synthetic data, no live APIs needed)."""
    from src.ml.retraining_pipeline import run_retraining

    result = run_retraining(force=True, seed=MODEL_SEED)
    if result.get("status") != "completed":
        raise RuntimeError(f"model training failed: {result.get('error', result)}")


def main() -> int:
    try:
        db = init_database()
        seed_labels(db)
        seed_analytics(db)
        todo = missing_models()
        if todo:
            logger.info("Provisioning models (missing: %s)", ", ".join(todo))
            train_models()
        still_missing = missing_models()
        if still_missing:
            raise RuntimeError(f"models not promoted: {', '.join(still_missing)}")
    except Exception as exc:  # noqa: BLE001
        logger.error("Bootstrap failed: %s", exc, exc_info=True)
        return 1
    logger.info("Bootstrap complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
