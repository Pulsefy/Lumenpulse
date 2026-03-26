import pandas as pd
from sqlalchemy.orm import Session
from sqlalchemy import text
from datetime import datetime, timedelta, timezone

class FeatureStore:
    def __init__(self, db_session: Session):
        """
        Initialize the FeatureStore with a SQLAlchemy database session.
        """
        self.db = db_session

    def _parse_window_to_datetime(self, window: str) -> datetime:
        """Helper to parse window strings like '24h' or '7d' into a past timestamp."""
        # Fix deprecation warning by using timezone-aware UTC datetime
        now = datetime.now(timezone.utc)
        if window.endswith('h'):
            return now - timedelta(hours=int(window[:-1]))
        elif window.endswith('d'):
            return now - timedelta(days=int(window[:-1]))
        else:
            raise ValueError("Unsupported window format. Use 'h' (hours) or 'd' (days).")

    def _ensure_columns(self, df: pd.DataFrame, expected_col: str) -> pd.DataFrame:
        """Ensures the DataFrame has the correct base columns, even if it's completely empty."""
        if 'timestamp' not in df.columns:
            df['timestamp'] = pd.Series(dtype='datetime64[ns]')
        if expected_col not in df.columns:
            df[expected_col] = pd.Series(dtype='float64')
        return df

    def get_features_for_asset(self, asset: str, window: str) -> pd.DataFrame:
        """
        Retrieves and combines features for a specific asset over a given time window.
        Combines: Sentiment stats, Volume metrics, and Volatility indicators.
        """
        start_time = self._parse_window_to_datetime(window)
        
        sentiment_query = text("""
            SELECT timestamp, sentiment_score FROM asset_sentiment_view
            WHERE asset = :asset AND timestamp >= :start_time
        """)
        
        volume_query = text("""
            SELECT timestamp, volume FROM asset_volume_view
            WHERE asset = :asset AND timestamp >= :start_time
        """)
        
        volatility_query = text("""
            SELECT timestamp, volatility FROM asset_volatility_view
            WHERE asset = :asset AND timestamp >= :start_time
        """)

        conn = self.db.connection()
        try:
            params = {"asset": asset, "start_time": start_time}
            sentiment_df = pd.read_sql(sentiment_query, conn, params=params)
            volume_df = pd.read_sql(volume_query, conn, params=params)
            volatility_df = pd.read_sql(volatility_query, conn, params=params)
        except Exception:
            sentiment_df = pd.DataFrame()
            volume_df = pd.DataFrame()
            volatility_df = pd.DataFrame()

        # Ensure all dataframes have the right columns before merging
        sentiment_df = self._ensure_columns(sentiment_df, 'sentiment_score')
        volume_df = self._ensure_columns(volume_df, 'volume')
        volatility_df = self._ensure_columns(volatility_df, 'volatility')

        # Always merge using outer joins to align the time series and preserve column names
        features_df = pd.merge(sentiment_df, volume_df, on='timestamp', how='outer')
        features_df = pd.merge(features_df, volatility_df, on='timestamp', how='outer')

        # If no actual data exists, return the empty DataFrame (now with the correct headers)
        if features_df.empty:
            return features_df

        # Clean up the merged dataset (sort by time, forward fill missing values)
        features_df.sort_values('timestamp', inplace=True)
        features_df.ffill(inplace=True)
        features_df.fillna(0, inplace=True) # Fill remaining NaNs with 0

        return features_df