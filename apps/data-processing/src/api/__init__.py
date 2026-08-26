"""
API module for exposing data-processing functionality.
"""

from src.api.kpi_routes import router as kpi_router
from src.api.ledger_cursor_routes import router as ledger_cursor_router
from src.api.ingestion_quality_routes import router as ingestion_quality_router
from src.api.review_queue_routes import router as review_queue_router
from src.api.account_operation_routes import router as account_operation_router
from src.api.label_routes import router as label_router

__all__ = [
    "kpi_router",
    "ledger_cursor_router",
    "ingestion_quality_router",
    "review_queue_router",
    "account_operation_router",
    "label_router",
]