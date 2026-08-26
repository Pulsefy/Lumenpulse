"""
Account Operations Ingestor for Horizon

Ingests account operations from Stellar Horizon API with:
- Backfill + incremental support
- Deduplication by operation ID
- Rate limit respect
- Persistent cursor tracking
- Idempotent processing
"""

from __future__ import annotations

import time
import os
from typing import Dict, List, Optional, Any, Set, Tuple
from datetime import datetime, timezone
from dataclasses import dataclass, field
from enum import Enum

from stellar_sdk.exceptions import BadRequestError, ConnectionError

# Horizon has no dedicated rate-limit exception; a 429 response surfaces as a
# BadRequestError with `.status == 429`, so it must be distinguished by status code.
HORIZON_RATE_LIMIT_STATUS = 429

from src.utils.logger import setup_logger
from src.db.postgres_service import PostgresService
from src.db.models import ContractEvent, RawSorobanEvent
from src.ingestion.ledger_cursor_store import LedgerCursorStore
from src.ingestion.stellar_fetcher import StellarDataFetcher

logger = setup_logger(__name__)


class OperationType(str, Enum):
    """Stellar operation types."""
    CREATE_ACCOUNT = "create_account"
    PAYMENT = "payment"
    PATH_PAYMENT = "path_payment"
    PATH_PAYMENT_STRICT_SEND = "path_payment_strict_send"
    MANAGE_SELL_OFFER = "manage_sell_offer"
    MANAGE_BUY_OFFER = "manage_buy_offer"
    CREATE_PASSIVE_SELL_OFFER = "create_passive_sell_offer"
    SET_OPTIONS = "set_options"
    CHANGE_TRUST = "change_trust"
    ALLOW_TRUST = "allow_trust"
    ACCOUNT_MERGE = "account_merge"
    INFLATION = "inflation"
    MANAGE_DATA = "manage_data"
    BUMP_SEQUENCE = "bump_sequence"
    CREATE_CLAIMABLE_BALANCE = "create_claimable_balance"
    CLAIM_CLAIMABLE_BALANCE = "claim_claimable_balance"
    BEGIN_SPONSORING_FUTURE_RESERVES = "begin_sponsoring_future_reserves"
    END_SPONSORING_FUTURE_RESERVES = "end_sponsoring_future_reserves"
    REVOKE_SPONSORSHIP = "revoke_sponsorship"
    CLAWBACK = "clawback"
    CLAWBACK_CLAIMABLE_BALANCE = "clawback_claimable_balance"
    SET_TRUST_LINE_FLAGS = "set_trust_line_flags"
    LIQUIDITY_POOL_DEPOSIT = "liquidity_pool_deposit"
    LIQUIDITY_POOL_WITHDRAW = "liquidity_pool_withdraw"
    UNKNOWN = "unknown"


@dataclass
class AccountOperation:
    """
    Normalized account operation from Horizon.
    
    Attributes:
        id: Operation ID (unique identifier)
        tx_id: Transaction ID
        source_account: Source account address
        operation_type: Type of operation
        created_at: Operation timestamp
        ledger: Ledger sequence number
        paging_token: Horizon paging token
        amount: Amount (for payment operations)
        asset_code: Asset code (for payment operations)
        asset_issuer: Asset issuer (for payment operations)
        to_account: Destination account (for payment operations)
        from_account: Source account (for payment operations)
        raw_data: Raw operation data from Horizon
    """
    id: str
    tx_id: str
    source_account: str
    operation_type: str
    created_at: datetime
    ledger: int
    paging_token: str
    amount: Optional[float] = None
    asset_code: Optional[str] = None
    asset_issuer: Optional[str] = None
    to_account: Optional[str] = None
    from_account: Optional[str] = None
    raw_data: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "tx_id": self.tx_id,
            "source_account": self.source_account,
            "operation_type": self.operation_type,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "ledger": self.ledger,
            "paging_token": self.paging_token,
            "amount": self.amount,
            "asset_code": self.asset_code,
            "asset_issuer": self.asset_issuer,
            "to_account": self.to_account,
            "from_account": self.from_account,
        }


@dataclass
class IngestionStats:
    """Statistics for an ingestion run."""
    operations_processed: int = 0
    operations_ingested: int = 0
    operations_duplicate: int = 0
    operations_failed: int = 0
    start_ledger: int = 0
    end_ledger: int = 0
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "operations_processed": self.operations_processed,
            "operations_ingested": self.operations_ingested,
            "operations_duplicate": self.operations_duplicate,
            "operations_failed": self.operations_failed,
            "start_ledger": self.start_ledger,
            "end_ledger": self.end_ledger,
            "start_time": self.start_time.isoformat() if self.start_time else None,
            "end_time": self.end_time.isoformat() if self.end_time else None,
            "duration_seconds": (
                (self.end_time - self.start_time).total_seconds()
                if self.start_time and self.end_time
                else None
            ),
        }


class AccountOperationIngestor:
    """
    Ingests account operations from Stellar Horizon.
    
    Features:
    - Backfill historical operations from a starting ledger
    - Incremental ingestion from the last processed cursor
    - Deduplication by operation ID
    - Rate limit respect with exponential backoff
    - Persistent cursor tracking via LedgerCursorStore
    - Idempotent processing
    """
    
    # Default configuration
    DEFAULT_HORIZON_URL = "https://horizon-testnet.stellar.org"
    DEFAULT_BATCH_SIZE = 200
    DEFAULT_RATE_LIMIT_SLEEP = 0.2
    MAX_RETRIES = 3
    RETRY_DELAY = 1.0
    RATE_LIMIT_BACKOFF_FACTOR = 2.0
    
    def __init__(
        self,
        horizon_url: Optional[str] = None,
        db_service: Optional[PostgresService] = None,
        cursor_store: Optional[LedgerCursorStore] = None,
        batch_size: int = DEFAULT_BATCH_SIZE,
        rate_limit_sleep: float = DEFAULT_RATE_LIMIT_SLEEP,
        network: str = "testnet",
    ):
        """
        Initialize the account operation ingestor.
        
        Args:
            horizon_url: Horizon server URL (defaults to testnet)
            db_service: PostgreSQL service instance
            cursor_store: Ledger cursor store instance
            batch_size: Number of operations to fetch per page
            rate_limit_sleep: Base sleep time between requests
            network: Network type ('testnet' or 'public')
        """
        self.horizon_url = horizon_url or os.getenv(
            "HORIZON_URL", self.DEFAULT_HORIZON_URL
        )
        self.db_service = db_service or PostgresService()
        self.cursor_store = cursor_store or LedgerCursorStore()
        self.batch_size = batch_size
        self.rate_limit_sleep = rate_limit_sleep
        self.network = network
        
        # Initialize StellarDataFetcher for Horizon interaction
        self.fetcher = StellarDataFetcher(
            horizon_url=self.horizon_url,
            network=network,
        )
        
        # Operation cache for deduplication within batch
        self._operation_cache: Set[str] = set()
        
        logger.info(
            f"AccountOperationIngestor initialized: horizon_url={self.horizon_url}, "
            f"batch_size={self.batch_size}, network={network}"
        )
    
    def _get_stream_id(self, account_id: Optional[str] = None) -> str:
        """
        Get the stream ID for cursor tracking.
        
        Args:
            account_id: Optional account ID for per-account streams
            
        Returns:
            Stream ID string
        """
        if account_id:
            return f"account_ops:{account_id}"
        return "account_ops:global"
    
    def _parse_operation(self, raw_op: Dict[str, Any]) -> Optional[AccountOperation]:
        """
        Parse a raw Horizon operation into an AccountOperation.
        
        Args:
            raw_op: Raw operation from Horizon API
            
        Returns:
            AccountOperation or None if parsing fails
        """
        try:
            op_id = raw_op.get("id", "")
            if not op_id:
                return None
            
            tx_id = raw_op.get("transaction_hash", "")
            source_account = raw_op.get("source_account", "")
            op_type = raw_op.get("type", "").lower()
            
            # Parse created_at
            created_at_str = raw_op.get("created_at", "")
            if created_at_str:
                created_at = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
            else:
                created_at = datetime.now(timezone.utc)
            
            # Extract ledger from paging token or transaction
            paging_token = raw_op.get("paging_token", "")
            ledger = raw_op.get("ledger", 0)
            if not ledger and paging_token:
                # Try to extract ledger from paging token (format: ledger-sequence-operation)
                parts = paging_token.split("-")
                if len(parts) >= 1 and parts[0].isdigit():
                    ledger = int(parts[0])
            
            # Parse operation-specific fields
            amount = None
            asset_code = None
            asset_issuer = None
            to_account = None
            from_account = None
            
            if op_type in ["payment", "path_payment", "path_payment_strict_send"]:
                amount = float(raw_op.get("amount", "0"))
                asset_code = raw_op.get("asset_code")
                asset_issuer = raw_op.get("asset_issuer")
                to_account = raw_op.get("to") or raw_op.get("destination")
                from_account = raw_op.get("from") or raw_op.get("source_account")
            
            return AccountOperation(
                id=op_id,
                tx_id=tx_id,
                source_account=source_account,
                operation_type=op_type,
                created_at=created_at,
                ledger=ledger,
                paging_token=paging_token,
                amount=amount,
                asset_code=asset_code,
                asset_issuer=asset_issuer,
                to_account=to_account,
                from_account=from_account,
                raw_data=raw_op,
            )
            
        except Exception as e:
            logger.error(f"Failed to parse operation: {e}")
            return None
    
    def _persist_operation(
        self,
        session: Any,
        operation: AccountOperation,
    ) -> bool:
        """
        Persist an account operation to the database.
        
        Uses the raw_soroban_events table as a generic event store,
        mapping account operations to a compatible format.
        
        Args:
            session: SQLAlchemy session
            operation: AccountOperation to persist
            
        Returns:
            True if persisted, False if duplicate or error
        """
        try:
            # Check for duplicate by operation_id (mapped to event_id)
            existing = session.query(RawSorobanEvent).filter_by(
                event_id=f"op_{operation.id}"
            ).first()
            
            if existing:
                return False
            
            # Create raw event entry
            raw_event = RawSorobanEvent(
                contract_id="",  # Not applicable for account operations
                event_id=f"op_{operation.id}",
                ledger=operation.ledger,
                paging_token=operation.paging_token,
                event_type=f"account_{operation.operation_type}",
                source_rpc_url=self.horizon_url,
                raw_payload={
                    "operation_id": operation.id,
                    "tx_id": operation.tx_id,
                    "source_account": operation.source_account,
                    "operation_type": operation.operation_type,
                    "created_at": operation.created_at.isoformat(),
                    "amount": operation.amount,
                    "asset_code": operation.asset_code,
                    "asset_issuer": operation.asset_issuer,
                    "to_account": operation.to_account,
                    "from_account": operation.from_account,
                    "raw_data": operation.raw_data,
                },
            )
            session.add(raw_event)
            
            # Also create a ContractEvent entry for compatibility with KPI computation
            # Convert account operations to contract event format when possible
            if operation.operation_type in ["payment", "path_payment"]:
                contract_event = ContractEvent(
                    contract_id=operation.asset_code or "native",
                    event_id=f"op_{operation.id}",
                    ledger=operation.ledger,
                    event_type=f"account_{operation.operation_type}",
                    project_id=None,  # Not associated with a specific project
                    contributor=operation.source_account,
                    amount=operation.amount,
                    timestamp=operation.created_at,
                    raw_data=operation.raw_data,
                )
                session.add(contract_event)
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to persist operation {operation.id}: {e}")
            return False
    
    def _fetch_operations_page(
        self,
        account_id: Optional[str] = None,
        cursor: Optional[str] = None,
        limit: int = 200,
    ) -> Tuple[List[Dict[str, Any]], Optional[str]]:
        """
        Fetch a single page of operations from Horizon.
        
        Args:
            account_id: Optional account ID to filter by
            cursor: Paging cursor
            limit: Number of operations per page
            
        Returns:
            Tuple of (operations_list, next_cursor)
        """
        try:
            # Build request
            if account_id:
                # Get operations for specific account
                ops_call = self.fetcher.server.operations().for_account(account_id)
            else:
                # Get all operations (global)
                ops_call = self.fetcher.server.operations()
            
            # Apply order (descending to get newest first for incremental)
            ops_call = ops_call.order("desc")
            
            # Apply cursor if provided
            if cursor:
                ops_call = ops_call.cursor(cursor)
            
            # Apply limit
            ops_call = ops_call.limit(min(limit, 200))
            
            # Execute request
            response = ops_call.call()
            
            # Extract records
            records = response.get("_embedded", {}).get("records", [])
            
            # Get next cursor
            next_cursor = None
            links = response.get("_links", {})
            if "next" in links and "href" in links["next"]:
                next_url = links["next"]["href"]
                if "cursor=" in next_url:
                    next_cursor = next_url.split("cursor=")[1].split("&")[0]
            
            return records, next_cursor
            
        except BadRequestError as e:
            if e.status == HORIZON_RATE_LIMIT_STATUS:
                logger.warning(f"Rate limit exceeded: {e}")
            else:
                logger.error(f"Horizon API error: {e}")
            raise
        except ConnectionError as e:
            logger.error(f"Horizon API error: {e}")
            raise
        except Exception as e:
            logger.error(f"Unexpected error fetching operations: {e}")
            raise
    
    def _fetch_operations_with_retry(
        self,
        account_id: Optional[str] = None,
        cursor: Optional[str] = None,
        limit: int = 200,
        max_retries: int = 3,
    ) -> Tuple[List[Dict[str, Any]], Optional[str]]:
        """
        Fetch operations with retry logic and rate limit handling.
        
        Args:
            account_id: Optional account ID to filter by
            cursor: Paging cursor
            limit: Number of operations per page
            max_retries: Maximum number of retry attempts
            
        Returns:
            Tuple of (operations_list, next_cursor)
        """
        retry_count = 0
        backoff = self.rate_limit_sleep
        
        while retry_count < max_retries:
            try:
                # Respect rate limit
                time.sleep(backoff)
                
                return self._fetch_operations_page(
                    account_id=account_id,
                    cursor=cursor,
                    limit=limit,
                )
                
            except BadRequestError as e:
                retry_count += 1
                if e.status == HORIZON_RATE_LIMIT_STATUS:
                    backoff *= self.RATE_LIMIT_BACKOFF_FACTOR
                    logger.warning(
                        f"Rate limit exceeded, retry {retry_count}/{max_retries} "
                        f"with backoff {backoff:.2f}s"
                    )
                else:
                    backoff *= 1.5
                    logger.warning(
                        f"Horizon API error, retry {retry_count}/{max_retries}: {e}"
                    )
                if retry_count >= max_retries:
                    raise

            except ConnectionError as e:
                retry_count += 1
                backoff *= 1.5
                logger.warning(
                    f"Connection error, retry {retry_count}/{max_retries}: {e}"
                )
                if retry_count >= max_retries:
                    raise

            except Exception as e:
                logger.error(f"Fatal error fetching operations: {e}")
                raise
        
        return [], None
    
    def ingest_incremental(
        self,
        account_id: Optional[str] = None,
        max_operations: Optional[int] = None,
    ) -> IngestionStats:
        """
        Ingest operations incrementally from the last processed cursor.
        
        Args:
            account_id: Optional account ID to filter by
            max_operations: Maximum number of operations to ingest
            
        Returns:
            IngestionStats with details of the run
        """
        stream_id = self._get_stream_id(account_id)
        stats = IngestionStats()
        stats.start_time = datetime.now(timezone.utc)
        
        try:
            # Get cursor
            cursor_row = self.cursor_store.get_or_create(stream_id)
            stats.start_ledger = cursor_row.last_ingested_ledger
            
            # Get current cursor
            current_cursor = cursor_row.last_event_id or None
            
            logger.info(
                f"Starting incremental ingestion for stream={stream_id}, "
                f"last_ledger={stats.start_ledger}, cursor={current_cursor}"
            )
            
            # Begin batch
            self.cursor_store.begin_batch(stream_id, stats.start_ledger)
            
            # Fetch and process operations
            operations_processed = 0
            last_operation_id = current_cursor
            last_ledger = stats.start_ledger
            
            while max_operations is None or operations_processed < max_operations:
                # Fetch operations page
                records, next_cursor = self._fetch_operations_with_retry(
                    account_id=account_id,
                    cursor=current_cursor,
                    limit=self.batch_size,
                )
                
                if not records:
                    logger.info("No more operations to ingest")
                    break
                
                # Process each operation
                with self.db_service.get_session() as session:
                    for raw_op in records:
                        stats.operations_processed += 1
                        
                        # Parse operation
                        op = self._parse_operation(raw_op)
                        if not op:
                            stats.operations_failed += 1
                            continue
                        
                        # Check for duplicate by operation ID
                        if op.id == last_operation_id:
                            # We've reached the last processed operation, skip it and stop
                            logger.debug(f"Reached last processed operation: {op.id}")
                            break
                        
                        # Check if this is a duplicate (shouldn't happen with cursor, but safe)
                        if op.id in self._operation_cache:
                            stats.operations_duplicate += 1
                            continue
                        
                        # Persist operation
                        if self._persist_operation(session, op):
                            stats.operations_ingested += 1
                            last_operation_id = op.id
                            last_ledger = op.ledger
                            self._operation_cache.add(op.id)
                        else:
                            stats.operations_duplicate += 1
                        
                        # Update cursor periodically
                        if stats.operations_ingested % 50 == 0:
                            session.commit()
                            logger.debug(
                                f"Processed {stats.operations_ingested} operations, "
                                f"last_ledger={last_ledger}"
                            )
                
                # Update cursor for this batch
                current_cursor = next_cursor
                operations_processed = stats.operations_processed
                
                # Check if we've hit the limit
                if max_operations and operations_processed >= max_operations:
                    logger.info(f"Reached max operations limit: {max_operations}")
                    break
                
                # If no next cursor, we're done
                if not next_cursor:
                    logger.info("No more pages to fetch")
                    break
            
            # Commit progress
            if last_ledger > stats.start_ledger:
                self.cursor_store.advance(
                    stream_id=stream_id,
                    new_ledger=last_ledger,
                    last_event_id=last_operation_id,
                )
            
            stats.end_ledger = last_ledger
            stats.end_time = datetime.now(timezone.utc)
            
            logger.info(
                f"Incremental ingestion completed: "
                f"processed={stats.operations_processed}, "
                f"ingested={stats.operations_ingested}, "
                f"duplicates={stats.operations_duplicate}, "
                f"failed={stats.operations_failed}, "
                f"ledger_range={stats.start_ledger}->{stats.end_ledger}"
            )
            
            return stats
            
        except Exception as e:
            # Rollback on error
            logger.error(f"Incremental ingestion failed: {e}")
            self.cursor_store.rollback_to_safe_point(
                stream_id=stream_id,
                error_message=str(e),
            )
            stats.end_time = datetime.now(timezone.utc)
            raise
    
    def backfill(
        self,
        account_id: Optional[str] = None,
        from_ledger: Optional[int] = None,
        to_ledger: Optional[int] = None,
        max_operations: Optional[int] = None,
    ) -> IngestionStats:
        """
        Backfill operations from a starting ledger.
        
        Args:
            account_id: Optional account ID to filter by
            from_ledger: Starting ledger (inclusive)
            to_ledger: Ending ledger (inclusive)
            max_operations: Maximum number of operations to ingest
            
        Returns:
            IngestionStats with details of the run
        """
        stream_id = self._get_stream_id(account_id)
        stats = IngestionStats()
        stats.start_time = datetime.now(timezone.utc)
        
        try:
            # Get or create cursor
            cursor_row = self.cursor_store.get_or_create(stream_id)
            
            # Determine starting ledger
            start_ledger = from_ledger or cursor_row.last_ingested_ledger or 0
            stats.start_ledger = start_ledger
            
            # Determine ending ledger (use current if not specified)
            end_ledger = to_ledger
            if not end_ledger:
                # Fetch latest ledger
                network_stats = self.fetcher.get_network_stats()
                end_ledger = network_stats.get("latest_ledger", 0)
            
            logger.info(
                f"Starting backfill for stream={stream_id}, "
                f"from_ledger={start_ledger}, to_ledger={end_ledger}"
            )
            
            # Begin batch
            self.cursor_store.begin_batch(stream_id, start_ledger)
            
            # Backfill by fetching operations in reverse chronological order
            # (newest first, then work backwards)
            current_cursor = None
            operations_processed = 0
            last_operation_id = None
            last_ledger = start_ledger
            found_older_operations = True
            
            while (max_operations is None or operations_processed < max_operations) and found_older_operations:
                # Fetch operations page (newest first)
                records, next_cursor = self._fetch_operations_with_retry(
                    account_id=account_id,
                    cursor=current_cursor,
                    limit=self.batch_size,
                )
                
                if not records:
                    found_older_operations = False
                    break
                
                # Process operations in reverse order (oldest first for backfill)
                records_reversed = list(reversed(records))
                
                with self.db_service.get_session() as session:
                    for raw_op in records_reversed:
                        # Check ledger bounds
                        op_ledger = raw_op.get("ledger", 0)
                        if op_ledger < start_ledger:
                            found_older_operations = False
                            break
                        
                        if end_ledger and op_ledger > end_ledger:
                            continue
                        
                        stats.operations_processed += 1
                        
                        # Parse operation
                        op = self._parse_operation(raw_op)
                        if not op:
                            stats.operations_failed += 1
                            continue
                        
                        # Check if operation is already processed
                        if op.id in self._operation_cache:
                            stats.operations_duplicate += 1
                            continue
                        
                        # Persist operation
                        if self._persist_operation(session, op):
                            stats.operations_ingested += 1
                            last_operation_id = op.id
                            last_ledger = max(last_ledger, op.ledger)
                            self._operation_cache.add(op.id)
                        else:
                            stats.operations_duplicate += 1
                        
                        # Update cursor periodically
                        if stats.operations_ingested % 50 == 0:
                            session.commit()
                            logger.debug(
                                f"Backfilled {stats.operations_ingested} operations, "
                                f"last_ledger={last_ledger}"
                            )
                
                # Update cursor for this batch
                current_cursor = next_cursor
                operations_processed = stats.operations_processed
                
                # Check if we've hit the limit
                if max_operations and operations_processed >= max_operations:
                    logger.info(f"Reached max operations limit: {max_operations}")
                    break
                
                # If no next cursor, we're done
                if not next_cursor:
                    found_older_operations = False
                    break
            
            # Commit progress
            if last_ledger > start_ledger:
                self.cursor_store.advance(
                    stream_id=stream_id,
                    new_ledger=last_ledger,
                    last_event_id=last_operation_id,
                )
            
            stats.end_ledger = last_ledger
            stats.end_time = datetime.now(timezone.utc)
            
            logger.info(
                f"Backfill completed: "
                f"processed={stats.operations_processed}, "
                f"ingested={stats.operations_ingested}, "
                f"duplicates={stats.operations_duplicate}, "
                f"failed={stats.operations_failed}, "
                f"ledger_range={stats.start_ledger}->{stats.end_ledger}"
            )
            
            return stats
            
        except Exception as e:
            # Rollback on error
            logger.error(f"Backfill failed: {e}")
            self.cursor_store.rollback_to_safe_point(
                stream_id=stream_id,
                error_message=str(e),
            )
            stats.end_time = datetime.now(timezone.utc)
            raise
    
    def get_ingestion_status(self, account_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Get the current ingestion status for an account.
        
        Args:
            account_id: Optional account ID
            
        Returns:
            Status dictionary with cursor information
        """
        stream_id = self._get_stream_id(account_id)
        cursor = self.cursor_store.get_cursor(stream_id)
        
        if cursor:
            return {
                "stream_id": stream_id,
                "last_ingested_ledger": cursor.get("last_ingested_ledger", 0),
                "safe_ledger": cursor.get("safe_ledger", 0),
                "last_event_id": cursor.get("last_event_id"),
                "status": cursor.get("status", "idle"),
                "error_message": cursor.get("error_message"),
                "updated_at": cursor.get("updated_at"),
            }
        
        return {
            "stream_id": stream_id,
            "status": "not_initialized",
            "message": "No cursor found for this stream",
        }
    
    def reset_cursor(
        self,
        account_id: Optional[str] = None,
        ledger: int = 0,
    ) -> bool:
        """
        Reset the ingestion cursor for an account.
        
        Warning: This will cause re-ingestion of operations.
        
        Args:
            account_id: Optional account ID
            ledger: Ledger to reset to (default: 0)
            
        Returns:
            True if reset successful
        """
        stream_id = self._get_stream_id(account_id)
        
        try:
            # Ensure cursor exists
            self.cursor_store.get_or_create(stream_id)

            # Reset to specified ledger
            self.cursor_store.advance(
                stream_id=stream_id,
                new_ledger=ledger,
                last_event_id=None,
            )
            
            logger.warning(f"Reset cursor for {stream_id} to ledger {ledger}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to reset cursor for {stream_id}: {e}")
            return False
    
    def get_account_operations(
        self,
        account_id: str,
        limit: int = 100,
        from_ledger: Optional[int] = None,
        to_ledger: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """
        Get account operations from the database.
        
        Args:
            account_id: Account ID to query
            limit: Maximum number of operations
            from_ledger: Starting ledger
            to_ledger: Ending ledger
            
        Returns:
            List of operation dictionaries
        """
        with self.db_service.get_session() as session:
            query = session.query(RawSorobanEvent).filter(
                RawSorobanEvent.raw_payload["source_account"].as_string() == account_id
            )
            
            if from_ledger:
                query = query.filter(RawSorobanEvent.ledger >= from_ledger)
            
            if to_ledger:
                query = query.filter(RawSorobanEvent.ledger <= to_ledger)
            
            query = query.order_by(RawSorobanEvent.ledger.desc()).limit(limit)
            
            events = query.all()
            
            return [
                {
                    "operation_id": event.raw_payload.get("operation_id"),
                    "tx_id": event.raw_payload.get("tx_id"),
                    "operation_type": event.raw_payload.get("operation_type"),
                    "amount": event.raw_payload.get("amount"),
                    "asset_code": event.raw_payload.get("asset_code"),
                    "asset_issuer": event.raw_payload.get("asset_issuer"),
                    "to_account": event.raw_payload.get("to_account"),
                    "from_account": event.raw_payload.get("from_account"),
                    "ledger": event.ledger,
                    "created_at": event.raw_payload.get("created_at"),
                }
                for event in events
            ]


# Convenience functions
def ingest_account_operations(
    account_id: Optional[str] = None,
    from_ledger: Optional[int] = None,
    to_ledger: Optional[int] = None,
    max_operations: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Convenience function to ingest account operations.
    
    Args:
        account_id: Optional account ID to filter by
        from_ledger: Starting ledger for backfill
        to_ledger: Ending ledger for backfill
        max_operations: Maximum number of operations to ingest
        
    Returns:
        Ingestion statistics
    """
    ingestor = AccountOperationIngestor()
    
    if from_ledger is not None:
        stats = ingestor.backfill(
            account_id=account_id,
            from_ledger=from_ledger,
            to_ledger=to_ledger,
            max_operations=max_operations,
        )
    else:
        stats = ingestor.ingest_incremental(
            account_id=account_id,
            max_operations=max_operations,
        )
    
    return stats.to_dict()


def get_ingestion_status(account_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Get ingestion status for an account.
    
    Args:
        account_id: Optional account ID
        
    Returns:
        Status dictionary
    """
    ingestor = AccountOperationIngestor()
    return ingestor.get_ingestion_status(account_id)