# Model Card Schema

## Overview

Model cards are machine-readable metadata files that accompany each saved model version. They record training data information, hyperparameters, evaluation metrics, feature schema, and provenance information.

## Location

Model cards are saved alongside model artifacts in the registry:

models/
  sentiment/
    v1.0.pkl
    v1.0.card.json
    v1.1.pkl
    v1.1.card.json
    current -> v1.1.pkl
  price_predictor/
    v1.0.pkl
    v1.0.card.json
    current -> v1.0.pkl

## Schema Version 1.0

{
  "schema_version": "1.0",
  "version": "v1.0",
  "model_type": "sentiment",
  "created_at": "2026-08-24T12:00:00.000Z",
  "training_data": {
    "data_start_date": "2026-01-01",
    "data_end_date": "2026-06-30",
    "row_count": 100000,
    "source": "user_reviews.db",
    "description": "User sentiment reviews from Q1-Q2 2026",
    "features": ["text", "user_id", "timestamp"]
  },
  "hyperparameters": {
    "params": {
      "learning_rate": 0.001,
      "epochs": 100,
      "batch_size": 32,
      "embedding_dim": 128
    },
    "tuning_notes": "Grid search over learning rates"
  },
  "metrics": {
    "accuracy": 0.92,
    "precision": 0.91,
    "recall": 0.89,
    "f1_score": 0.90,
    "auc": 0.95,
    "mae": null,
    "rmse": null,
    "r2_score": null,
    "additional_metrics": {
      "coverage": 0.98
    },
    "test_size": 20000,
    "validation_size": 10000
  },
  "feature_schema": {
    "version": "1.0",
    "features": [
      {"name": "text", "type": "string"},
      {"name": "user_id", "type": "category"},
      {"name": "timestamp", "type": "integer"}
    ],
    "target": "sentiment_label",
    "description": "Feature schema for sentiment model v1"
  },
  "provenance": {
    "source_code_commit": "abc123def456",
    "training_script": "train_sentiment.py",
    "created_by": "user@example.com",
    "training_timestamp": "2026-08-24T10:00:00.000Z"
  },
  "custom": {}
}

## Field Definitions

### Identity Fields

- schema_version: string, Required, Version of the card schema
- version: string, Required, Model version (e.g. v1.0)
- model_type: string, Required, Type of model (e.g. sentiment)
- created_at: string, Required, ISO timestamp of card creation

### Training Data

- data_start_date: string, Optional, ISO date of training data start
- data_end_date: string, Optional, ISO date of training data end
- row_count: integer, Optional, Number of training samples
- source: string, Optional, Source of training data
- description: string, Optional, Human-readable description
- features: array[string], Optional, List of feature names

### Hyperparameters

- params: object, Optional, Key-value pairs of hyperparameters
- tuning_notes: string, Optional, Notes about tuning methodology

### Evaluation Metrics

- accuracy: float, Optional, Classification accuracy
- precision: float, Optional, Precision score
- recall: float, Optional, Recall score
- f1_score: float, Optional, F1 score
- auc: float, Optional, Area Under the ROC Curve
- mae: float, Optional, Mean Absolute Error
- rmse: float, Optional, Root Mean Squared Error
- r2_score: float, Optional, R squared score
- additional_metrics: object, Optional, Additional metric key-value pairs
- test_size: integer, Optional, Size of test set
- validation_size: integer, Optional, Size of validation set

### Feature Schema

- version: string, Optional, Feature schema version
- features: array, Optional, List of feature definitions
- features[].name: string, Required, Feature name
- features[].type: string, Required, Feature type (float, int, string, category, datetime, array)
- target: string, Optional, Target column name
- description: string, Optional, Schema description

### Provenance

- source_code_commit: string, Optional, Git commit hash
- training_script: string, Optional, Name of training script
- created_by: string, Optional, User or system that created the model
- training_timestamp: string, Optional, ISO timestamp of training

### Custom Metadata

- custom: object, Optional, Any additional metadata

## API Usage

### Saving a Model with a Card

from ml.model_card import ModelCard, save_model_with_card

card = ModelCard(
    version="v1.0",
    model_type="sentiment",
    training_data=TrainingDataInfo(row_count=100000),
    metrics=EvaluationMetrics(accuracy=0.92)
)

save_model_with_card(model_obj, "sentiment", "v1.0", card)

### Loading a Model Card

from ml.model_registry import load_model_card

card = load_model_card("sentiment", "v1.0")
print(card["metrics"]["accuracy"])

### Registry Status with Cards

from ml.model_registry import get_registry_status_with_cards

status = get_registry_status_with_cards()

for model_type, info in status.items():
    for card_info in info.get("model_cards", []):
        has_card = "yes" if card_info["has_card"] else "no"
        print(f"{model_type} {card_info['version']}: {has_card}")

### Handling Missing Cards

card = load_model_card("sentiment", "v1.0")
if card is None:
    print("No model card found for this version")
    # Card is marked as missing in registry status

## Backward Compatibility

For existing versions where the card is missing, load_model_card returns None and the registry status reports the card as missing rather than guessing values.

## Validation Rules

- Required Fields: schema_version, version, model_type, created_at
- Date Format: Must be valid ISO 8601 format
- Version Format: Must follow v<major>.<minor> pattern
- Feature Types: Must be one of: float, int, string, category, datetime, array
- Metrics: Numeric values between 0-1 for classification metrics
- Row Count: Must be a positive integer

## Changelog

Version 1.0 (2026-08-24) - Initial schema release# Model Card Schema

## Overview

Model cards are machine-readable metadata files that accompany each saved model version. They record training data information, hyperparameters, evaluation metrics, feature schema, and provenance information.

## Location

Model cards are saved alongside model artifacts in the registry:

models/
  sentiment/
    v1.0.pkl
    v1.0.card.json
    v1.1.pkl
    v1.1.card.json
    current -> v1.1.pkl
  price_predictor/
    v1.0.pkl
    v1.0.card.json
    current -> v1.0.pkl

## Schema Version 1.0

{
  "schema_version": "1.0",
  "version": "v1.0",
  "model_type": "sentiment",
  "created_at": "2026-08-24T12:00:00.000Z",
  "training_data": {
    "data_start_date": "2026-01-01",
    "data_end_date": "2026-06-30",
    "row_count": 100000,
    "source": "user_reviews.db",
    "description": "User sentiment reviews from Q1-Q2 2026",
    "features": ["text", "user_id", "timestamp"]
  },
  "hyperparameters": {
    "params": {
      "learning_rate": 0.001,
      "epochs": 100,
      "batch_size": 32,
      "embedding_dim": 128
    },
    "tuning_notes": "Grid search over learning rates"
  },
  "metrics": {
    "accuracy": 0.92,
    "precision": 0.91,
    "recall": 0.89,
    "f1_score": 0.90,
    "auc": 0.95,
    "mae": null,
    "rmse": null,
    "r2_score": null,
    "additional_metrics": {
      "coverage": 0.98
    },
    "test_size": 20000,
    "validation_size": 10000
  },
  "feature_schema": {
    "version": "1.0",
    "features": [
      {"name": "text", "type": "string"},
      {"name": "user_id", "type": "category"},
      {"name": "timestamp", "type": "integer"}
    ],
    "target": "sentiment_label",
    "description": "Feature schema for sentiment model v1"
  },
  "provenance": {
    "source_code_commit": "abc123def456",
    "training_script": "train_sentiment.py",
    "created_by": "user@example.com",
    "training_timestamp": "2026-08-24T10:00:00.000Z"
  },
  "custom": {}
}

## Field Definitions

### Identity Fields

- schema_version: string, Required, Version of the card schema
- version: string, Required, Model version (e.g. v1.0)
- model_type: string, Required, Type of model (e.g. sentiment)
- created_at: string, Required, ISO timestamp of card creation

### Training Data

- data_start_date: string, Optional, ISO date of training data start
- data_end_date: string, Optional, ISO date of training data end
- row_count: integer, Optional, Number of training samples
- source: string, Optional, Source of training data
- description: string, Optional, Human-readable description
- features: array[string], Optional, List of feature names

### Hyperparameters

- params: object, Optional, Key-value pairs of hyperparameters
- tuning_notes: string, Optional, Notes about tuning methodology

### Evaluation Metrics

- accuracy: float, Optional, Classification accuracy
- precision: float, Optional, Precision score
- recall: float, Optional, Recall score
- f1_score: float, Optional, F1 score
- auc: float, Optional, Area Under the ROC Curve
- mae: float, Optional, Mean Absolute Error
- rmse: float, Optional, Root Mean Squared Error
- r2_score: float, Optional, R squared score
- additional_metrics: object, Optional, Additional metric key-value pairs
- test_size: integer, Optional, Size of test set
- validation_size: integer, Optional, Size of validation set

### Feature Schema

- version: string, Optional, Feature schema version
- features: array, Optional, List of feature definitions
- features[].name: string, Required, Feature name
- features[].type: string, Required, Feature type (float, int, string, category, datetime, array)
- target: string, Optional, Target column name
- description: string, Optional, Schema description

### Provenance

- source_code_commit: string, Optional, Git commit hash
- training_script: string, Optional, Name of training script
- created_by: string, Optional, User or system that created the model
- training_timestamp: string, Optional, ISO timestamp of training

### Custom Metadata

- custom: object, Optional, Any additional metadata

## API Usage

### Saving a Model with a Card

from ml.model_card import ModelCard, save_model_with_card

card = ModelCard(
    version="v1.0",
    model_type="sentiment",
    training_data=TrainingDataInfo(row_count=100000),
    metrics=EvaluationMetrics(accuracy=0.92)
)

save_model_with_card(model_obj, "sentiment", "v1.0", card)

### Loading a Model Card

from ml.model_registry import load_model_card

card = load_model_card("sentiment", "v1.0")
print(card["metrics"]["accuracy"])

### Registry Status with Cards

from ml.model_registry import get_registry_status_with_cards

status = get_registry_status_with_cards()

for model_type, info in status.items():
    for card_info in info.get("model_cards", []):
        has_card = "yes" if card_info["has_card"] else "no"
        print(f"{model_type} {card_info['version']}: {has_card}")

### Handling Missing Cards

card = load_model_card("sentiment", "v1.0")
if card is None:
    print("No model card found for this version")
    # Card is marked as missing in registry status

## Backward Compatibility

For existing versions where the card is missing, load_model_card returns None and the registry status reports the card as missing rather than guessing values.

## Validation Rules

- Required Fields: schema_version, version, model_type, created_at
- Date Format: Must be valid ISO 8601 format
- Version Format: Must follow v<major>.<minor> pattern
- Feature Types: Must be one of: float, int, string, category, datetime, array
- Metrics: Numeric values between 0-1 for classification metrics
- Row Count: Must be a positive integer

## Changelog

Version 1.0 (2026-08-24) - Initial schema release
