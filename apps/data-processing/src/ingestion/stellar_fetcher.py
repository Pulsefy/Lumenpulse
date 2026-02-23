"""
Stellar Blockchain Data Fetcher
Fetches historical transaction and volume data from Stellar Horizon API.
"""

import time
from typing import Dict, List, Optional, Tuple, Any
from datetime import datetime, timedelta
from dataclasses import dataclass
import json
import logging
from stellar_sdk import Server, Asset
from stellar_sdk.exceptions import NotFoundError, BadRequestError, ConnectionError as StellarConnectionError
from stellar_sdk.call_builder.call_builder_async import PaymentsCallBuilder
from src.utils.http_client import http_breaker
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type, before_sleep_log


@dataclass
class VolumeData:
    """Volume data for a specific asset over a time period"""

    asset_code: str
    asset_issuer: Optional[str]
    time_period_hours: int
    total_volume: float
    transaction_count: int
    start_time: datetime
    end_time: datetime
    volume_by_hour: Dict[str, float]  # hour -> volume

    def to_dict(self) -> Dict:
        """Convert to dictionary with serialized datetime"""
        return {
            "asset_code": self.asset_code,
            "asset_issuer": self.asset_issuer,
            "time_period_hours": self.time_period_hours,
            "total_volume": self.total_volume,
            "transaction_count": self.transaction_count,
            "start_time": self.start_time.isoformat(),
            "end_time": self.end_time.isoformat(),
            "volume_by_hour": self.volume_by_hour,
            "average_hourly_volume": (
                self.total_volume / self.time_period_hours
                if self.time_period_hours > 0
                else 0
            ),
        }


@dataclass
class TransactionRecord:
    """Individual transaction record"""

    id: str
    hash: str
    created_at: datetime
    source_account: str
    operation_count: int
    total_amount: float
    fee_charged: float
    memo: Optional[str]
    successful: bool

    def to_dict(self) -> Dict:
        """Convert to dictionary"""
        return {
            "id": self.id,
            "hash": self.hash,
            "created_at": self.created_at.isoformat(),
            "source_account": self.source_account,
            "operation_count": self.operation_count,
            "total_amount": self.total_amount,
            "fee_charged": self.fee_charged,
            "memo": self.memo,
            "successful": self.successful,
        }


class StellarDataFetcher:
    """
    Fetches on-chain data from Stellar blockchain via Horizon API.

    Features:
    - Fetch volume data for specific assets
    - Handle pagination for large datasets
    - Aggregate data by time periods
    - Error handling and retry logic
    """

    # Default Horizon servers (public instances)
    HORIZON_SERVERS = [
        "https://horizon.stellar.org",  # Mainnet - Stellar Development Foundation
        "https://horizon-testnet.stellar.org",  # Testnet
    ]

    # Rate limiting
    MAX_RETRIES = 3
    RETRY_DELAY = 1  # seconds
    REQUEST_TIMEOUT = 30  # seconds

    logger = logging.getLogger(__name__)

    def __init__(
        self,
        horizon_url: Optional[str] = None,
        network: str = "public",
        timeout: Optional[float] = None,
    ):
        """
        Initialize Stellar data fetcher.

        Args:
            horizon_url: Custom Horizon server URL (optional)
            network: 'public' for mainnet, 'testnet' for testnet
        """
        if horizon_url:
            self.horizon_url = horizon_url
        else:
            if network == "testnet":
                self.horizon_url = self.HORIZON_SERVERS[1]
            else:
                self.horizon_url = self.HORIZON_SERVERS[0]

        print(f"Connecting to Horizon server: {self.horizon_url}")

        # Initialize Stellar SDK server
        self.timeout = timeout if timeout is not None else self.REQUEST_TIMEOUT
        self.server = Server(horizon_url=self.horizon_url, timeout=self.timeout)

        # Cache for recent requests
        self.cache = {}
        self.cache_ttl = 300  # 5 minutes

    def _handle_pagination(self, callable_func, *args, **kwargs) -> List[Dict]:
        """
        Handle pagination for Horizon API responses.

        Args:
            callable_func: Function that returns a pageable response
            *args, **kwargs: Arguments for the function

        Returns:
            List of all records across all pages
        """
        records = []
        cursor = None
        page_count = 0
        max_pages = 100  # Safety limit

        try:
            while page_count < max_pages:
                # Build query parameters
                query_params = kwargs.copy()
                if cursor:
                    query_params["cursor"] = cursor

                # Make the request
                if "call" in dir(callable_func):
                    # If it's a call builder object
                    response = callable_func.call()
                else:
                    # If it's a regular function
                    response = callable_func(*args, **query_params)

                # Get records from this page
                page_records = response["_embedded"]["records"]
                records.extend(page_records)

                # Check if there are more pages
                links = response["_links"]
                if "next" in links and "href" in links["next"]:
                    # Extract cursor from next URL
                    next_url = links["next"]["href"]
                    if "cursor=" in next_url:
                        cursor = next_url.split("cursor=")[1].split("&")[0]
                    else:
                        break  # No more pages
                else:
                    break

                page_count += 1

                # Small delay to be nice to the API
                time.sleep(0.1)

        except (StellarConnectionError, BadRequestError) as e:
            print(f"Error during pagination: {e}")
        except Exception as e:
            print(f"Unexpected error during pagination: {e}")

        return records

    def _retry_request(self, func, *args, **kwargs):
        """
        Robust retry logic for failed requests using tenacity and circuit breaker.
        """

        @retry(
            stop=stop_after_attempt(self.MAX_RETRIES),
            wait=wait_exponential(multiplier=1, min=2, max=10),
            retry=retry_if_exception_type(
                (StellarConnectionError, BadRequestError, Exception)
            ),
            before_sleep=before_sleep_log(self.logger, logging.WARNING),
            reraise=True,
        )
        def _do_execute():
            return http_breaker.call(func, *args, **kwargs)

        return _do_execute()

    def get_asset_volume(self, asset_code: str, hours: int = 24) -> VolumeData:
        """
        Get trading volume for a specific asset over the last N hours.

        Args:
            asset_code: Asset code (e.g., 'XLM', 'USDC')
            hours: Number of hours to look back

        Returns:
            VolumeData object with aggregated volume information
        """
        # Generate cache key
        cache_key = f"volume_{asset_code}_{hours}_{datetime.now().strftime('%Y%m%d%H')}"

        # Check cache
        if cache_key in self.cache:
            cached_time, cached_data = self.cache[cache_key]
            if time.time() - cached_time < self.cache_ttl:
                print(f"Returning cached data for {asset_code} (last {hours}h)")
                return cached_data

        print(f"Fetching volume data for {asset_code} (last {hours}h)...")

        end_time = datetime.now()
        start_time = end_time - timedelta(hours=hours)

        # Initialize volume tracking
        total_volume = 0.0
        transaction_count = 0
        volume_by_hour = {f"hour_{i}": 0.0 for i in range(hours)}

        try:
            # For XLM (native asset)
            if asset_code == "XLM":
                # Get payments (XLM transactions)
                payments = self._get_payments_for_period(
                    start_time, end_time, asset_code="native"
                )

                for payment in payments:
                    try:
                        amount = float(payment.get("amount", "0"))
                        if amount > 0:
                            total_volume += amount
                            transaction_count += 1

                            # Add to hourly bucket
                            created_at = datetime.fromisoformat(
                                payment["created_at"].replace("Z", "+00:00")
                            )
                            hours_ago = int(
                                (end_time - created_at).total_seconds() / 3600
                            )
                            if 0 <= hours_ago < hours:
                                volume_by_hour[f"hour_{hours_ago}"] += amount

                    except (KeyError, ValueError) as e:
                        print(f"Error processing payment: {e}")
                        continue

            else:
                # For other assets, we need to look at trades and path payments
                # This is a simplified approach - in production you'd want more sophisticated logic
                trades = self._get_trades_for_asset(asset_code, start_time, end_time)

                for trade in trades:
                    try:
                        # Check if this is buying or selling our target asset
                        base_asset = trade.get("base_asset_code")
                        counter_asset = trade.get("counter_asset_code")

                        if base_asset == asset_code:
                            amount = float(trade.get("base_amount", "0"))
                        elif counter_asset == asset_code:
                            amount = float(trade.get("counter_amount", "0"))
                        else:
                            continue

                        if amount > 0:
                            total_volume += amount
                            transaction_count += 1

                            # Add to hourly bucket
                            ledger_close_time = datetime.fromisoformat(
                                trade["ledger_close_time"].replace("Z", "+00:00")
                            )
                            hours_ago = int(
                                (end_time - ledger_close_time).total_seconds() / 3600
                            )
                            if 0 <= hours_ago < hours:
                                volume_by_hour[f"hour_{hours_ago}"] += amount

                    except (KeyError, ValueError) as e:
                        print(f"Error processing trade: {e}")
                        continue

            # Create VolumeData object
            volume_data = VolumeData(
                asset_code=asset_code,
                asset_issuer=None,  # Native XLM has no issuer, for others we'd need issuer info
                time_period_hours=hours,
                total_volume=total_volume,
                transaction_count=transaction_count,
                start_time=start_time,
                end_time=end_time,
                volume_by_hour=volume_by_hour,
            )

            # Cache the result
            self.cache[cache_key] = (time.time(), volume_data)

            return volume_data

        except Exception as e:
            print(f"Error fetching volume for {asset_code}: {e}")
            import traceback

            traceback.print_exc()

            # Return empty volume data on error
            return VolumeData(
                asset_code=asset_code,
                asset_issuer=None,
                time_period_hours=hours,
                total_volume=0.0,
                transaction_count=0,
                start_time=start_time,
                end_time=end_time,
                volume_by_hour={f"hour_{i}": 0.0 for i in range(hours)},
            )

    def _get_payments_for_period(
        self, start_time: datetime, end_time: datetime, asset_code: str = "native"
    ) -> List[Dict]:
        """
        Get payments for a specific asset within a time period.

        Args:
            start_time: Start of time period
            end_time: End of time period
            asset_code: Asset code or 'native' for XLM

        Returns:
            List of payment records
        """
        payments = []

        try:
            # Build query
            payments_call = self.server.payments().order(desc=False).limit(200)

            # For XLM (native asset)
            if asset_code == "native":
                payments_call = payments_call.for_asset(Asset.native())
            # Note: For other assets, we'd need the issuer as well

            # Get payments with pagination
            records = self._retry_request(self._handle_pagination, payments_call)

            # Filter by time
            for payment in records:
                try:
                    created_at = datetime.fromisoformat(
                        payment["created_at"].replace("Z", "+00:00")
                    )
                    if start_time <= created_at <= end_time:
                        payments.append(payment)
                    elif created_at > end_time:
                        # Since we're ordering ascending, we can break early
                        pass

                except (KeyError, ValueError) as e:
                    print(f"Error parsing payment timestamp: {e}")
                    continue

        except Exception as e:
            print(f"Error getting payments: {e}")

        return payments

    def _get_trades_for_asset(
        self, asset_code: str, start_time: datetime, end_time: datetime
    ) -> List[Dict]:
        """
        Get trades involving a specific asset.

        Args:
            asset_code: Asset code to filter by
            start_time: Start of time period
            end_time: End of time period

        Returns:
            List of trade records
        """
        trades = []

        try:
            # Get trades with pagination
            trades_call = self.server.trades().order(desc=False).limit(200)
            records = self._retry_request(self._handle_pagination, trades_call)

            # Filter by asset and time
            for trade in records:
                try:
                    base_asset = trade.get("base_asset_code")
                    counter_asset = trade.get("counter_asset_code")
                    ledger_close_time = datetime.fromisoformat(
                        trade["ledger_close_time"].replace("Z", "+00:00")
                    )

                    # Check if trade involves our asset and is within time period
                    if (
                        base_asset == asset_code or counter_asset == asset_code
                    ) and start_time <= ledger_close_time <= end_time:
                        trades.append(trade)

                except (KeyError, ValueError) as e:
                    print(f"Error parsing trade: {e}")
                    continue

        except Exception as e:
            print(f"Error getting trades: {e}")

        return trades

    def get_network_stats(self) -> Dict[str, Any]:
        """
        Get general Stellar network statistics.

        Returns:
            Dictionary with network metrics
        """
        try:
            # Get ledger stats
            ledgers_call = self.server.ledgers().order("desc").limit(1)
            ledgers = self._retry_request(ledgers_call.call)
            latest_ledger = (
                ledgers["_embedded"]["records"][0]
                if ledgers["_embedded"]["records"]
                else {}
            )

            # Get fee stats
            fee_stats = self._retry_request(self.server.fee_stats)

            return {
                "latest_ledger": latest_ledger.get("sequence", 0),
                "ledger_close_time": latest_ledger.get("closed_at", ""),
                "transaction_count": latest_ledger.get("transaction_count", 0),
                "operation_count": latest_ledger.get("operation_count", 0),
                "base_fee": fee_stats.get("last_ledger_base_fee", 0),
                "fee_pool": fee_stats.get("fee_charged", {}).get("max", 0),
                "protocol_version": latest_ledger.get("protocol_version", ""),
                "total_coins": latest_ledger.get("total_coins", "0"),
            }

        except Exception as e:
            print(f"Error getting network stats: {e}")
            return {}

    def get_account_transactions(
        self, account_id: str, limit: int = 100
    ) -> List[TransactionRecord]:
        """
        Get recent transactions for a specific account.

        Args:
            account_id: Stellar account ID
            limit: Maximum number of transactions to return

        Returns:
            List of TransactionRecord objects
        """
        transactions = []

        try:
            # Get transactions for account
            transactions_call = (
                self.server.transactions()
                .for_account(account_id)
                .order("desc")
                .limit(min(limit, 200))
            )
            records = self._retry_request(self._handle_pagination, transactions_call)

            for tx in records[:limit]:
                try:
                    transaction = TransactionRecord(
                        id=tx.get("id", ""),
                        hash=tx.get("hash", ""),
                        created_at=datetime.fromisoformat(
                            tx["created_at"].replace("Z", "+00:00")
                        ),
                        source_account=tx.get("source_account", ""),
                        operation_count=int(tx.get("operation_count", 0)),
                        total_amount=float(tx.get("fee_charged", 0))
                        * 0.0000001,  # Convert stroops to XLM
                        fee_charged=float(tx.get("fee_charged", 0)) * 0.0000001,
                        memo=tx.get("memo", ""),
                        successful=tx.get("successful", False),
                    )
                    transactions.append(transaction)

                except (KeyError, ValueError) as e:
                    print(f"Error parsing transaction: {e}")
                    continue

        except Exception as e:
            print(f"Error getting account transactions: {e}")

        return transactions

    def clear_cache(self):
        """Clear the request cache."""
        self.cache.clear()

    def test_connection(self) -> bool:
        """Test connection to Horizon server."""
        try:
            root = self._retry_request(self.server.root)
            return "horizon_version" in root
        except Exception as e:
            print(f"Connection test failed: {e}")
            return False


# Convenience functions
def get_asset_volume(asset_code: str = "XLM", hours: int = 24) -> Dict:
    """
    Convenience function to get asset volume.

    Args:
        asset_code: Asset code (default: 'XLM')
        hours: Hours to look back (default: 24)

    Returns:
        Dictionary with volume data
    """
    fetcher = StellarDataFetcher()
    try:
        volume_data = fetcher.get_asset_volume(asset_code, hours)
        return volume_data.to_dict()
    finally:
        fetcher.clear_cache()


def get_network_overview() -> Dict:
    """Get Stellar network overview."""
    fetcher = StellarDataFetcher()
    try:
        return fetcher.get_network_stats()
    finally:
        fetcher.clear_cache()
