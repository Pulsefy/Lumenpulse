from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pandas as pd

from src.ml.feature_store import FeatureStore


class MemoryCache:
    def __init__(self):
        self.values = {}
        self.hits = 0

    def get(self, key):
        value = self.values.get(key)
        if value is not None:
            self.hits += 1
        return value

    def set(self, key, value):
        self.values[key] = value
        return True


def test_warm_serving_cache_matches_uncached_training_features():
    end_time = datetime(2025, 1, 15, 12, tzinfo=timezone.utc)
    start_time = end_time - timedelta(hours=24)
    timestamps = [end_time - timedelta(hours=2), end_time - timedelta(hours=1)]
    source_data = {
        "sentiment": pd.DataFrame(
            {"timestamp": timestamps, "sentiment_score": [0.42, 0.77]}
        ),
        "volume": pd.DataFrame(
            {"timestamp": timestamps, "volume": [1234.5, 987.25]}
        ),
        "volatility": pd.DataFrame(
            {"timestamp": timestamps, "volatility": [0.011, 0.033]}
        ),
    }

    def read_source(query, _connection, params=None):
        assert params["asset"] == "BTC"
        assert params["start_time"] == start_time
        query_text = str(query).lower()
        for key, frame in source_data.items():
            if key in query_text:
                return frame.copy()
        raise AssertionError(f"unexpected feature query: {query_text}")

    session = MagicMock()
    session.connection.return_value = MagicMock()
    caches = {
        "sentiment_score": MemoryCache(),
        "volume": MemoryCache(),
        "volatility": MemoryCache(),
    }
    metrics = MagicMock()
    with patch("src.ml.feature_store.pd.read_sql", side_effect=read_source) as read_sql:
        store = FeatureStore(session, cache_managers=caches)
        with patch.object(store, "_parse_window_to_datetime", return_value=start_time):
            training_features = FeatureStore(
                session, cache_managers={}
            ).get_features_for_asset(
                "BTC", start_time=start_time, end_time=end_time
            )
            cold_serving_features = store.get_features_for_asset("BTC", window="24h")
            sql_calls_after_cold = read_sql.call_count

            with patch(
                "src.ml.feature_store.FEATURE_STORE_LOOKUP_SECONDS", metrics
            ):
                warm_serving_features = store.get_features_for_asset(
                    "BTC", window="24h"
                )

    pd.testing.assert_frame_equal(training_features, warm_serving_features)
    pd.testing.assert_frame_equal(cold_serving_features, warm_serving_features)
    assert training_features.attrs == warm_serving_features.attrs
    assert cold_serving_features.attrs == warm_serving_features.attrs
    assert read_sql.call_count == sql_calls_after_cold