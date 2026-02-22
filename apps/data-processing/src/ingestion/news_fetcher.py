"""
News Fetcher Service for cryptocurrency news.
Fetches data from external APIs and standardizes the format.
"""

import os
import json
import time
from typing import List, Dict, Optional
from dataclasses import dataclass, asdict
from .news_deduplicator import NewsDeduplicator
from datetime import datetime
from src.utils.http_client import RobustHTTPClient


@dataclass
class NewsArticle:
    """Standardized news article format"""

    id: str
    title: str
    content: Optional[str]
    summary: Optional[str]
    source: str
    url: str
    published_at: datetime
    categories: List[str]
    sentiment_score: Optional[float] = None  # To be filled by sentiment engine
    tags: Optional[List[str]] = None

    def to_dict(self) -> Dict:
        """Convert to dictionary with serialized datetime"""
        data = asdict(self)
        data["published_at"] = self.published_at.isoformat()
        return data


class APIConfig:
    """Configuration for news APIs"""

    # API Endpoints
    CRYPTOCOMPARE_URL = "https://min-api.cryptocompare.com/data/v2/news/"
    NEWSAPI_URL = "https://newsapi.org/v2/everything"

    # Rate limiting
    RATE_LIMIT_DELAY = 1.0  # seconds between requests
    MAX_RETRIES = 3
    TIMEOUT = 10  # seconds


class NewsFetcher:
    """
    Fetches cryptocurrency news from multiple APIs.

    Environment Variables Required:
    - CRYPTOCOMPARE_API_KEY: API key for CryptoCompare
    - NEWSAPI_API_KEY: API key for NewsAPI
    """

    def __init__(self, use_cryptocompare: bool = True, use_newsapi: bool = True):
        """
        Initialize NewsFetcher with API keys from environment.

        Args:
            use_cryptocompare: Whether to use CryptoCompare API
            use_newsapi: Whether to use NewsAPI
        """
        self.use_cryptocompare = use_cryptocompare
        self.use_newsapi = use_newsapi

        # Load API keys from environment
        self.cryptocompare_key = os.getenv("CRYPTOCOMPARE_API_KEY")
        self.newsapi_key = os.getenv("NEWSAPI_API_KEY")

        # Validate API keys are available if services are enabled
        if use_cryptocompare and not self.cryptocompare_key:
            raise ValueError("CRYPTOCOMPARE_API_KEY environment variable not set")
        if use_newsapi and not self.newsapi_key:
            raise ValueError("NEWSAPI_API_KEY environment variable not set")

        # Use RobustHTTPClient for reliability
        self.http_client = RobustHTTPClient()
        self.last_request_time = 0

        # Cache for avoiding duplicate articles
        self.seen_articles = set()
        
        # Initialize deduplicator
        self.deduplicator = NewsDeduplicator(deduplication_window_days=7)

    def _respect_rate_limit(self):
        """Ensure we respect rate limits by delaying if needed"""
        current_time = time.time()
        time_since_last = current_time - self.last_request_time

        if time_since_last < APIConfig.RATE_LIMIT_DELAY:
            time.sleep(APIConfig.RATE_LIMIT_DELAY - time_since_last)

        self.last_request_time = time.time()

    # Removed _handle_api_error as RobustHTTPClient handles common cases

    def _fetch_cryptocompare(self, limit: int) -> List[NewsArticle]:
        """Fetch news from CryptoCompare API"""
        articles = []

        try:
            self._respect_rate_limit()

            params = {
                "lang": "EN",
                "categories": "BTC,ETH,BLOCKCHAIN",
                "excludeCategories": "Sponsored",
            }

            headers = {"Authorization": f"Apikey {self.cryptocompare_key}"}

            response = self.http_client.get(
                APIConfig.CRYPTOCOMPARE_URL,
                params=params,
                headers=headers,
                timeout=APIConfig.TIMEOUT,
            )

            # RobustHTTPClient raises for 5xx, we handle 401/429 specifically here if needed
            if response.status_code == 401:
                raise PermissionError("CryptoCompare API: Invalid API key")
            elif response.status_code == 429:
                print("Warning: CryptoCompare API Rate limit exceeded")
                return []

            data = response.json()

            if data.get("Type") != 100:
                raise ValueError(
                    f"CryptoCompare API returned error: {data.get('Message', 'Unknown error')}"
                )

            # Parse articles
            for item in data.get("Data", [])[:limit]:
                try:
                    article = NewsArticle(
                        id=f"cc_{item['id']}",
                        title=item.get("title", ""),
                        content=item.get("body", ""),
                        summary=item.get("short_description", ""),
                        source=item.get("source", "Unknown"),
                        url=item.get("url", ""),
                        published_at=datetime.fromtimestamp(
                            item.get("published_on", 0)
                        ),
                        categories=(
                            item.get("categories", "").split("|")
                            if item.get("categories")
                            else []
                        ),
                        tags=(
                            item.get("tags", "").split("|") if item.get("tags") else []
                        ),
                    )

                    # Avoid duplicates
                    if article.id not in self.seen_articles:
                        articles.append(article)
                        self.seen_articles.add(article.id)

                except KeyError as e:
                    print(f"Warning: Missing key in CryptoCompare data: {e}")
                    continue

        except Exception as e:
            print(f"Error fetching from CryptoCompare: {e}")
        except json.JSONDecodeError as e:
            print(f"Error parsing CryptoCompare JSON: {e}")

        return articles

    def _fetch_newsapi(self, limit: int) -> List[NewsArticle]:
        """Fetch news from NewsAPI"""
        articles = []

        try:
            self._respect_rate_limit()

            # Calculate date range (last 7 days for recent news)
            to_date = datetime.now()
            from_date = datetime.fromtimestamp(to_date.timestamp() - (7 * 24 * 3600))

            params = {
                "q": "cryptocurrency OR blockchain OR bitcoin OR ethereum",
                "language": "en",
                "sortBy": "publishedAt",
                "pageSize": min(limit, 100),  # NewsAPI max is 100
                "from": from_date.strftime("%Y-%m-%d"),
                "to": to_date.strftime("%Y-%m-%d"),
                "apiKey": self.newsapi_key,
            }

            response = self.http_client.get(
                APIConfig.NEWSAPI_URL, params=params, timeout=APIConfig.TIMEOUT
            )

            if response.status_code == 401:
                raise PermissionError("NewsAPI: Invalid API key")
            elif response.status_code == 429:
                print("Warning: NewsAPI Rate limit exceeded")
                return []
            elif response.status_code != 200:
                response.raise_for_status()

            data = response.json()

            # Parse articles
            for item in data.get("articles", [])[:limit]:
                try:
                    published_at = datetime.fromisoformat(
                        item["publishedAt"].replace("Z", "+00:00")
                    )

                    article = NewsArticle(
                        id=f"na_{hash(item['url']) & 0xffffffff}",
                        title=item.get("title", ""),
                        content=item.get("content", ""),
                        summary=item.get("description", ""),
                        source=item.get("source", {}).get("name", "Unknown"),
                        url=item.get("url", ""),
                        published_at=published_at,
                        categories=[
                            "crypto",
                            "blockchain",
                        ],  # NewsAPI doesn't provide categories
                    )

                    # Avoid duplicates
                    if article.id not in self.seen_articles:
                        articles.append(article)
                        self.seen_articles.add(article.id)

                except (KeyError, ValueError) as e:
                    print(f"Warning: Error parsing NewsAPI article: {e}")
                    continue

        except Exception as e:
            print(f"Error fetching from NewsAPI: {e}")
        except json.JSONDecodeError as e:
            print(f"Error parsing NewsAPI JSON: {e}")

        return articles

    def fetch_latest(self, limit: int = 10) -> List[Dict]:
        """
        Fetch latest news articles from configured APIs.

        Args:
            limit: Maximum number of articles to return from each API

        Returns:
            List of standardized article dictionaries

        Raises:
            ConnectionError: If all APIs fail
            ValueError: If invalid parameters provided
        """
        if limit <= 0:
            raise ValueError("Limit must be positive")

        all_articles = []

        # Fetch from CryptoCompare
        if self.use_cryptocompare:
            articles = self._fetch_cryptocompare(limit)
            all_articles.extend(articles)
            print(f"Fetched {len(articles)} articles from CryptoCompare")

        # Fetch from NewsAPI
        if self.use_newsapi:
            articles = self._fetch_newsapi(limit)
            all_articles.extend(articles)
            print(f"Fetched {len(articles)} articles from NewsAPI")

        # Sort by publication date (newest first)
        all_articles.sort(key=lambda x: x.published_at, reverse=True)

        # Convert to dictionaries
        articles_as_dicts = [article.to_dict() for article in all_articles]
        
        # Apply deduplication filter
        deduplicated_articles = self.deduplicator.filter_duplicates(articles_as_dicts)
        
        result = deduplicated_articles[:limit]

        if not result:
            print("Warning: No articles fetched from any API")

        return result

    def clear_cache(self):
        """Clear the cache of seen articles"""
        self.seen_articles.clear()

    def close(self):
        """Close the HTTP client"""
        self.http_client.close()


# Utility function for easy usage
def fetch_news(
    limit: int = 10, use_cryptocompare: bool = True, use_newsapi: bool = True
) -> List[Dict]:
    """
    Convenience function to fetch news.

    Example:
        articles = fetch_news(limit=5)
        for article in articles:
            print(f"{article['title']} - {article['source']}")
    """
    fetcher = NewsFetcher(use_cryptocompare=use_cryptocompare, use_newsapi=use_newsapi)
    try:
        return fetcher.fetch_latest(limit)
    finally:
        fetcher.close()
