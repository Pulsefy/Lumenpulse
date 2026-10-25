from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pandas as pd

from src.ml.feature_backfill import run_feature_backfill
from src.pipeline_run_registry import OUTCOME_SUCCESS, PipelineRunRegistry


def test_backfill_commits_chunks_and_records_registry_progress(tmp_path):
    session = MagicMock()
    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    end = start + timedelta(days=3)

    def execute(statement, _params=None):
        result = MagicMock()
        if "SELECT next_start_time" in str(statement):
            result.one.return_value = SimpleNamespace(
                next_start_time=start, rows_processed=0
            )
        return result

    session.execute.side_effect = execute
    registry = PipelineRunRegistry(path=str(tmp_path / "runs.json"))
    with patch("src.ml.feature_backfill.FeatureStore") as store_class:
        store = store_class.return_value

        def compute(_asset, start_time, end_time, **_kwargs):
            timestamp = start_time + timedelta(hours=1)
            if timestamp > end_time:
                return pd.DataFrame(
                    columns=["timestamp", "sentiment_score", "volume", "volatility"]
                )
            return pd.DataFrame(
                {
                    "timestamp": [timestamp],
                    "sentiment_score": [0.5],
                    "volume": [100.0],
                    "volatility": [0.02],
                }
            )

        store.get_features_for_asset.side_effect = compute
        result = run_feature_backfill(
            session,
            asset="XLM",
            feature="volume",
            start_time=start,
            end_time=end,
            chunk_days=1,
            registry=registry,
        )

    assert result["rows_processed"] == 3
    assert store.get_features_for_asset.call_count == 3
    assert session.commit.call_count == 4
    run = registry.get_runs()[f"feature_backfill:{result['backfill_id']}"]
    assert run["outcome"] == OUTCOME_SUCCESS
    assert run["progress"]["rows_processed"] == 3
