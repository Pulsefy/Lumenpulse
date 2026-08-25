import json
import random
from pathlib import Path

from scripts.generate_synthetic_data import (
    build_articles,
    build_contract_events,
    build_project_contributors,
    build_project_milestones,
    build_project_views,
    build_projects,
    build_social_posts,
    build_analytics_records,
    dump_json,
)


def test_synthetic_generator_produces_repeatable_projects():
    random.seed(42)
    projects_a = build_projects(5)
    random.seed(42)
    projects_b = build_projects(5)

    assert projects_a == projects_b
    assert len(projects_a) == 5
    assert projects_a[0]["project_id"] == 10001


def test_synthetic_generator_writes_json_files(tmp_path: Path):
    random.seed(42)
    projects = build_projects(2)
    contributors = build_project_contributors(projects, 2)
    views = build_project_views(projects, contributors)
    articles = build_articles(projects, 3)
    social_posts = build_social_posts(projects, 2)
    analytics_records = build_analytics_records(projects, 2)
    milestones = build_project_milestones(projects, 1)
    contract_events = build_contract_events(projects, contributors, 2)

    output_dir = tmp_path / "synthetic"
    dump_json(projects, output_dir, "projects.json")
    dump_json(views, output_dir, "project_views.json")
    dump_json(articles, output_dir, "articles.json")
    dump_json(social_posts, output_dir, "social_posts.json")
    dump_json(analytics_records, output_dir, "analytics_records.json")
    dump_json(milestones, output_dir, "project_milestones.json")
    dump_json(contract_events, output_dir, "contract_events.json")

    files = list(output_dir.glob("*.json"))
    assert len(files) == 7
    loaded = json.loads((output_dir / "projects.json").read_text(encoding="utf-8"))
    assert loaded[0]["project_id"] == 10001
