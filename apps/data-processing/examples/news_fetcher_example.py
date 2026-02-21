"""
Example usage of NewsFetcher service.
"""

import os
import sys
from dotenv import load_dotenv

# Add parent directory to path
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

# Load environment variables from .env file
load_dotenv()

from src.ingestion.news_fetcher import fetch_news, NewsFetcher


def run_example():
    """Demonstrate NewsFetcher usage"""

    print("=" * 60)
    print("CRYPTO NEWS FETCHER EXAMPLE")
    print("=" * 60)

    # Method 1: Using convenience function
    print("\n1. USING CONVENIENCE FUNCTION:")
    print("-" * 40)

    try:
        articles = fetch_news(limit=3)

        if not articles:
            print("No articles fetched. Check API keys and internet connection.")
            print("Make sure you have set:")
            print("  - CRYPTOCOMPARE_API_KEY")
            print("  - NEWSAPI_API_KEY")
            print("\nYou can get free API keys from:")
            print(
                "  - CryptoCompare: https://www.cryptocompare.com/cryptopian/api-keys"
            )
            print("  - NewsAPI: https://newsapi.org/register")
            return

        for i, article in enumerate(articles, 1):
            print(f"\nArticle {i}:")
            print(f"  Title: {article['title']}")
            print(f"  Source: {article['source']}")
            print(f"  Published: {article['published_at']}")
            print(f"  URL: {article['url'][:50]}...")
            if article.get("summary"):
                print(f"  Summary: {article['summary'][:100]}...")

    except ValueError as e:
        print(f"Configuration error: {e}")
    except Exception as e:
        print(f"Error fetching news: {e}")

    # Method 2: Using class directly
    print("\n\n2. USING CLASS DIRECTLY:")
    print("-" * 40)

    try:
        # Initialize with only CryptoCompare (for example)
        fetcher = NewsFetcher(use_cryptocompare=True, use_newsapi=False)

        print("Fetching 2 articles from CryptoCompare...")
        articles = fetcher.fetch_latest(limit=2)

        for i, article in enumerate(articles, 1):
            print(f"\nArticle {i}:")
            print(f"  Title: {article['title']}")
            print(f"  Categories: {', '.join(article['categories'])}")

        fetcher.close()

    except ValueError as e:
        print(f"Initialization error: {e}")

    # Method 3: Error handling demonstration
    print("\n\n3. ERROR HANDLING DEMONSTRATION:")
    print("-" * 40)

    # Test with missing API key
    original_key = os.environ.get("CRYPTOCOMPARE_API_KEY")
    if original_key:
        # Temporarily remove key
        del os.environ["CRYPTOCOMPARE_API_KEY"]

        try:
            fetcher = NewsFetcher(use_cryptocompare=True, use_newsapi=False)
            print("ERROR: Should have raised ValueError!")
        except ValueError as e:
            print(f"Correctly caught error: {e}")

        # Restore key
        os.environ["CRYPTOCOMPARE_API_KEY"] = original_key

    print("\n" + "=" * 60)
    print("SETUP INSTRUCTIONS:")
    print("=" * 60)
    print("\n1. Get API Keys:")
    print("   - CryptoCompare: Free tier available")
    print("   - NewsAPI: Free tier available (100 requests/day)")

    print("\n2. Set Environment Variables:")
    print("   export CRYPTOCOMPARE_API_KEY='your_key_here'")
    print("   export NEWSAPI_API_KEY='your_key_here'")

    print("\n3. Or create a .env file:")
    print("   CRYPTOCOMPARE_API_KEY=your_key_here")
    print("   NEWSAPI_API_KEY=your_key_here")

    print("\n4. Install dependencies:")
    print("   pip install requests python-dotenv")


if __name__ == "__main__":
    run_example()
