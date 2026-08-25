"""
Model Card - structured metadata for model versions.

A model card records training data, hyperparameters, evaluation metrics,
feature schema, and provenance information. It is saved alongside the
model artifact and retrievable through the registry.

Schema version: 1.0
"""

import json
import pickle
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional, Dict, List, Union

# ---------------------------------------------------------------------------
# Model Card Schema
# ---------------------------------------------------------------------------

@dataclass
class TrainingDataInfo:
    """Information about the training dataset."""
    
    # Range of data used for training
    data_start_date: Optional[str] = None  # ISO format
    data_end_date: Optional[str] = None    # ISO format
    
    # Row count
    row_count: Optional[int] = None
    
    # Additional metadata
    source: Optional[str] = None
    description: Optional[str] = None
    features: Optional[List[str]] = None  # List of feature names used


@dataclass
class HyperparametersInfo:
    """Model hyperparameters and configuration."""
    
    # Key-value pairs for hyperparameters
    params: Dict[str, Any] = field(default_factory=dict)
    
    # Any notes about tuning
    tuning_notes: Optional[str] = None


@dataclass
class EvaluationMetrics:
    """Model evaluation metrics."""
    
    # Primary metrics
    accuracy: Optional[float] = None
    precision: Optional[float] = None
    recall: Optional[float] = None
    f1_score: Optional[float] = None
    auc: Optional[float] = None
    mae: Optional[float] = None
    rmse: Optional[float] = None
    r2_score: Optional[float] = None
    
    # Additional metrics
    additional_metrics: Dict[str, float] = field(default_factory=dict)
    
    # Evaluation set info
    test_size: Optional[int] = None
    validation_size: Optional[int] = None


@dataclass
class FeatureSchema:
    """Feature schema information."""
    
    # Schema version (e.g., "1.0", "2.0")
    version: str = "1.0"
    
    # Feature names and types
    features: List[Dict[str, str]] = field(default_factory=list)
    # Each entry: {"name": "feature_name", "type": "float|int|string|category"}
    
    # Target column
    target: Optional[str] = None
    
    # Additional schema info
    description: Optional[str] = None


@dataclass
class ModelCard:
    """
    Complete model card with all metadata.
    
    Schema version: 1.0
    """
    
    # Identity
    version: str
    model_type: str
    created_at: str  # ISO format
    
    # Training data
    training_data: TrainingDataInfo = field(default_factory=TrainingDataInfo)
    
    # Hyperparameters
    hyperparameters: HyperparametersInfo = field(default_factory=HyperparametersInfo)
    
    # Evaluation metrics
    metrics: EvaluationMetrics = field(default_factory=EvaluationMetrics)
    
    # Feature schema
    feature_schema: FeatureSchema = field(default_factory=FeatureSchema)
    
    # Provenance
    source_code_commit: Optional[str] = None
    training_script: Optional[str] = None
    created_by: Optional[str] = None
    
    # Custom metadata (for extension)
    custom: Dict[str, Any] = field(default_factory=dict)
    
    # Schema version
    schema_version: str = "1.0"
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert model card to dictionary."""
        return asdict(self)
    
    def to_json(self) -> str:
        """Convert model card to JSON string."""
        return json.dumps(self.to_dict(), indent=2, default=str)
    
    def save(self, path: Path) -> None:
        """Save model card to file."""
        with open(path, "w") as f:
            f.write(self.to_json())
    
    @classmethod
    def load(cls, path: Path) -> "ModelCard":
        """Load model card from file."""
        with open(path, "r") as f:
            data = json.load(f)
        return cls.from_dict(data)
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ModelCard":
        """Create ModelCard from dictionary."""
        # Handle nested dataclasses
        training_data = TrainingDataInfo(**data.get("training_data", {}))
        hyperparameters = HyperparametersInfo(**data.get("hyperparameters", {}))
        metrics = EvaluationMetrics(**data.get("metrics", {}))
        feature_schema = FeatureSchema(**data.get("feature_schema", {}))
        
        return cls(
            version=data.get("version", ""),
            model_type=data.get("model_type", ""),
            created_at=data.get("created_at", datetime.now(timezone.utc).isoformat()),
            training_data=training_data,
            hyperparameters=hyperparameters,
            metrics=metrics,
            feature_schema=feature_schema,
            source_code_commit=data.get("source_code_commit"),
            training_script=data.get("training_script"),
            created_by=data.get("created_by"),
            custom=data.get("custom", {}),
            schema_version=data.get("schema_version", "1.0"),
        )


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def create_model_card(
    version: str,
    model_type: str,
    training_data: Optional[TrainingDataInfo] = None,
    hyperparameters: Optional[HyperparametersInfo] = None,
    metrics: Optional[EvaluationMetrics] = None,
    feature_schema: Optional[FeatureSchema] = None,
    **kwargs,
) -> ModelCard:
    """
    Create a model card with the given information.
    
    Args:
        version: Model version string (e.g., "v1.0")
        model_type: Type of model (e.g., "sentiment", "price_predictor")
        training_data: TrainingDataInfo object
        hyperparameters: HyperparametersInfo object
        metrics: EvaluationMetrics object
        feature_schema: FeatureSchema object
        **kwargs: Additional fields (source_code_commit, training_script, created_by, custom)
    
    Returns:
        ModelCard object
    """
    card = ModelCard(
        version=version,
        model_type=model_type,
        created_at=datetime.now(timezone.utc).isoformat(),
        training_data=training_data or TrainingDataInfo(),
        hyperparameters=hyperparameters or HyperparametersInfo(),
        metrics=metrics or EvaluationMetrics(),
        feature_schema=feature_schema or FeatureSchema(),
        source_code_commit=kwargs.get("source_code_commit"),
        training_script=kwargs.get("training_script"),
        created_by=kwargs.get("created_by"),
        custom=kwargs.get("custom", {}),
    )
    return card


def model_card_path(model_type: str, version: str) -> Path:
    """Return the path to the model card file."""
    from model_registry import _MODELS_ROOT
    return _MODELS_ROOT / model_type / f"{version}.card.json"


def save_model_with_card(
    model_obj: Any,
    model_type: str,
    version: str,
    card: ModelCard,
) -> str:
    """
    Save model and model card together.
    
    This is a convenience wrapper that saves both the pickled model
    and the model card in the same directory.
    """
    from model_registry import save_model
    
    # Save the model
    saved_version = save_model(model_type, model_obj, version)
    
    # Save the card
    card_path = model_card_path(model_type, saved_version)
    card.save(card_path)
    
    return saved_version


def load_model_card(model_type: str, version: str = "current") -> Optional[ModelCard]:
    """
    Load a model card for a specific version.
    
    Args:
        model_type: e.g. "sentiment" or "price_predictor"
        version: Specific version string or "current" (follows symlink).
    
    Returns:
        ModelCard object or None if not found.
    """
    from model_registry import _symlink_path, _MODELS_ROOT
    
    if version == "current":
        sym = _symlink_path(model_type)
        if not sym.exists():
            return None
        # Get the actual version from the symlink target
        version = sym.resolve().stem
    
    card_path = _MODELS_ROOT / model_type / f"{version}.card.json"
    if not card_path.exists():
        return None
    
    return ModelCard.load(card_path)


def get_registry_status_with_cards() -> Dict[str, Any]:
    """
    Get registry status with model cards included.
    
    Returns:
        Status dictionary with model card info for each version.
    """
    from model_registry import get_registry_status, list_versions
    
    status = get_registry_status()
    
    # Add model card info for each version
    for model_type, info in status.items():
        versions = info.get("available_versions", [])
        cards = []
        for v in versions:
            card = load_model_card(model_type, v)
            if card:
                cards.append({
                    "version": v,
                    "card": card.to_dict(),
                })
            else:
                # Mark as unknown if card is missing
                cards.append({
                    "version": v,
                    "card": None,
                    "missing": True,
                })
        info["model_cards"] = cards
    
    return status


# For backward compatibility, patch the existing get_registry_status
# This can be done by the caller, or we can monkey-patch.
