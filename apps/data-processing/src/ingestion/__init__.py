"""
Data ingestion module for fetching external data.
Includes account operation ingestion from Horizon.
"""
from .payload_quarantine import (
    QuarantineStore,
    QuarantinedPayload,
    quarantine_on_error,
    process_with_quarantine,
)

from .freshness_monitor import (
    FreshnessResult,
    FreshnessThreshold,
    StaleSourceReport,
    probe_news_freshness,
    probe_onchain_freshness,
    probe_price_freshness,
    run_freshness_check,
)
from .dataset_sla import (
    DatasetSLABreach,
    DatasetSLAMeasurement,
    DatasetSLATarget,
    evaluate_dataset_slas,
    get_dataset_sla_targets,
)

try:
    from .news_fetcher import NewsFetcher, NewsArticle, fetch_news
except ImportError:
    pass

try:
    from .stellar_fetcher import (
        StellarDataFetcher,
        VolumeData,
        TransactionRecord,
        get_asset_volume,
        get_network_overview,
    )
except ImportError:
    pass

try:
    from .price_fetcher import PriceFetcher
except ImportError:
    pass

try:
    from .social_fetcher import (
        SocialFetcher,
        SocialPost,
        TwitterFetcher,
        RedditFetcher,
        RateLimiter,
        SocialPlatform,
        fetch_social,
    )
except ImportError:
    pass

try:
    from .ledger_cursor_store import LedgerCursorStore, LedgerCursorRow
    from .recovery_coordinator import RecoveryCoordinator, DuplicateEventError
except ImportError:
    pass

try:
    # Account operation ingestion (Issue #743)
    from .account_operation_ingestor import (
        AccountOperationIngestor,
        ingest_account_operations,
        get_ingestion_status,
    )
except ImportError:
    pass

__all__ = [
    # Freshness SLA monitor
    "FreshnessResult",
    "FreshnessThreshold",
    "StaleSourceReport",
    "DatasetSLABreach",
    "DatasetSLAMeasurement",
    "DatasetSLATarget",
    "evaluate_dataset_slas",
    "get_dataset_sla_targets",
    "probe_news_freshness",
    "probe_onchain_freshness",
    "probe_price_freshness",
    "run_freshness_check",
    "NewsFetcher",
    "NewsArticle",
    "fetch_news",
    "StellarDataFetcher",
    "VolumeData",
    "TransactionRecord",
    "get_asset_volume",
    "get_network_overview",
    "PriceFetcher",
    # Social media fetchers
    "SocialFetcher",
    "SocialPost",
    "TwitterFetcher",
    "RedditFetcher",
    "RateLimiter",
    "SocialPlatform",
    "fetch_social",
    "QuarantineStore",
    "QuarantinedPayload",
    "quarantine_on_error",
    "process_with_quarantine",
    # Persistent ledger cursor store & recovery coordinator
    "LedgerCursorStore",
    "LedgerCursorRow",
    "RecoveryCoordinator",
    "DuplicateEventError",
    # Account operation ingestion (Issue #743)
    "AccountOperationIngestor",
    "ingest_account_operations",
    "get_ingestion_status",
]
