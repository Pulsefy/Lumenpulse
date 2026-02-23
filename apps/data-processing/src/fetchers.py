"""
News fetcher module - fetches crypto/market news from various sources
"""

import logging
from datetime import datetime, timedelta
from typing import List, Dict, Any
from src.utils.http_client import RobustHTTPClient

logger = logging.getLogger(__name__)


class NewsItem:
    """Data class representing a news item"""

    def __init__(
        self, title: str, content: str, source: str, url: str, published_at: datetime
    ):
        self.title = title
        self.content = content
        self.source = source
        self.url = url
        self.published_at = published_at
        self.fetched_at = datetime.utcnow()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "title": self.title,
            "content": self.content,
            "source": self.source,
            "url": self.url,
            "published_at": self.published_at.isoformat(),
            "fetched_at": self.fetched_at.isoformat(),
        }


class NewsFetcher:
    """Fetches news from cryptocurrency and market sources"""

    def __init__(self):
        self.sources = {
            "crypto_news": "https://api.coingecko.com/api/v3/news",
            "mock_market": "https://jsonplaceholder.typicode.com/posts",
        }
        self.http_client = RobustHTTPClient()

    def fetch_crypto_news(self) -> List[NewsItem]:
        """Fetch crypto news from CoinGecko API"""
        try:
            response = self.http_client.get(self.sources["crypto_news"], timeout=10)
            data = response.json()

            news_items = []
            # CoinGecko news endpoint returns a 'data' array
            for article in data.get("data", [])[:10]:  # Limit to 10 articles
                try:
                    news_item = NewsItem(
                        title=article.get("title", ""),
                        content=article.get("description", article.get("title", "")),
                        source="CoinGecko",
                        url=article.get("url", ""),
                        published_at=(
                            datetime.fromisoformat(
                                article.get(
                                    "published_at", datetime.utcnow().isoformat()
                                ).replace("Z", "+00:00")
                            )
                            if article.get("published_at")
                            else datetime.utcnow()
                        ),
                    )
                    news_items.append(news_item)
                except Exception as e:
                    logger.warning(f"Error processing article: {e}")
                    continue

            logger.info(f"Fetched {len(news_items)} crypto news items")
            return news_items
        except Exception as e:
            logger.error(f"Error fetching crypto news: {e}")
            return []

    def fetch_market_news(self) -> List[NewsItem]:
        """Fetch market news from mock source"""
        try:
            response = self.http_client.get(self.sources["mock_market"], timeout=10)
            data = response.json()

            news_items = []
            for article in data[:10]:  # Limit to 10 articles
                news_item = NewsItem(
                    title=article.get("title", f"Post {article.get('id', 'N/A')}"),
                    content=article.get("body", ""),
                    source="Mock Market Feed",
                    url=f"https://example.com/news/{article.get('id')}",
                    published_at=datetime.utcnow()
                    - timedelta(hours=article.get("id", 1) % 24),
                )
                news_items.append(news_item)

            logger.info(f"Fetched {len(news_items)} market news items")
            return news_items
        except Exception as e:
            logger.error(f"Error fetching market news: {e}")
            return []

    def fetch_all_news(self) -> List[NewsItem]:
        """Fetch news from all sources"""
        crypto_news = self.fetch_crypto_news()
        market_news = self.fetch_market_news()

        all_news = crypto_news + market_news
        logger.info(f"Total news items fetched: {len(all_news)}")

        return all_news

    def close(self):
        """Close the HTTP client"""
        self.http_client.close()
