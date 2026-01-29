"""
Example usage of StellarDataFetcher.
"""

import sys
import os
import time

# Add parent directory to path
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from src.ingestion.stellar_fetcher import (
    StellarDataFetcher,
    get_asset_volume,
    get_network_overview,
)


def run_example():
    """Demonstrate StellarDataFetcher usage"""

    print("=" * 60)
    print("STELLAR ON-CHAIN DATA FETCHER")
    print("=" * 60)

    # Method 1: Using convenience function
    print("\n1. GET ASSET VOLUME (Convenience Function):")
    print("-" * 40)

    try:
        print("Fetching XLM volume for last 24 hours...")
        volume_data = get_asset_volume("XLM", hours=24)

        print(f"\nXLM Volume Data:")
        print(f"  Asset: {volume_data['asset_code']}")
        print(f"  Time Period: {volume_data['time_period_hours']} hours")
        print(f"  Total Volume: {volume_data['total_volume']:,.2f} XLM")
        print(f"  Transactions: {volume_data['transaction_count']}")
        print(f"  Start Time: {volume_data['start_time']}")
        print(f"  End Time: {volume_data['end_time']}")

        # Show hourly breakdown for last 6 hours
        print(f"\nHourly Volume (last 6 hours):")
        for i in range(6):
            hour_key = f"hour_{i}"
            if hour_key in volume_data["volume_by_hour"]:
                print(f"  Hour {i}: {volume_data['volume_by_hour'][hour_key]:,.2f} XLM")

        print(
            f"\nAverage Hourly Volume: {volume_data.get('average_hourly_volume', 0):,.2f} XLM"
        )

    except Exception as e:
        print(f"Error fetching volume: {e}")

    # Method 2: Using class directly
    print("\n\n2. USING CLASS DIRECTLY:")
    print("-" * 40)

    try:
        # Initialize fetcher
        fetcher = StellarDataFetcher()

        # Test connection
        if fetcher.test_connection():
            print("✓ Connected to Stellar Horizon API")
        else:
            print("✗ Connection failed")
            return

        # Get network statistics
        print("\nFetching network statistics...")
        network_stats = fetcher.get_network_stats()

        if network_stats:
            print(f"\nNetwork Statistics:")
            print(f"  Latest Ledger: {network_stats.get('latest_ledger', 'N/A')}")
            print(
                f"  Ledger Close Time: {network_stats.get('ledger_close_time', 'N/A')}"
            )
            print(f"  Transaction Count: {network_stats.get('transaction_count', 0)}")
            print(f"  Operation Count: {network_stats.get('operation_count', 0)}")
            print(f"  Base Fee: {network_stats.get('base_fee', 0)} stroops")
            print(f"  Protocol Version: {network_stats.get('protocol_version', 'N/A')}")

        # Get volume for different time periods
        print("\n\n3. COMPARING VOLUME OVER DIFFERENT PERIODS:")
        print("-" * 40)

        time_periods = [1, 6, 24, 168]  # 1h, 6h, 24h, 7 days

        for hours in time_periods:
            print(f"\nFetching XLM volume for last {hours} hours...")
            volume_data = fetcher.get_asset_volume("XLM", hours=hours)

            print(f"  Total Volume: {volume_data.total_volume:,.2f} XLM")
            print(f"  Transactions: {volume_data.transaction_count}")
            print(
                f"  Avg/Hour: {volume_data.total_volume / hours if hours > 0 else 0:,.2f} XLM"
            )

            # Small delay between requests
            time.sleep(0.5)

        # Test with different assets (if available)
        print("\n\n4. TESTING WITH DIFFERENT ASSETS:")
        print("-" * 40)

        test_assets = ["XLM", "USDC", "BTC"]  # BTC might not exist on Stellar

        for asset in test_assets:
            print(f"\nFetching {asset} volume for last 1 hour...")
            try:
                volume_data = fetcher.get_asset_volume(asset, hours=1)
                if volume_data.total_volume > 0:
                    print(f"  Found {volume_data.total_volume:,.2f} {asset}")
                    print(f"  Transactions: {volume_data.transaction_count}")
                else:
                    print(f"  No {asset} transactions in last hour")
            except Exception as e:
                print(f"  Error fetching {asset}: {e}")

            time.sleep(0.5)

        # Get account transactions (example account)
        print("\n\n5. ACCOUNT TRANSACTIONS (Example):")
        print("-" * 40)

        # Example Stellar account (GDK... is a well-known test account)
        example_account = "GCKICEQ2SA3KWH3UMQFJE4BFXCBFHW46BCVJBRCLK76ZY5RO6TY5D7Q"

        print(f"Fetching transactions for account: {example_account[:8]}...")
        transactions = fetcher.get_account_transactions(example_account, limit=3)

        if transactions:
            print(f"\nFound {len(transactions)} recent transactions:")
            for i, tx in enumerate(transactions, 1):
                print(f"\n  Transaction {i}:")
                print(f"    Hash: {tx.hash[:16]}...")
                print(f"    Time: {tx.created_at.strftime('%Y-%m-%d %H:%M')}")
                print(f"    Amount: {tx.total_amount:.6f} XLM")
                print(f"    Operations: {tx.operation_count}")
                print(f"    Successful: {tx.successful}")
        else:
            print("No transactions found or account doesn't exist")

        # Clear cache
        fetcher.clear_cache()
        print("\nCache cleared.")

    except Exception as e:
        print(f"Error: {e}")
        import traceback

        traceback.print_exc()

    # Method 3: Network overview convenience function
    print("\n\n6. NETWORK OVERVIEW (Convenience Function):")
    print("-" * 40)

    try:
        overview = get_network_overview()
        if overview:
            print("\nStellar Network Overview:")
            for key, value in overview.items():
                print(f"  {key.replace('_', ' ').title()}: {value}")
    except Exception as e:
        print(f"Error getting network overview: {e}")

    print("\n" + "=" * 60)
    print("USAGE TIPS:")
    print("=" * 60)
    print("\n1. For production use:")
    print("   - Implement proper error handling")
    print("   - Add rate limiting based on your needs")
    print("   - Cache results to reduce API calls")
    print("   - Use async/await for better performance")

    print("\n2. Available Horizon servers:")
    print("   - Mainnet: https://horizon.stellar.org")
    print("   - Testnet: https://horizon-testnet.stellar.org")

    print("\n3. Integration with MarketAnalyzer:")
    print("   from src.ingestion.stellar_fetcher import get_asset_volume")
    print("   from src.analytics.market_analyzer import MarketAnalyzer")
    print("   ")
    print("   # Get volume change percentage")
    print("   volume_24h = get_asset_volume('XLM', 24)")
    print("   volume_48h = get_asset_volume('XLM', 48)")
    print("   ")
    print("   # Calculate percentage change")
    print("   if volume_48h['total_volume'] > 0:")
    print(
        "       change = ((volume_24h['total_volume'] - volume_48h['total_volume']) / "
    )
    print("                 volume_48h['total_volume']) * 100")
    print("   ")
    print("   # Use in MarketAnalyzer")
    print("   market_data = MarketData(sentiment_score=0.5, volume_change=change/100)")


if __name__ == "__main__":
    run_example()
