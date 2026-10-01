"""
Shared pagination and response-size limits for large analytics collection endpoints.

Issue #1458 — paginate/stream large analytics responses and enforce a hard
ceiling on uncapped page sizes so history growth cannot blow out read-model
rebuilds.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional, Tuple

MAX_PAGE_SIZE = int(os.getenv("ANALYTICS_MAX_PAGE_SIZE", "500"))
DEFAULT_PAGE_SIZE = int(os.getenv("ANALYTICS_DEFAULT_PAGE_SIZE", "100"))
MAX_CORRELATION_POINTS = int(os.getenv("ANALYTICS_MAX_CORRELATION_POINTS", "5000"))
REPRESENTATIVE_HISTORY_SIZE = int(os.getenv("ANALYTICS_BENCH_HISTORY_SIZE", "2000"))


def clamp_limit(limit: Optional[int], default: int = DEFAULT_PAGE_SIZE) -> int:
    """Clamp a requested page size into [1, MAX_PAGE_SIZE]."""
    if limit is None:
        return default
    try:
        value = int(limit)
    except (TypeError, ValueError):
        return default
    if value < 1:
        return 1
    return min(value, MAX_PAGE_SIZE)


def clamp_offset(offset: Optional[int]) -> int:
    """Clamp an offset to a non-negative integer."""
    if offset is None:
        return 0
    try:
        value = int(offset)
    except (TypeError, ValueError):
        return 0
    return max(0, value)


def pagination_headers(
    *,
    total: int,
    limit: int,
    offset: int,
    returned: int,
) -> Dict[str, str]:
    """Build response headers describing the current page."""
    has_more = offset + returned < total
    return {
        "X-Total-Count": str(total),
        "X-Limit": str(limit),
        "X-Offset": str(offset),
        "X-Has-More": "true" if has_more else "false",
        "X-Max-Page-Size": str(MAX_PAGE_SIZE),
    }


def page_slice(items: List[Any], *, limit: int, offset: int) -> Tuple[List[Any], int]:
    """Apply offset/limit to an in-memory list; return (page, total)."""
    total = len(items)
    return items[offset : offset + limit], total
