#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Inference service entry point (issue #1628).

Starts *only* the FastAPI inference server with uvicorn.  This is the entry
point used by ``Dockerfile.inference`` (and by ``docker-compose.yml``'s
``inference`` service).  It intentionally does NOT start the APScheduler
batch worker or any ingestion/retraining jobs.

Environment variables
---------------------
SERVICE_PORT        Port to bind (default: 8000).
SERVICE_HOST        Interface to bind (default: 0.0.0.0).
SERVICE_WORKERS     Number of uvicorn worker processes (default: 1).
                    Set > 1 only when MODEL_REGISTRY_PATH points to a shared
                    filesystem (each worker loads models independently).
LOG_LEVEL           Uvicorn/application log level (default: info).
MODEL_REGISTRY_PATH Path to the model registry directory shared with the
                    batch service (default: ./models).

Startup sequence
----------------
1. Validate pinned NER + embedding model artifacts (same gate as ``main.py
   serve``).
2. Pre-warm the sentiment and price_predictor models into the in-memory hot
   cache so the first request is not a cold-start disk read.
3. Hand off to uvicorn.
"""

from __future__ import annotations

import os
import sys

# Ensure the package root is on the path when running this file directly.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.utils.logger import setup_logger

logger = setup_logger(__name__)


def _run_model_gates() -> None:
    """Abort startup if any pinned model artifact is missing or wrong version."""
    from src.analytics.ner_service import check_model_available as check_ner
    from src.analytics.embedding_service import (
        check_model_available as check_embedding,
    )

    for label, gate in (("ner_model", check_ner), ("embedding_model", check_embedding)):
        logger.info("Checking pinned %s…", label)
        try:
            gate()
        except Exception as exc:
            logger.error("Startup model gate failed (%s): %s", label, exc)
            print(f"❌ {label} check failed: {exc}", file=sys.stderr)
            sys.exit(1)
        logger.info("Pinned %s OK", label)


def _prewarm_models() -> None:
    """Load the live sentiment and price_predictor models into memory."""
    from src.ml.model_loader import warm_models, INFERENCE_MODELS

    results = warm_models(*INFERENCE_MODELS)
    for mtype, ok in results.items():
        if not ok:
            logger.warning(
                "Model type=%s unavailable at startup; %s endpoints will "
                "return 503 until the batch service runs retraining.",
                mtype,
                mtype,
            )


def main() -> None:
    import uvicorn
    from dotenv import load_dotenv

    load_dotenv()

    host = os.getenv("SERVICE_HOST", "0.0.0.0")
    port = int(os.getenv("SERVICE_PORT", "8000"))
    workers = int(os.getenv("SERVICE_WORKERS", "1"))
    log_level = os.getenv("LOG_LEVEL", "info").lower()

    logger.info("=" * 70)
    logger.info("LumenPulse Inference Service Starting")
    logger.info("  host=%s  port=%d  workers=%d", host, port, workers)
    logger.info("=" * 70)

    _run_model_gates()
    _prewarm_models()

    uvicorn.run(
        "src.api.server:app",
        host=host,
        port=port,
        workers=workers,
        log_level=log_level,
        # Do NOT enable reload in production; models are pre-warmed above.
        reload=False,
    )


if __name__ == "__main__":
    main()
