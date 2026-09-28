"""Issue #1446: online/offline feature parity.

``FeatureStore.get_features_for_asset`` is the single function both the
retraining pipeline (offline/training, via explicit ``start_time``/
``end_time``) and the feature-drift detector (online/serving, via a relative
``window``) call to build a model's feature frame. Nothing currently
guarantees these two calling conventions keep producing identical feature
vectors for the same underlying data as the code evolves -- this is exactly
the class of training/serving skew that makes a model score well offline and
misbehave live.

This test feeds both calling conventions the same underlying rows (by
freezing "now" so the window resolves to the same range explicit
start/end bounds cover) and asserts the resulting frames match feature by
feature, with an explicit floating-point tolerance.

No feature in ``FeatureStore`` is currently exempt from this parity
guarantee -- sentiment_score, volume, and volatility are all computed by the
same merge/sort/ffill/fillna pipeline regardless of calling convention. If a
future feature can't be computed identically online and offline, document
the reason directly above its assertion below instead of skipping it
silently.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from src.ml.feature_store import FeatureStore

# Explicit float tolerance for feature-parity comparisons: both paths run the
# exact same pandas transformations over the same input rows, so in practice
# we expect exact equality, but a tiny relative tolerance guards against
# nondeterministic floating-point summation order without silently accepting
# a real divergence.
FEATURE_PARITY_RTOL = 1e-9

FEATURE_COLUMNS = ["sentiment_score", "volume", "volatility"]


@pytest.fixture
def mock_db_session():
    session = MagicMock()
    session.connection.return_value = MagicMock()
    return session


def _fixed_rows(base_time: datetime) -> dict:
    """The same underlying rows returned regardless of which path queries them."""
    timestamps = [base_time - timedelta(hours=2), base_time - timedelta(hours=1)]
    return {
        "sentiment": pd.DataFrame({"timestamp": timestamps, "sentiment_score": [0.42, 0.77]}),
        "volume": pd.DataFrame({"timestamp": timestamps, "volume": [1234.5, 987.25]}),
        "volatility": pd.DataFrame({"timestamp": timestamps, "volatility": [0.011, 0.033]}),
    }


def _make_read_sql_side_effect(rows: dict, expected_start: datetime):
    def side_effect(query, conn, params=None):
        query_str = str(query).lower()
        assert params["asset"] == "BTC"
        assert params["start_time"] == expected_start
        if "sentiment" in query_str:
            return rows["sentiment"]
        if "volume" in query_str:
            return rows["volume"]
        if "volatility" in query_str:
            return rows["volatility"]
        return pd.DataFrame()

    return side_effect


def _assert_features_match(offline_df: pd.DataFrame, online_df: pd.DataFrame) -> None:
    """Column-by-column comparison that names the diverging feature on failure."""
    assert list(offline_df.columns) == list(online_df.columns), (
        f"Feature columns diverge between training and serving paths: "
        f"offline={list(offline_df.columns)} online={list(online_df.columns)}"
    )
    assert len(offline_df) == len(online_df), (
        f"Row count diverges between training ({len(offline_df)}) and "
        f"serving ({len(online_df)}) feature paths"
    )

    for feature in FEATURE_COLUMNS:
        offline_values = offline_df[feature].reset_index(drop=True)
        online_values = online_df[feature].reset_index(drop=True)
        mismatched = ~offline_values.sub(online_values).abs().le(
            FEATURE_PARITY_RTOL * offline_values.abs().clip(lower=1.0)
        )
        assert not mismatched.any(), (
            f"Feature '{feature}' diverges between training and serving paths at "
            f"row(s) {list(offline_values[mismatched].index)}: "
            f"offline={offline_values[mismatched].tolist()} "
            f"online={online_values[mismatched].tolist()}"
        )


@patch("src.ml.feature_store.pd.read_sql")
def test_training_and_serving_paths_produce_identical_features(mock_read_sql, mock_db_session):
    """Same asset, same effective time range, same underlying rows -> same feature frame."""
    end_time = datetime(2024, 1, 15, 12, 0, 0, tzinfo=timezone.utc)
    start_time = end_time - timedelta(hours=24)
    rows = _fixed_rows(end_time)

    # Offline/training path: retraining_pipeline.py's calling convention --
    # explicit start_time/end_time.
    mock_read_sql.side_effect = _make_read_sql_side_effect(rows, start_time)
    store = FeatureStore(mock_db_session)
    offline_df = store.get_features_for_asset(
        "BTC", window=None, start_time=start_time, end_time=end_time
    )

    # Online/serving path: feature_drift_detector.py's calling convention --
    # a relative window, resolved against "now". Freeze "now" to end_time so
    # the window covers the exact same range as the training call above.
    with patch("src.ml.feature_store.datetime") as mock_datetime:
        mock_datetime.now.return_value = end_time
        mock_datetime.side_effect = lambda *a, **kw: datetime(*a, **kw)
        online_df = store.get_features_for_asset("BTC", window="24h")

    _assert_features_match(offline_df, online_df)


@patch("src.ml.feature_store.pd.read_sql")
def test_feature_parity_check_actually_catches_a_real_divergence(mock_read_sql, mock_db_session):
    """Sanity check: the comparison above isn't vacuously true -- it fails on real skew."""
    end_time = datetime(2024, 1, 15, 12, 0, 0, tzinfo=timezone.utc)
    start_time = end_time - timedelta(hours=24)
    rows = _fixed_rows(end_time)

    mock_read_sql.side_effect = _make_read_sql_side_effect(rows, start_time)
    store = FeatureStore(mock_db_session)
    offline_df = store.get_features_for_asset(
        "BTC", window=None, start_time=start_time, end_time=end_time
    )

    online_df = offline_df.copy()
    online_df.loc[0, "sentiment_score"] = online_df.loc[0, "sentiment_score"] + 1.0

    with pytest.raises(AssertionError, match="sentiment_score"):
        _assert_features_match(offline_df, online_df)
