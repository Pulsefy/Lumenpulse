#! /usr/bin/env python3
"""
Configuration module for anomaly detection settings.
Supports both Z-score and Isolation Forest configurations.
"""

from dataclasses import dataclass
import json
from typing import Optional
import os


@dataclass
class ZScoreConfig:
    """Configuration for Z-score based anomaly detection."""

    window_size_hours: int = 24
    z_threshold: float = 2.5
    min_data_points: int = 10

    @classmethod
    def from_dict(cls, data: dict) -> 'ZScoreConfig':
        return cls(
            window_size_hours=data.get('window_size_hours', 24),
            z_threshold=data.get('z_threshold', 2.5),
            min_data_points=data.get('min_data_points', 10)
        )


@dataclass
class IsolationForestConfig:
    """Configuration for Isolation Forest based anomaly detection."""

    enabled: bool = True
    contamination: float = 0.1  # Expected proportion of anomalies (0.0 to 0.5)
    n_estimators: int = 100
    max_samples: str = 'auto'
    random_state: int = 42
    min_training_samples: int = 50
    auto_retrain_interval: int = 200  # Retrain every N new samples
    features: list = None  # Features to use for detection

    def __post_init__(self):
        if self.features is None:
            self.features = ['volume', 'sentiment', 'volume_change_rate', 'sentiment_change_rate']

    @classmethod
    def from_dict(cls, data: dict) -> 'IsolationForestConfig':
        return cls(
            enabled=data.get('enabled', True),
            contamination=data.get('contamination', 0.1),
            n_estimators=data.get('n_estimators', 100),
            max_samples=data.get('max_samples', 'auto'),
            random_state=data.get('random_state', 42),
            min_training_samples=data.get('min_training_samples', 50),
            auto_retrain_interval=data.get('auto_retrain_interval', 200),
            features=data.get('features', ['volume', 'sentiment', 'volume_change_rate', 'sentiment_change_rate'])
        )


@dataclass
class AnomalyDetectionConfig:
    """Main configuration for anomaly detection system."""

    zscore: ZScoreConfig
    isolation_forest: IsolationForestConfig
    enable_comparison_mode: bool = False
    model_save_path: str = "models/anomaly_detector"

    @classmethod
    def from_dict(cls, data: dict) -> 'AnomalyDetectionConfig':
        return cls(
            zscore=ZScoreConfig.from_dict(data.get('zscore', {})),
            isolation_forest=IsolationForestConfig.from_dict(data.get('isolation_forest', {})),
            enable_comparison_mode=data.get('enable_comparison_mode', False),
            model_save_path=data.get('model_save_path', "models/anomaly_detector")
        )

    @classmethod
    def from_env(cls) -> 'AnomalyDetectionConfig':
        """Load configuration from environment variables."""
        config = {
            'zscore': {
                'window_size_hours': int(os.getenv('ANOMALY_WINDOW_HOURS', '24')),
                'z_threshold': float(os.getenv('ANOMALY_Z_THRESHOLD', '2.5')),
            },
            'isolation_forest': {
                'enabled': os.getenv('ANOMALY_ML_ENABLED', 'true').lower() == 'true',
                'contamination': float(os.getenv('ANOMALY_ML_CONTAMINATION', '0.1')),
                'n_estimators': int(os.getenv('ANOMALY_ML_ESTIMATORS', '100')),
            },
            'enable_comparison_mode': os.getenv('ANOMALY_COMPARISON_MODE', 'false').lower() == 'true',
            'model_save_path': os.getenv('ANOMALY_MODEL_PATH', 'models/anomaly_detector')
        }
        return cls.from_dict(config)

    def save_to_file(self, filepath: str):
        """Save configuration to JSON file."""
        with open(filepath, 'w') as f:
            json.dump({
                'zscore': self.zscore.__dict__,
                'isolation_forest': self.isolation_forest.__dict__,
                'enable_comparison_mode': self.enable_comparison_mode,
                'model_save_path': self.model_save_path
            }, f, indent=2)

    @classmethod
    def load_from_file(cls, filepath: str) -> 'AnomalyDetectionConfig':
        """Load configuration from JSON file."""
        if os.path.exists(filepath):
            with open(filepath, 'r') as f:
                data = json.load(f)
            return cls.from_dict(data)
        return cls.from_env()
