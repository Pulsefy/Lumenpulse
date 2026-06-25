#!/usr/bin/env python3
"""
Synthetic dataset generator for LumenPulse data processing.

Usage:
    python scripts/generate_synthetic_data.py --seed 42 --project-count 10 \
        --contributors-per-project 8 --articles 120 --social-posts 80 \
        --analytics-records 60 --contract-events 40 --output-dir data/synthetic

    python scripts/generate_synthetic_data.py --save-to-db
"""

import argparse
import json
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT_DIR = SCRIPT_DIR.parent
SRC_DIR = ROOT_DIR / "src"

sys.path.insert(0, str(SRC_DIR))

SYNTHETIC_SOURCE = "SyntheticDataGenerator"
ASSET_CANDIDATES = [
    {"symbol": "XLM", "asset_code": "XLM", "name": "Stellar", "categories": ["payments", "layer1"]},
    {"symbol": "BTC", "asset_code": "BTC", "name": "Bitcoin", "categories": ["store-of-value", "layer1"]},
    {"symbol": "ETH", "asset_code": "ETH", "name": "Ethereum", "categories": ["smart-contracts", "layer1"]},
    {"symbol": "SOL", "asset_code": "SOL", "name": "Solana", "categories": ["smart-contracts", "layer1"]},
    {"symbol": "ADA", "asset_code": "ADA", "name": "Cardano", "categories": ["smart-contracts", "layer1"]},
    {"symbol": "DOT", "asset_code": "DOT", "name": "Polkadot", "categories": ["interoperability", "layer1"]},
]
PROJECT_STATUSES = ["active", "funding", "completed", "pending"]
EVENT_TYPES = ["contribution", "reward_granted", "milestone_approved", "submission_minted"]
SOCIAL_PLATFORMS = ["twitter", "reddit"]
TREND_WINDOWS = ["1h", "24h", "7d"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate repeatable synthetic datasets for LumenPulse dashboards and APIs."
    )
    parser.add_argument("--seed", type=int, default=42, help="Random seed for repeatable data")
    parser.add_argument("--project-count", type=int, default=8, help="Number of synthetic projects to create")
    parser.add_argument(
        "--contributors-per-project",
        type=int,
        default=6,
        help="Average number of unique contributors per synthetic project",
    )
    parser.add_argument("--milestones-per-project", type=int, default=3, help="Number of milestones per synthetic project")
    parser.add_argument("--articles", type=int, default=80, help="Number of synthetic articles to generate")
    parser.add_argument("--social-posts", type=int, default=80, help="Number of synthetic social posts to generate")
    parser.add_argument("--analytics-records", type=int, default=50, help="Number of synthetic analytics records to generate")
    parser.add_argument("--contract-events", type=int, default=50, help="Number of synthetic contract events to generate")
    parser.add_argument("--output-dir", default="data/synthetic", help="Directory to write synthetic JSON data files")
    parser.add_argument(
        "--save-to-db",
        action="store_true",
        help="Persist generated synthetic data into the configured PostgreSQL database",
    )
    parser.add_argument(
        "--create-tables",
        action="store_true",
        help="Create database tables before saving synthetic data",
    )
    return parser.parse_args()


def deterministic_stellar_address(index: int) -> str:
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
    random.seed(index)
    address = "G" + "".join(random.choices(alphabet, k=55))
    return address


def project_name_for_id(project_id: int) -> str:
    return f"PulseProject {project_id}"


def project_slug_for_id(project_id: int) -> str:
    return f"pulse-project-{project_id}"


def contract_id_for_project(project_id: int) -> str:
    return f"CONTRACT_{project_id:05d}"


def build_projects(project_count: int) -> List[Dict[str, Any]]:
    projects: List[Dict[str, Any]] = []
    for idx in range(1, project_count + 1):
        base_asset = ASSET_CANDIDATES[(idx - 1) % len(ASSET_CANDIDATES)]
        projects.append(
            {
                "project_id": 10000 + idx,
                "contract_id": contract_id_for_project(10000 + idx),
                "owner": deterministic_stellar_address(10000 + idx),
                "status": random.choice(PROJECT_STATUSES),
                "last_event_ledger": 200000 + idx,
                "extra_data": {
                    "name": project_name_for_id(idx),
                    "slug": project_slug_for_id(idx),
                    "symbol": base_asset["asset_code"],
                    "asset_code": base_asset["asset_code"],
                    "description": f"Synthetic project supporting {base_asset['name']} research and on-chain data.",
                    "aliases": [
                        base_asset["asset_code"].lower(),
                        project_slug_for_id(idx),
                    ],
                },
            }
        )
    return projects


def build_project_contributors(
    projects: List[Dict[str, Any]], contributors_per_project: int
) -> List[Dict[str, Any]]:
    contributors = []
    contribution_id = 1
    for project in projects:
        for idx in range(1, contributors_per_project + 1):
            contributors.append(
                {
                    "project_id": project["project_id"],
                    "contributor": deterministic_stellar_address(
                        project["project_id"] * 100 + idx
                    ),
                    "total_contributed": round(random.uniform(300.0, 6800.0), 2),
                    "first_contribution_ledger": project["last_event_ledger"] + contribution_id,
                    "last_contribution_ledger": project["last_event_ledger"] + contribution_id + 1,
                    "extra_data": {
                        "handle": f"contributor_{project['project_id']}_{idx}",
                    },
                }
            )
            contribution_id += 2
    return contributors


def build_project_views(
    projects: List[Dict[str, Any]], contributors: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    views: List[Dict[str, Any]] = []
    by_project = {}
    for contributor in contributors:
        by_project.setdefault(contributor["project_id"], []).append(contributor)

    for project in projects:
        assets = project["extra_data"]["asset_code"]
        project_contributors = by_project.get(project["project_id"], [])
        total = round(sum(c["total_contributed"] for c in project_contributors), 2)
        views.append(
            {
                "project_id": project["project_id"],
                "contract_id": project["contract_id"],
                "owner": project["owner"],
                "total_contributions": total,
                "unique_contributors": len(project_contributors),
                "status": project["status"],
                "last_event_ledger": project["last_event_ledger"],
                "extra_data": project["extra_data"],
            }
        )
    return views


def build_project_milestones(
    projects: List[Dict[str, Any]], milestones_per_project: int
) -> List[Dict[str, Any]]:
    milestones: List[Dict[str, Any]] = []
    for project in projects:
        for idx in range(1, milestones_per_project + 1):
            status = random.choice(["pending", "approved", "rejected"])
            approved_at = None
            if status == "approved":
                approved_at = (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 14))).isoformat()
            milestones.append(
                {
                    "project_id": project["project_id"],
                    "milestone_id": idx,
                    "status": status,
                    "approved_at": approved_at,
                    "last_event_ledger": project["last_event_ledger"] + idx,
                    "extra_data": {
                        "title": f"Milestone {idx} for {project['extra_data']['slug']}",
                        "description": f"Synthetic milestone measuring community adoption and technical progress.",
                    },
                }
            )
    return milestones


def build_contract_events(
    projects: List[Dict[str, Any]], contributors: List[Dict[str, Any]], contract_events: int
) -> List[Dict[str, Any]]:
    events: List[Dict[str, Any]] = []
    candidate_contributors = contributors or []
    for idx in range(1, contract_events + 1):
        project = random.choice(projects)
        contributor = random.choice(candidate_contributors)
        event_type = random.choice(EVENT_TYPES)
        amount = round(random.uniform(20.0, 2000.0), 2)
        status = "completed" if event_type != "milestone_approved" else random.choice(["approved", "pending"])
        events.append(
            {
                "contract_id": project["contract_id"],
                "event_id": f"synthetic_event_{idx:05d}",
                "ledger": project["last_event_ledger"] + idx,
                "event_type": event_type,
                "project_id": project["project_id"],
                "contributor": contributor["contributor"],
                "amount": amount,
                "milestone_id": random.randint(1, 3),
                "status": status,
                "topics": [project["extra_data"]["asset_code"], event_type],
                "raw_data": {
                    "summary": f"Synthetic {event_type} event for {project['extra_data']['slug']}",
                    "details": {
                        "contribution_reason": "stress test data generation",
                        "metric": random.choice(["velocity", "growth", "engagement"]),
                    },
                },
                "timestamp": (datetime.now(timezone.utc) - timedelta(hours=random.randint(0, 96))).isoformat(),
            }
        )
    return events


def build_articles(projects: List[Dict[str, Any]], total_articles: int) -> List[Dict[str, Any]]:
    articles: List[Dict[str, Any]] = []
    sentences = [
        "Market momentum is shifting as traders digest the latest on-chain activity.",
        "Community sentiment remains upbeat after the most recent protocol upgrade.",
        "Developers are closely watching liquidity metrics and reward incentives.",
        "New wallet inflows signal investor interest ahead of the next governance vote.",
        "Synthetic analysis shows a stable trend in asset performance this week.",
    ]

    for idx in range(1, total_articles + 1):
        project = random.choice(projects)
        published_delta = random.randint(0, 14)
        published_at = (datetime.now(timezone.utc) - timedelta(days=published_delta, hours=random.randint(0, 23))).isoformat()
        sentiment_score = round(random.uniform(-1.0, 1.0), 3)
        label = "positive" if sentiment_score > 0.2 else "negative" if sentiment_score < -0.2 else "neutral"
        symbol = project["extra_data"]["asset_code"]
        articles.append(
            {
                "article_id": f"synthetic_article_{idx:05d}",
                "title": f"{project['extra_data']['name']} Update: {sentences[idx % len(sentences)]}",
                "content": f"{sentences[idx % len(sentences)]} This synthetic article is designed for local development and stress testing.",
                "summary": f"Synthetic news item about {symbol} and community contributions.",
                "source": SYNTHETIC_SOURCE,
                "url": f"https://synthetic.lumenpulse.dev/article/{idx:05d}",
                "asset_codes": [symbol],
                "primary_asset": symbol,
                "categories": ["synthetic", "news", "crypto"],
                "sentiment_score": sentiment_score,
                "positive_score": round(max(0.0, sentiment_score), 3),
                "negative_score": round(max(0.0, -sentiment_score), 3),
                "neutral_score": round(1.0 - abs(sentiment_score), 3),
                "sentiment_label": label,
                "keywords": [symbol, "synthetic", "portfolio"],
                "detected_entities": [symbol, project["extra_data"]["name"]],
                "onchain_entity_links": [
                    {
                        "stable_entity_id": f"project:{project['project_id']}",
                        "entity_type": "project",
                        "display_name": project["extra_data"]["name"],
                        "matched_text": project["extra_data"]["name"],
                        "confidence": 0.95,
                        "source": SYNTHETIC_SOURCE,
                        "asset_code": symbol,
                        "project_id": project["project_id"],
                        "contract_id": project["contract_id"],
                    }
                ],
                "language": "en",
                "published_at": published_at,
                "fetched_at": datetime.now(timezone.utc).isoformat(),
                "analyzed_at": datetime.now(timezone.utc).isoformat(),
            }
        )
    return articles


def build_social_posts(projects: List[Dict[str, Any]], total_posts: int) -> List[Dict[str, Any]]:
    posts: List[Dict[str, Any]] = []
    messages = [
        "Community reward mechanics are moving ahead.",
        "Users are discussing projected staking yields.",
        "A new dApp proposal is driving positive momentum.",
        "A governance update could improve network utility.",
        "A liability risk signal is drawing analyst attention.",
    ]

    for idx in range(1, total_posts + 1):
        project = random.choice(projects)
        posted_at = (datetime.now(timezone.utc) - timedelta(hours=random.randint(1, 120))).isoformat()
        sentiment_score = round(random.uniform(-1.0, 1.0), 3)
        label = "positive" if sentiment_score > 0.2 else "negative" if sentiment_score < -0.2 else "neutral"
        platform = random.choice(SOCIAL_PLATFORMS)
        symbol = project["extra_data"]["asset_code"]
        posts.append(
            {
                "post_id": f"synthetic_post_{idx:05d}",
                "platform": platform,
                "content": f"{messages[idx % len(messages)]} #{symbol} #LumenPulse",
                "author": f"synthetic_user_{idx}",
                "url": f"https://synthetic.social/{platform}/{idx:05d}",
                "likes": random.randint(0, 1500),
                "comments": random.randint(0, 200),
                "shares": random.randint(0, 500),
                "asset_codes": [symbol],
                "primary_asset": symbol,
                "hashtags": [symbol, "LumenPulse", "synthetic"],
                "sentiment_score": sentiment_score,
                "positive_score": round(max(0.0, sentiment_score), 3),
                "negative_score": round(max(0.0, -sentiment_score), 3),
                "neutral_score": round(1.0 - abs(sentiment_score), 3),
                "sentiment_label": label,
                "posted_at": posted_at,
                "fetched_at": datetime.now(timezone.utc).isoformat(),
                "analyzed_at": datetime.now(timezone.utc).isoformat(),
            }
        )
    return posts


def build_analytics_records(projects: List[Dict[str, Any]], total_records: int) -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    metric_names = ["sentiment_score", "volume", "price_change", "engagement"]
    for idx in range(1, total_records + 1):
        project = random.choice(projects)
        asset = project["extra_data"]["asset_code"]
        current_value = round(random.uniform(0.1, 98.0), 3)
        previous_value = round(current_value * random.uniform(0.8, 1.2), 3)
        change = round(((current_value - previous_value) / max(previous_value, 1e-6)) * 100.0, 2)
        if change > 2:
            trend_direction = "up"
        elif change < -2:
            trend_direction = "down"
        else:
            trend_direction = "stable"
        records.append(
            {
                "record_type": random.choice(["sentiment_summary", "trend", "volume_snapshot"]),
                "asset": asset,
                "metric_name": random.choice(metric_names),
                "window": random.choice(TREND_WINDOWS),
                "value": current_value,
                "previous_value": previous_value,
                "change_percentage": change,
                "trend_direction": trend_direction,
                "extra_data": {
                    "source": SYNTHETIC_SOURCE,
                    "project_slug": project["extra_data"]["slug"],
                },
                "timestamp": (datetime.now(timezone.utc) - timedelta(minutes=random.randint(0, 360))).isoformat(),
            }
        )
    return records


def dump_json(data: List[Dict[str, Any]], output_dir: Path, filename: str) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    file_path = output_dir / filename
    with file_path.open("w", encoding="utf-8") as file_handle:
        json.dump(data, file_handle, indent=2, default=str)
    print(f"Wrote {len(data)} records to {file_path}")


def write_all(output_dir: Path, dataset: Dict[str, List[Dict[str, Any]]]) -> None:
    for filename, payload in dataset.items():
        dump_json(payload, output_dir, filename)


def instantiate_model(model_cls: Any, payload: Dict[str, Any]) -> Any:
    return model_cls(**payload)


def save_dataset_to_db(dataset: Dict[str, List[Dict[str, Any]]], create_tables: bool = False) -> None:
    try:
        from src.db.models import (
            AnalyticsRecord,
            Article,
            ContractEvent,
            ProjectContributor,
            ProjectMilestone,
            ProjectView,
            SocialPost,
        )
        from src.db.postgres_service import PostgresService
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "Cannot persist synthetic data because database dependencies are missing. "
            "Install requirements and ensure SQLAlchemy/psycopg2 are available."
        ) from exc

    db_service = PostgresService()
    if create_tables:
        db_service.create_tables()
    with db_service.get_session() as session:
        mapping = {
            "projects.json": ProjectView,
            "project_contributors.json": ProjectContributor,
            "project_milestones.json": ProjectMilestone,
            "articles.json": Article,
            "social_posts.json": SocialPost,
            "analytics_records.json": AnalyticsRecord,
            "contract_events.json": ContractEvent,
        }
        for file_name, rows in dataset.items():
            model_cls = mapping.get(file_name)
            if not model_cls:
                continue
            objects = [instantiate_model(model_cls, row) for row in rows]
            session.add_all(objects)
            print(f"Persisted {len(objects)} {model_cls.__name__} records")


def main() -> int:
    args = parse_args()
    random.seed(args.seed)

    print("Generating synthetic dataset with seed", args.seed)
    projects = build_projects(args.project_count)
    contributors = build_project_contributors(projects, args.contributors_per_project)
    project_views = build_project_views(projects, contributors)
    milestones = build_project_milestones(projects, args.milestones_per_project)
    articles = build_articles(projects, args.articles)
    social_posts = build_social_posts(projects, args.social_posts)
    analytics_records = build_analytics_records(projects, args.analytics_records)
    contract_events = build_contract_events(projects, contributors, args.contract_events)

    output_dir = Path(args.output_dir)
    dataset = {
        "projects.json": project_views,
        "project_contributors.json": contributors,
        "project_milestones.json": milestones,
        "articles.json": articles,
        "social_posts.json": social_posts,
        "analytics_records.json": analytics_records,
        "contract_events.json": contract_events,
    }

    write_all(output_dir, dataset)

    if args.save_to_db:
        print("Saving synthetic data to PostgreSQL database...")
        save_dataset_to_db(dataset, create_tables=args.create_tables)
        print("Synthetic data persisted to database")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
