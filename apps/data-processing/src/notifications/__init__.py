"""Notification routing to the backend service (#1447)."""

from src.notifications.backend_client import (
    BackendNotificationClient,
    map_severity_to_backend_priority,
)

__all__ = ["BackendNotificationClient", "map_severity_to_backend_priority"]
