import pytest
import pandas as pd
import numpy as np
from src.ml.price_predictor import PricePredictor
from src.ml.feature_schema import SchemaVersionMismatch, current_feature_schema

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


# ── feature schema versioning (#1239) ──────────────────────────────────────

def _simple_training_frame(n=100, seed=0):
    rng = np.random.default_rng(seed)
    X = rng.random((n, 1))
    df = pd.DataFrame(X, columns=['f1'])
    df['target'] = 5 * X[:, 0] + 2
    return df


def test_fit_records_current_schema_version_by_default():
    predictor = PricePredictor()
    assert predictor.training_schema_version is None
    predictor.fit(_simple_training_frame(), target_column='target')
    assert predictor.training_schema_version == current_feature_schema().version


def test_fit_takes_schema_version_from_frame_attrs():
    predictor = PricePredictor()
    df = _simple_training_frame()
    df.attrs['schema_version'] = '3.7'
    predictor.fit(df, target_column='target')
    assert predictor.training_schema_version == '3.7'


def test_explicit_schema_version_wins():
    predictor = PricePredictor()
    df = _simple_training_frame()
    df.attrs['schema_version'] = '3.7'
    predictor.fit(df, target_column='target', schema_version='9.9')
    assert predictor.training_schema_version == '9.9'


def test_predict_warns_but_serves_on_mismatch_by_default(monkeypatch):
    monkeypatch.delenv('FEATURE_SCHEMA_ENFORCEMENT', raising=False)  # default warn
    predictor = PricePredictor()
    predictor.fit(_simple_training_frame(), target_column='target', schema_version='1.0')

    features = pd.DataFrame([[0.5]], columns=['f1'])
    features.attrs['schema_version'] = '2.0'  # skew vs training
    # warn mode -> still returns a prediction
    prediction = predictor.predict(features)
    assert len(prediction) == 1


def test_predict_refuses_on_mismatch_in_strict_mode(monkeypatch):
    monkeypatch.setenv('FEATURE_SCHEMA_ENFORCEMENT', 'strict')
    predictor = PricePredictor()
    predictor.fit(_simple_training_frame(), target_column='target', schema_version='1.0')

    features = pd.DataFrame([[0.5]], columns=['f1'])
    features.attrs['schema_version'] = '2.0'
    with pytest.raises(SchemaVersionMismatch):
        predictor.predict(features)


def test_predict_ok_when_versions_match_strict(monkeypatch):
    monkeypatch.setenv('FEATURE_SCHEMA_ENFORCEMENT', 'strict')
    predictor = PricePredictor()
    predictor.fit(_simple_training_frame(), target_column='target', schema_version='1.0')

    features = pd.DataFrame([[0.5]], columns=['f1'])
    features.attrs['schema_version'] = '1.0'
    prediction = predictor.predict(features)
    assert len(prediction) == 1