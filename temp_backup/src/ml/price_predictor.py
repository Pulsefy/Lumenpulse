import logging
import pandas as pd
import numpy as np
from typing import Dict, Any, List, Optional
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LinearRegression
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_squared_error, r2_score

logger = logging.getLogger(__name__)

class PricePredictor:
    """
    A structured ML predictor for asset prices using scikit-learn pipelines.
    """

    def __init__(self, model_name: str = "linear_regression"):
        self.model_name = model_name
        self.pipeline = self._build_pipeline()
        self.is_trained = False
        self.metrics: Dict[str, float] = {}

    def _build_pipeline(self) -> Pipeline:
        """
        Builds the scikit-learn pipeline with scaling and a regressor.
        """
        return Pipeline([
            ('scaler', StandardScaler()),
            ('regressor', LinearRegression())
        ])

    def fit(self, data: pd.DataFrame, target_column: str = 'target') -> Dict[str, float]:
        """
        Trains the model using the provided training data.
        
        Args:
            data: DataFrame containing features and the target column.
            target_column: The name of the column to predict.
            
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

        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

        self.pipeline.fit(X_train, y_train)
        
        y_pred = self.pipeline.predict(X_test)
        self.metrics = {
            "mse": float(mean_squared_error(y_test, y_pred)),
            "r2": float(r2_score(y_test, y_pred))
        }
        
        self.is_trained = True
        logger.info(f"Model trained successfully. Metrics: {self.metrics}")
        
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

        logger.info(f"Predicting with model: {self.model_name}")
        return self.pipeline.predict(features)

    def get_metrics(self) -> Dict[str, float]:
        """
        Returns the metrics calculated during the last training session.
        """
        return self.metrics
