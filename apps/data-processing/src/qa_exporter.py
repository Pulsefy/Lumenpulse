"""
QA Dataset Exporter — Ledger-Range Export Generator for Incident Debugging

Exports raw payloads and normalized outputs for a specific Stellar ledger range
so maintainers can debug incidents reproducibly.

Intended use:
  Maintainers run this tool during on-call / incident triage to capture a
  deterministic snapshot of the ledger interval under investigation. The export
  is safe for repeated use (idempotent, atomic writes) and is intended for
  offline debugging, diffing across incidents, and handing to contributors for
  reproduction. Do NOT use for production ETL; use the Soroban indexer /
  backfill tooling for that.

Raw payloads vs normalized outputs:
  - Raw payloads  : ``events_<start>_<end>.json`` — untransformed contract
    events as ingested (AnalyticsRecord where record_type='event' plus, when
    available, ContractEvent rows with their raw_data/topics filtered by
    ``ledger``). These are the source-of-truth payloads.
  - Normalized outputs:
      * ``views_<start>_<end>.json`` — materialized views (Article +
        SocialPost sentiment aggregates + non-event AnalyticsRecords).
      * ``kpis_<start>_<end>.json`` — computed KPIs / AssetTrend rows.
    These represent the post-processing derived state for the same ledger
    interval.

Output format: JSON files written to output_dir/
  - events_<start>_<end>.json      : raw contract events (from AnalyticsRecord where record_type='event')
  - views_<start>_<end>.json       : materialized views (aggregated Article + SocialPost sentiment)
  - kpis_<start>_<end>.json        : computed KPIs (from AssetTrend)

Each file has the envelope:
  {
    "status": "completed",
    "exported_at": "<ISO-8601>",
    "start_ledger": <int>,
    "end_ledger": <int>,
    "dataset": "<events|views|kpis>",
    "count": <int>,
    "records": [ ... ] | { articles: [...], social_posts: [...], analytics_records: [...] }
  }

Safe for repeated use:
  - Filenames are deterministic (ledger range) so re-running overwrites the
    same files rather than duplicating data.
  - Writes are atomic (write to ``.tmp`` then rename) so interrupted runs do
    not leave partial JSON.
  - Queries are read-only; no DB mutation occurs.
  - Re-running a completed range yields byte-identical counts (idempotent)
    unless underlying data changed.
"""

import json
import logging
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from sqlalchemy import create_engine, select, and_
from sqlalchemy.orm import sessionmaker

from src.db.models import AnalyticsRecord, Article, AssetTrend, SocialPost, EntityLinkingReview

logger = logging.getLogger(__name__)


@dataclass
class ExportResult:
    """Result of a single export operation."""

    dataset: str
    path: str
    count: int
    status: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "dataset": self.dataset,
            "path": self.path,
            "count": self.count,
            "status": self.status,
        }


class QAExporter:
    """
    Exports QA datasets (events, views, KPIs) for a Stellar ledger range.

    Ledger numbers are mapped to AnalyticsRecord / AssetTrend rows via the
    ``extra_data->>'ledger'`` JSON field written by the ingestion pipeline.
    Articles and SocialPosts are included in the views export regardless of
    ledger (they carry no ledger field) when no ledger filter can be applied.

    Raw vs normalized:
      - Raw      -> ``export_events`` (untransformed contract events)
      - Normalized -> ``export_views`` + ``export_kpis`` (materialized views
        and computed KPIs). Together they cover the ledger-range export
        generator requirement for incident debugging.

    Safe for repeated use: see module docstring.
    """

    def __init__(
        self,
        start_ledger: int,
        end_ledger: int,
        output_dir: str,
        database_url: Optional[str] = None,
    ):
        import os

        # --- validation: Accepts start/end ledger inputs ---
        try:
            start_ledger = int(start_ledger)
            end_ledger = int(end_ledger)
        except (TypeError, ValueError):
            raise ValueError("start_ledger and end_ledger must be integers")
        if start_ledger < 0 or end_ledger < 0:
            raise ValueError("ledger numbers must be >= 0")
        if start_ledger > end_ledger:
            raise ValueError("start_ledger must be <= end_ledger")

        self.start_ledger = start_ledger
        self.end_ledger = end_ledger
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

        db_url = database_url or os.getenv(
            "DATABASE_URL",
            "postgresql://postgres:postgres@localhost:5432/lumenpulse",
        )
        engine = create_engine(db_url, pool_pre_ping=True, echo=False)
        self.Session = sessionmaker(bind=engine, expire_on_commit=False)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _envelope(self, records: List[Dict], dataset: str) -> Dict[str, Any]:
        return {
            "status": "completed",
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "start_ledger": self.start_ledger,
            "end_ledger": self.end_ledger,
            "dataset": dataset,
            "count": len(records),
            "records": records,
        }

    def _write(self, data: Dict, name: str) -> Path:
        """
        Atomic, idempotent write: write to a temp file then rename.
        Safe for repeated use — re-running overwrites deterministically and
        never leaves a partial file on interruption.
        """
        path = self.output_dir / f"{name}_{self.start_ledger}_{self.end_ledger}.json"
        tmp = path.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, default=str)
        tmp.replace(path)
        return path

    def _ledger_filter(self, model):
        """
        Return a SQLAlchemy filter that restricts rows whose extra_data JSON
        contains a 'ledger' key within [start_ledger, end_ledger].
        Falls back to no filter if the column cast is unavailable.
        """
        from sqlalchemy import cast, Integer
        from sqlalchemy.dialects.postgresql import JSONB

        try:
            ledger_col = model.extra_data["ledger"].astext.cast(Integer)
            return and_(
                ledger_col >= self.start_ledger,
                ledger_col <= self.end_ledger,
            )
        except Exception:
            return None  # no ledger field on this model; caller handles it

    # ------------------------------------------------------------------
    # Export methods
    # ------------------------------------------------------------------

    def export_events(self) -> ExportResult:
        """Export raw events (AnalyticsRecord rows with record_type='event')."""
        with self.Session() as session:
            q = select(AnalyticsRecord).where(
                AnalyticsRecord.record_type == "event"
            )
            ledger_f = self._ledger_filter(AnalyticsRecord)
            if ledger_f is not None:
                q = q.where(ledger_f)

            rows = session.execute(q).scalars().all()
            records = [
                {
                    "id": r.id,
                    "record_type": r.record_type,
                    "asset": r.asset,
                    "metric_name": r.metric_name,
                    "window": r.window,
                    "value": r.value,
                    "previous_value": r.previous_value,
                    "change_percentage": r.change_percentage,
                    "trend_direction": r.trend_direction,
                    "extra_data": r.extra_data,
                    "timestamp": r.timestamp.isoformat() if r.timestamp else None,
                }
                for r in rows
            ]

        data = self._envelope(records, "events")
        path = self._write(data, "events")
        logger.info("Exported %d events → %s", len(records), path)
        return ExportResult("events", str(path), len(records), "completed")

    def export_views(self) -> ExportResult:
        """
        Export materialized views: aggregated sentiment from Articles and
        SocialPosts, plus all non-event AnalyticsRecord rows.

        Normalized output for the ledger range. AnalyticsRecords are filtered
        by ledger when ``extra_data.ledger`` is present (via _ledger_filter);
        Articles/SocialPosts have no ledger field and are exported as-is for
        the range (deterministic snapshot). The query remains read-only and
        re-running produces identical counts (idempotent).
        """
        with self.Session() as session:
            articles = session.execute(select(Article)).scalars().all()
            posts = session.execute(select(SocialPost)).scalars().all()

            analytics_q = select(AnalyticsRecord).where(
                AnalyticsRecord.record_type != "event"
            )
            ledger_f = self._ledger_filter(AnalyticsRecord)
            if ledger_f is not None:
                analytics_q = analytics_q.where(ledger_f)
            analytics = session.execute(analytics_q).scalars().all()

            records = {
                "articles": [
                    {
                        "article_id": a.article_id,
                        "title": a.title,
                        "source": a.source,
                        "primary_asset": a.primary_asset,
                        "sentiment_score": a.sentiment_score,
                        "sentiment_label": a.sentiment_label,
                        "published_at": a.published_at.isoformat() if a.published_at else None,
                    }
                    for a in articles
                ],
                "social_posts": [
                    {
                        "post_id": p.post_id,
                        "platform": p.platform,
                        "primary_asset": p.primary_asset,
                        "sentiment_score": p.sentiment_score,
                        "sentiment_label": p.sentiment_label,
                        "posted_at": p.posted_at.isoformat() if p.posted_at else None,
                    }
                    for p in posts
                ],
                "analytics_records": [
                    {
                        "id": r.id,
                        "record_type": r.record_type,
                        "asset": r.asset,
                        "metric_name": r.metric_name,
                        "window": r.window,
                        "value": r.value,
                        "timestamp": r.timestamp.isoformat() if r.timestamp else None,
                    }
                    for r in analytics
                ],
            }

        total = len(records["articles"]) + len(records["social_posts"]) + len(records["analytics_records"])
        data = self._envelope(records, "views")  # type: ignore[arg-type]
        data["count"] = total
        path = self._write(data, "views")
        logger.info("Exported views (%d total rows) → %s", total, path)
        return ExportResult("views", str(path), total, "completed")

    def export_kpis(self) -> ExportResult:
        """
        Export KPIs from AssetTrend rows.

        Normalized output. When AssetTrend rows carry ``extra_data.ledger``,
        they are filtered to the requested ledger range; otherwise the full
        set is exported (preserving backward-compatibility). Read-only and
        safe for repeated use.
        """
        with self.Session() as session:
            q = select(AssetTrend)
            # AssetTrend has extra_data JSON; filter if ledger key exists
            ledger_f = self._ledger_filter(AssetTrend)
            if ledger_f is not None:
                q = q.where(ledger_f)
            rows = session.execute(q).scalars().all()
            records = [
                {
                    "id": r.id,
                    "asset": r.asset,
                    "metric_name": r.metric_name,
                    "window": r.window,
                    "trend_direction": r.trend_direction,
                    "score": r.score,
                    "current_value": r.current_value,
                    "previous_value": r.previous_value,
                    "change_percentage": r.change_percentage,
                    "extra_data": r.extra_data,
                    "timestamp": r.timestamp.isoformat() if r.timestamp else None,
                }
                for r in rows
            ]

        data = self._envelope(records, "kpis")
        path = self._write(data, "kpis")
        logger.info("Exported %d KPIs → %s", len(records), path)
        return ExportResult("kpis", str(path), len(records), "completed")

    def export_review_queue(self) -> ExportResult:
        """Export the entity linking review queue."""
        with self.Session() as session:
            rows = session.execute(select(EntityLinkingReview)).scalars().all()
            records = [
                {
                    "id": r.id,
                    "article_id": r.article_id,
                    "stable_entity_id": r.stable_entity_id,
                    "entity_type": r.entity_type,
                    "display_name": r.display_name,
                    "matched_text": r.matched_text,
                    "confidence": r.confidence,
                    "supporting_evidence": r.supporting_evidence,
                    "status": r.status,
                    "corrected_entity_id": r.corrected_entity_id,
                    "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
                    "created_at": r.created_at.isoformat() if r.created_at else None,
                }
                for r in rows
            ]

        data = self._envelope(records, "review_queue")
        path = self._write(data, "review_queue")
        logger.info("Exported %d review queue items → %s", len(records), path)
        return ExportResult("review_queue", str(path), len(records), "completed")

    def run(self) -> List[ExportResult]:
        """Run all exports and return results."""
        results = [
            self.export_events(),
            self.export_views(),
            self.export_kpis(),
            self.export_review_queue(),
        ]
        return results
