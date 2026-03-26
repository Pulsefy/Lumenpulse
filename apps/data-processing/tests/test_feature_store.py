import pytest
import pandas as pd
from unittest.mock import MagicMock, patch
from datetime import datetime, timedelta, timezone

from src.ml.feature_store import FeatureStore

@pytest.fixture
def mock_db_session():
    """Fixture to provide a mocked SQLAlchemy session."""
    session = MagicMock()
    session.connection.return_value = MagicMock()
    return session

@patch('src.ml.feature_store.pd.read_sql')
def test_get_features_for_asset_success_btc(mock_read_sql, mock_db_session):
    """Test that features are correctly combined for an asset with full data."""
    now = datetime.now(timezone.utc)
    
    def mock_read_sql_side_effect(query, conn, params=None):
        query_str = str(query).lower()
        assert params['asset'] == 'BTC'
        
        if 'sentiment' in query_str:
            return pd.DataFrame({
                'timestamp': [now - timedelta(hours=2), now - timedelta(hours=1)],
                'sentiment_score': [0.5, 0.8]
            })
        elif 'volume' in query_str:
            return pd.DataFrame({
                'timestamp': [now - timedelta(hours=2), now - timedelta(hours=1)],
                'volume': [1500.0, 2000.5]
            })
        elif 'volatility' in query_str:
            return pd.DataFrame({
                'timestamp': [now - timedelta(hours=2), now - timedelta(hours=1)],
                'volatility': [0.02, 0.05]
            })
        return pd.DataFrame()

    mock_read_sql.side_effect = mock_read_sql_side_effect
    
    store = FeatureStore(mock_db_session)
    df = store.get_features_for_asset('BTC', '24h')
    
    assert not df.empty
    assert len(df) == 2
    assert list(df.columns) == ['timestamp', 'sentiment_score', 'volume', 'volatility']
    assert df.iloc[1]['sentiment_score'] == 0.8
    assert df.iloc[1]['volatility'] == 0.05

@patch('src.ml.feature_store.pd.read_sql')
def test_get_features_missing_data_eth(mock_read_sql, mock_db_session):
    """Test behavior when an asset is missing some metric (e.g., no volatility data)."""
    now = datetime.now(timezone.utc)
    
    def mock_read_sql_side_effect(query, conn, params=None):
        query_str = str(query).lower()
        assert params['asset'] == 'ETH'
        
        if 'sentiment' in query_str:
            return pd.DataFrame({
                'timestamp': [now - timedelta(days=1)],
                'sentiment_score': [0.6]
            })
        elif 'volume' in query_str:
            return pd.DataFrame({
                'timestamp': [now - timedelta(days=1)],
                'volume': [5000.0]
            })
        elif 'volatility' in query_str:
            return pd.DataFrame(columns=['timestamp', 'volatility'])
            
        return pd.DataFrame()

    mock_read_sql.side_effect = mock_read_sql_side_effect
    
    store = FeatureStore(mock_db_session)
    df = store.get_features_for_asset('ETH', '7d')
    
    assert not df.empty
    assert 'volatility' in df.columns
    assert df.iloc[0]['volatility'] == 0.0 

@patch('src.ml.feature_store.pd.read_sql')
def test_get_features_completely_empty(mock_read_sql, mock_db_session):
    """Test behavior when an obscure asset has absolutely no data."""
    mock_read_sql.return_value = pd.DataFrame()
    
    store = FeatureStore(mock_db_session)
    df = store.get_features_for_asset('UNKNOWN_TOKEN', '24h')
    
    # Should safely return an empty dataframe without breaking
    assert df.empty

def test_invalid_window_format(mock_db_session):
    """Test that passing an invalid window throws the appropriate error."""
    store = FeatureStore(mock_db_session)
    with pytest.raises(ValueError, match="Unsupported window format"):
        store.get_features_for_asset('BTC', '1w')