import logging
import pandas as pd
import numpy as np
from typing import Dict, Any, List, Optional
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LinearRegression
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_squared_error, r2_score

from src.ml.feature_schema import (
    PRICE_PREDICTOR_FEATURE_SET,
    check_serving_schema,
    current_feature_schema,
)

logger = logging.getLogger(__name__)

class PricePredictor:
    """
    A structured ML predictor for asset prices using scikit-learn pipelines.

    Each trained model records the *feature schema version* it was trained on
    (``training_schema_version``). At serving time ``predict`` compares that
    against the schema the serving pipeline is producing and refuses (strict)
    or loudly warns (default) on a mismatch, so a model is never silently
    served against features it never saw (#1239).
    """

    def __init__(
        self,
        model_name: str = "linear_regression",
        feature_set: str = PRICE_PREDICTOR_FEATURE_SET,
    ):
        self.model_name = model_name
        self.feature_set = feature_set
        self.pipeline = self._build_pipeline()
        self.is_trained = False
        self.metrics: Dict[str, float] = {}
        # Feature schema version this model was trained against. Recorded at
        # fit() time and consulted by predict(); None means "not yet trained /
        # legacy model" and disables the serving guard for that instance.
        self.training_schema_version: Optional[str] = None

    def _build_pipeline(self) -> Pipeline:
        """
        Builds the scikit-learn pipeline with scaling and a regressor.
        """
        return Pipeline([
            ('scaler', StandardScaler()),
            ('regressor', LinearRegression())
        ])

    def fit(
        self,
        data: pd.DataFrame,
        target_column: str = 'target',
        schema_version: Optional[str] = None,
        random_state: int = 42,
    ) -> Dict[str, float]:
        """
        Trains the model using the provided training data.

        Args:
            data: DataFrame containing features and the target column.
            target_column: The name of the column to predict.
            schema_version: Explicit feature schema version to record with the
                model. When omitted it is taken from the training frame's
                ``attrs['schema_version']`` (set by FeatureStore) and falls back
                to the current registered schema version.
            random_state: Seed for train/test split to ensure reproducibility.

        Returns:
            A dictionary containing training metrics.
        """
        if data.empty:
            raise ValueError("Training data is empty.")

        if target_column not in data.columns:
            raise ValueError(f"Target column '{target_column}' not found in data.")

        logger.info(f"Training PricePredictor model: {self.model_name}")

        X = data.drop(columns=[target_column])
        y = data[target_column]

        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=random_state)

        self.pipeline.fit(X_train, y_train)

        y_pred = self.pipeline.predict(X_test)
        self.metrics = {
            "mse": float(mean_squared_error(y_test, y_pred)),
            "r2": float(r2_score(y_test, y_pred))
        }

        # Record the feature schema version this model was trained against so
        # serving can detect train/serve schema skew later.
        self.training_schema_version = (
            schema_version
            or (data.attrs.get("schema_version") if hasattr(data, "attrs") else None)
            or current_feature_schema(self.feature_set).version
        )

        self.is_trained = True
        logger.info(
            f"Model trained successfully. Metrics: {self.metrics} "
            f"(feature_set={self.feature_set}, schema_version={self.training_schema_version})"
        )

        return self.metrics

    def predict(self, features: pd.DataFrame) -> np.ndarray:
        """
        Predicts the price based on input features.
        
        Args:
            features: DataFrame containing the features for prediction.
            
        Returns:
            Array of predicted values.
        """
        if not self.is_trained:
            raise RuntimeError("Model must be trained before calling predict.")

        if features.empty:
            return np.array([])

        # Guard against train/serve schema skew: if the features being served
        # were produced by a different schema version than the model trained
        # on, refuse (strict) or loudly warn (default). See feature_schema.py.
        serving_version = (
            features.attrs.get("schema_version") if hasattr(features, "attrs") else None
        )
        check_serving_schema(
            self.training_schema_version, serving_version, self.feature_set
        )

        logger.info(f"Predicting with model: {self.model_name}")
        return self.pipeline.predict(features)

    def get_metrics(self) -> Dict[str, float]:
        """
        Returns the metrics calculated during the last training session.
        """
        return self.metrics
