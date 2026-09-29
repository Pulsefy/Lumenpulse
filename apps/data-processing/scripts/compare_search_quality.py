#!/usr/bin/env python3
"""
compare_search_quality.py — semantic vs keyword retrieval quality (#1455).

Ranks a sample of embedded news articles with both the semantic (cosine) path
and the legacy keyword path for a set of queries, and reports ranking-aware
metrics (precision@k, recall@k, nDCG@k, RBO vs keyword baseline, new-hits
share) per query and aggregated. Writes a JSON report so the numbers are
comparable across model uploads and can be surfaced in CI.

Usage
-----
    python scripts/compare_search_quality.py --sample-size 200
    python scripts/compare_search_quality.py --sample-size 500 --out bench.json
    python scripts/compare_search_quality.py --queries "Stellar upgrade|Soroban"

Exit codes
----------
0  report produced
2  environment error (model not vendored, no embeddings, or bad queries)
"""

import argparse
import json
import os
import sys
from typing import Any, Dict, List, Optional

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.analytics.embedding_service import (  # noqa: E402
    EmbeddingService,
    MissingEmbeddingModelError,
    check_model_available,
    cosine_similarity,
)
from src.analytics.search_quality import (  # noqa: E402
    SearchQualityReport,
    keyword_score,
    search_quality_report,
    summarize,
)
from src.config.embedding_config import EmbeddingConfig  # noqa: E402
from src.db import PostgresService  # noqa: E402

_DEFAULT_QUERIES = [
    "Stellar Soroban smart contract upgrade",
    "XLM payment network adoption",
    "crypto market sentiment outlook",
    "on-chain project developer activity",
    "regulatory news affecting digital assets",
]


def _fmt(value: float) -> str:
    return f"{value:.4f}"


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--queries",
        default=None,
        help="Pipe-separated queries (defaults to a curated sample set).",
    )
    parser.add_argument(
        "--sample-size", type=int, default=200, help="Embedded articles to rank."
    )
    parser.add_argument("--dsn", default=None, help="Optional DATABASE_URL override.")
    parser.add_argument("--out", default=None, help="Optional JSON report output path.")
    args = parser.parse_args(argv)

    cfg = EmbeddingConfig.from_env()
    try:
        check_model_available(cfg)
    except MissingEmbeddingModelError as exc:
        print(f"[quality] ✗ {exc}", file=sys.stderr)
        return 2

    queries = [
        query.strip()
        for query in (args.queries or "|".join(_DEFAULT_QUERIES)).split("|")
        if query.strip()
    ]
    if not queries:
        print("[quality] no queries provided", file=sys.stderr)
        return 2

    svc = EmbeddingService(cfg=cfg)
    db = PostgresService(database_url=args.dsn) if args.dsn else PostgresService()

    corpus = db.get_embedded_articles(
        model_version=cfg.model_version, limit=args.sample_size
    )
    if not corpus:
        print(
            "[quality] ✗ no embedded articles found; run "
            "scripts/backfill_embeddings.py first.",
            file=sys.stderr,
        )
        return 2

    print(
        f"[quality] comparing semantic vs keyword over {len(corpus)} "
        f"embedded articles ({cfg.shipped_version_tag})"
    )

    reports: List[SearchQualityReport] = []
    for query in queries:
        query_vector = svc.embed(query)
        semantic_scores: List[float] = []
        keyword_scores: List[float] = []
        article_ids: List[str] = []
        for item in corpus:
            article_ids.append(item["article_id"])
            semantic_scores.append(cosine_similarity(query_vector, item["embedding"]))
            keyword_scores.append(
                keyword_score(
                    query,
                    " ".join(
                        filter(
                            None,
                            [
                                item.get("title"),
                                item.get("summary"),
                                item.get("content"),
                            ],
                        )
                    ),
                )
            )
        report = search_quality_report(
            query,
            semantic_scores=semantic_scores,
            keyword_scores=keyword_scores,
            article_ids=article_ids,
            model_version=cfg.shipped_version_tag,
        )
        reports.append(report)
        print(
            f"  {query!r}: ndcg@10={_fmt(report.ndcg_at_10)} "
            f"rbo_vs_keyword={_fmt(report.rbo_vs_keyword)} "
            f"new_hits_share={_fmt(report.new_hits_share)}"
        )

    summary = summarize(reports)
    print(f"[quality] summary (n={summary.get('queries')})")
    for key, value in summary.items():
        print(f"  {key}: {value}")

    if args.out:
        payload: Dict[str, Any] = {
            "model_name": cfg.model_name,
            "model_version": cfg.model_version,
            "sample_size": len(corpus),
            "summary": summary,
            "queries": [report.to_dict() for report in reports],
        }
        with open(args.out, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
        print(f"[quality] report written to {args.out}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
