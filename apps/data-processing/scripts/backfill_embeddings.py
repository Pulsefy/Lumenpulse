#!/usr/bin/env python3
"""
backfill_embeddings.py — Resumable backfill of article semantic embeddings (#1455).

Writes 300-dim `ArticleEmbedding` rows for every ingested article that has no
stored embedding for the current pinned model (``en_core_web_md`` 3.7.1),
mirroring how NER backfills populate ``news_article_detected_entities``.

Why resumable
-------------
Progress is keyed off ``iter_article_ids_missing_embeddings(model_version)`:
each batch only ever contains article ids *missing* the embedding at read time,
so a crash mid-run loses at most the in-flight batch (and the cross-batch
upsert keeps re-runs idempotent).  Combined with ``--limit``/``--batch-size``
this doubles as the CI smoke-step for the fetch gate.

Usage
-----
    python scripts/backfill_embeddings.py                 # full resumable run
    python scripts/backfill_embeddings.py --limit 50      # bounded/smoke run
    python scripts/backfill_embeddings.py --dry-run       # plan, no writes
    python scripts/backfill_embeddings.py --batch-size 100

Exit codes
----------
0  completed (or nothing to do)
1  embeddable articles remain after ``--limit`` (resumable), or a model fetch
   is required before embeddings can be produced
2  environment error (spaCy model missing and not fetchable)
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import Optional

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.analytics.embedding_service import (  # noqa: E402
    EmbeddingService,
    MissingEmbeddingModelError,
    check_model_available,
    hash_article_text,
)
from src.config.embedding_config import EmbeddingConfig  # noqa: E402
from src.db import PostgresService  # noqa: E402


def _fmt_count(n: int) -> str:
    return f"{n:,}"


def main(argv: Optional[list] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Backfill semantic embeddings for ingested news articles (#1455)."
    )
    parser.add_argument(
        "--limit", type=int, default=0, help="Max articles to embed (0 = no limit)."
    )
    parser.add_argument(
        "--batch-size", type=int, default=200, help="DB fetch batch size."
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Report what would run without writing."
    )
    parser.add_argument("--dsn", default=None, help="Optional DATABASE_URL override.")
    args = parser.parse_args(argv)

    cfg = EmbeddingConfig.from_env()
    svc = EmbeddingService(cfg=cfg)

    # 1. Gate: vendored model must exist (mirrors check-models in main.py).
    try:
        check_model_available(cfg)
    except MissingEmbeddingModelError as exc:
        print(f"[backfill] ✗ {exc}", file=sys.stderr)
        return 2

    db = PostgresService(database_url=args.dsn) if args.dsn else PostgresService()

    processed = 0
    for batch in db.iter_article_ids_missing_embeddings(
        model_version=cfg.model_version, batch_size=args.batch_size
    ):
        if not batch:
            continue
        if args.dry_run:
            print(f"[dry-run] would embed {_fmt_count(len(batch))} article(s)…")
            processed += len(batch)
            continue
        for article_id in batch:
            article = db.get_article_by_id(article_id)
            if article is None:
                continue
            # Non-blocking single-article embed + persist; failures never break
            # the resumable loop (the id stays "missing" for the next run).
            vector = svc.embed_article(
                title=article.title,
                summary=article.summary,
                content=article.content,
            )
            if not vector or not any(vector):
                continue
            db.save_article_embedding(
                article_id=article_id,
                embedding=vector,
                model_name=cfg.model_name,
                model_version=cfg.model_version,
                dimension=cfg.dimension,
                text_hash=hash_article_text(
                    article.title, article.summary, article.content
                ),
            )
            processed += 1
            if args.limit and processed >= args.limit:
                print(
                    f"[backfill] reached --limit={args.limit}; "
                    f"{_fmt_count(processed)} embedded. Re-run to resume.",
                )
                return 1
        print(f"[backfill] processed {_fmt_count(processed)} article(s)…")

    print(f"[backfill] ✓ done — {_fmt_count(processed)} embedding(s) persisted.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
