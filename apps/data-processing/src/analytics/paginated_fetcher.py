"""
Paginated consumer helpers for analytics collection endpoints (#1458).

Backend read-model rebuilds and export jobs should iterate with these helpers
instead of requesting an uncapped result set in a single call.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, Iterator, List, Optional, Tuple

from src.utils.pagination import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, clamp_limit

FetchPage = Callable[..., Tuple[List[Any], int]]


def iter_paginated(
    fetch_page: FetchPage,
    *,
    page_size: int = DEFAULT_PAGE_SIZE,
    max_pages: Optional[int] = None,
    **filters: Any,
) -> Iterator[Any]:
    """Yield every item from a stably-ordered paginated collection."""
    limit = clamp_limit(page_size)
    offset = 0
    pages = 0
    while True:
        items, total = fetch_page(limit=limit, offset=offset, **filters)
        if not items:
            break
        for item in items:
            yield item
        offset += len(items)
        pages += 1
        if offset >= total:
            break
        if max_pages is not None and pages >= max_pages:
            break


def fetch_all_daily_kpi_snapshots(
    db_service: Any,
    *,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    period: str = "daily",
    page_size: int = DEFAULT_PAGE_SIZE,
) -> List[Any]:
    """Load every matching daily KPI snapshot by walking pages."""

    def _page(*, limit: int, offset: int, **_kwargs: Any) -> Tuple[List[Any], int]:
        return db_service.get_daily_onchain_kpi_snapshots(
            start_date=start_date,
            end_date=end_date,
            period=period,
            limit=limit,
            offset=offset,
        )

    return list(iter_paginated(_page, page_size=page_size))


def fetch_all_kpi_series(
    computer: Any,
    *,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    period: str = "daily",
    page_size: int = DEFAULT_PAGE_SIZE,
) -> List[Dict[str, Any]]:
    """Load the full KPI series by walking pages (stable ascending date order)."""

    def _page(*, limit: int, offset: int, **_kwargs: Any) -> Tuple[List[Dict[str, Any]], int]:
        return computer.get_kpi_series(
            start_date=start_date,
            end_date=end_date,
            period=period,
            limit=limit,
            offset=offset,
        )

    return list(iter_paginated(_page, page_size=min(page_size, MAX_PAGE_SIZE)))
