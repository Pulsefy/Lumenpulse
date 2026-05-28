"""
QA Dataset Exporter

Exports raw events, materialized views, and KPIs for a given Stellar ledger range.
Intended for QA engineers and contributor debugging.

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
    "count": <int>,
    "records": [ ... ]
  }
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

from src.db.models import AnalyticsRecord, Article, AssetTrend, SocialPost

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
    """

    def __init__(
        self,
        start_ledger: int,
        end_ledger: int,
        output_dir: str,
        database_url: Optional[str] = None,
    ):
        import os

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
        path = self.output_dir / f"{name}_{self.start_ledger}_{self.end_ledger}.json"
        with open(path, "w") as f:
            json.dump(data, f, indent=2, default=str)
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
        """
        with self.Session() as session:
            articles = session.execute(select(Article)).scalars().all()
            posts = session.execute(select(SocialPost)).scalars().all()

            analytics_q = select(AnalyticsRecord).where(
                AnalyticsRecord.record_type != "event"
            )
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
        """Export KPIs from AssetTrend rows within the ledger range."""
        with self.Session() as session:
            rows = session.execute(select(AssetTrend)).scalars().all()
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

    def run(self) -> List[ExportResult]:
        """Run all three exports and return results."""
        results = [
            self.export_events(),
            self.export_views(),
            self.export_kpis(),
        ]
        return results
