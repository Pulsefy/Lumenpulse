"""
ML module for price prediction and other data-driven models.
"""

from .model_registry import (
    ComparisonEntry,
    clear_comparison_log,
    flush_all_comparisons,
    generate_comparison_report,
    get_all_shadow_status,
    get_current_version,
    get_live_model,
    get_registry_status,
    get_shadow_model,
    get_shadow_status,
    get_shadow_version,
    list_versions,
    load_metadata,
    load_model,
    log_comparison,
    promote_model,
    promote_shadow,
    read_comparison_log,
    # Shadow-mode deployment (Issue #1256)
    register_shadow,
    save_model,
    unregister_shadow,
)
from .price_predictor import PricePredictor
from .retraining_pipeline import get_last_run_status, run_retraining
from .shadow_predictor import ShadowPredictor

__all__ = [
    "PricePredictor",
    "save_model",
    "load_model",
    "load_metadata",
    "promote_model",
    "get_live_model",
    "list_versions",
    "get_current_version",
    "get_registry_status",
    # Shadow-mode deployment (Issue #1256)
    "register_shadow",
    "unregister_shadow",
    "promote_shadow",
    "get_shadow_model",
    "get_shadow_version",
    "get_shadow_status",
    "get_all_shadow_status",
    "log_comparison",
    "flush_all_comparisons",
    "read_comparison_log",
    "generate_comparison_report",
    "clear_comparison_log",
    "ComparisonEntry",
    "ShadowPredictor",
    "run_retraining",
    "get_last_run_status",
]
