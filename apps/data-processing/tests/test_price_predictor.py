import pytest
import pandas as pd
import numpy as np
from src.ml.price_predictor import PricePredictor

def test_price_predictor_initialization():
    predictor = PricePredictor()
    assert predictor.model_name == "linear_regression"
    assert not predictor.is_trained
    assert predictor.pipeline is not None

def test_price_predictor_fit_with_synthetic_data():
    predictor = PricePredictor()
    
    np.random.seed(42)
    X = np.random.rand(100, 2)
    y = 2 * X[:, 0] + 3 * X[:, 1] + 10 + np.random.normal(0, 0.01, 100)
    
    df = pd.DataFrame(X, columns=['feature1', 'feature2'])
    df['target'] = y
    
    metrics = predictor.fit(df, target_column='target')
    
    assert predictor.is_trained
    assert "mse" in metrics
    assert "r2" in metrics
    assert metrics["r2"] > 0.99

def test_price_predictor_predict():
    predictor = PricePredictor()
    
    np.random.seed(42)
    X = np.random.rand(100, 1)
    y = 5 * X[:, 0] + 2
    df = pd.DataFrame(X, columns=['f1'])
    df['target'] = y
    predictor.fit(df, target_column='target')
    
    test_features = pd.DataFrame([[0.5]], columns=['f1'])
    prediction = predictor.predict(test_features)
    
    assert len(prediction) == 1
    assert pytest.approx(prediction[0], rel=1e-2) == 4.5

def test_price_predictor_unfit_error():
    predictor = PricePredictor()
    with pytest.raises(RuntimeError, match="Model must be trained"):
        predictor.predict(pd.DataFrame([[1]], columns=['f1']))

def test_price_predictor_invalid_target():
    predictor = PricePredictor()
    df = pd.DataFrame([[1, 2]], columns=['f1', 'f2'])
    with pytest.raises(ValueError, match="Target column 'missing' not found"):
        predictor.fit(df, target_column='missing')