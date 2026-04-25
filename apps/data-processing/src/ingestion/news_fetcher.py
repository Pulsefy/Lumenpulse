import requests
import time
from typing import List, Dict, Set
from datetime import datetime
import json
from requests.exceptions import RequestException
from .server import correlation_id_ctx

class NewsArticle:
    def __init__(self, id, title, content, summary, source, url, published_at, categories=None, tags=None):
        self.id = id
        self.title = title
        self.content = content
        self.summary = summary
        self.source = source
        self.url = url
        self.published_at = published_at
        self.categories = categories or []
        self.tags = tags or []

    def to_dict(self):
        return {
            \"id\": self.id,
            \"title\": self.title,
            \"content\": self.content,
            \"summary\": self.summary,
            \"source\": self.source,
            \"url\": self.url,
            \"published_at\": self.published_at.isoformat(),
            \"categories\": self.categories,
            \"tags\": self.tags
        }

class APIConfig:
    CRYPTOCOMPARE_URL = \"https://min-api.cryptocompare.com/data/v2/news/\"
    NEWSAPI_URL = \"https://newsapi.org/v2/everything\"
    TIMEOUT = 10
    RATE_LIMIT_DELAY = 1.0  # seconds between requests

class NewsFetcher:
    def __init__(self, use_cryptocompare: bool = True, use_newsapi: bool = True):
        self.use_cryptocompare = use_cryptocompare
        self.use_newsapi = use_newsapi
        self.cryptocompare_key = \"\"  # Should be from env
        self.newsapi_key = \"\"        # Should be from env
        self.session = requests.Session()
        self.last_request_time = 0
        self.seen_articles: Set[str] = set()

    def _respect_rate_limit(self):
        elapsed = time.time() - self.last_request_time
        if elapsed < APIConfig.RATE_LIMIT_DELAY:
            time.sleep(APIConfig.RATE_LIMIT_DELAY - elapsed)
        self.last_request_time = time.time()

    def _handle_api_error(self, response, api_name):
        if response.status_code == 401:
            raise ConnectionError(f\"{api_name} API: Invalid API key\")
        elif response.status_code == 429:
            raise ConnectionError(f\"{api_name} API: Rate limit exceeded\")
        elif response.status_code >= 500:
            raise ConnectionError(f\"{api_name} API: Server error\")
        else:
            response.raise_for_status()

    def _fetch_cryptocompare(self, limit: int) -> List[NewsArticle]:
        \"\"\"Fetch news from CryptoCompare API\"\"\"
        articles = []

        try:
            self._respect_rate_limit()

            params = {
                \"lang\": \"EN\",
                \"categories\": \"BTC,ETH,BLOCKCHAIN\",
                \"excludeCategories\": \"Sponsored\",
            }

            headers = {
                \"Authorization\": f\"Apikey {self.cryptocompare_key}\",
                \"X-Request-Id\": correlation_id_ctx.get() or \"\"
            }

            response = self.session.get(
                APIConfig.CRYPTOCOMPARE_URL,
                params=params,
                headers=headers,
                timeout=APIConfig.TIMEOUT,
            )

            if response.status_code != 200:
                self._handle_api_error(response, \"CryptoCompare\")

            data = response.json()

            if data.get(\"Type\") != 100:
                raise ValueError(
                    f\"CryptoCompare API returned error: {data.get('Message', 'Unknown error')}\"
                )

            # Parse articles
            for item in data.get(\"Data\", [])[:limit]:
                try:
                    article = NewsArticle(
                        id=f\"cc_{item['id']}\",
                        title=item.get(\"title\", \"\"),
                        content=item.get(\"body\", \"\"),
                        summary=item.get(\"short_description\", \"\"),
                        source=item.get(\"source\", \"Unknown\"),
                        url=item.get(\"url\", \"\"),
                        published_at=datetime.fromtimestamp(
                            item.get(\"published_on\", 0)
                        ),
                        categories=(\n                            item.get(\"categories\", \"\").split(\"|\")\n                            if item.get(\"categories\")\n                            else []\n                        ),
                        tags=(\n                            item.get(\"tags\", \"\").split(\"|\") if item.get(\"tags\") else []\n                        ),
                    )

                    # Avoid duplicates
                    if article.id not in self.seen_articles:
                        articles.append(article)
                        self.seen_articles.add(article.id)

                except KeyError as e:
                    print(f\"Warning: Missing key in CryptoCompare data: {e}\")
                    continue

        except RequestException as e:
            print(f\"Error fetching from CryptoCompare: {e}\")
        except json.JSONDecodeError as e:
            print(f\"Error parsing CryptoCompare JSON: {e}\")

        return articles

    def _fetch_newsapi(self, limit: int) -> List[NewsArticle]:
        \"\"\"Fetch news from NewsAPI\"\"\"
        articles = []

        try:
            self._respect_rate_limit()

            # Calculate date range (last 7 days for recent news)
            to_date = datetime.now()
            from_date = datetime.fromtimestamp(to_date.timestamp() - (7 * 24 * 3600))

            params = {
                \"q\": \"cryptocurrency OR blockchain OR bitcoin OR ethereum\",
                \"language\": \"en\",\n                \"sortBy\": \"publishedAt\",\n                \"pageSize\": min(limit, 100),  # NewsAPI max is 100\n                \"from\": from_date.strftime(\"%Y-%m-%d\"),\n                \"to\": to_date.strftime(\"%Y-%m-%d\"),\n                \"apiKey\": self.newsapi_key,\n            }

            headers = {
                \"X-Request-Id\": correlation_id_ctx.get() or \"\"
            }

            response = self.session.get(
                APIConfig.NEWSAPI_URL, params=params, headers=headers, timeout=APIConfig.TIMEOUT
            )

            if response.status_code != 200:
                self._handle_api_error(response, \"NewsAPI\")

            data = response.json()

            # Parse articles
            for item in data.get(\"articles\", [])[:limit]:
                try:
                    published_at = datetime.fromisoformat(
                        item[\"publishedAt\"].replace(\"Z\", \"+00:00\")
                    )

                    article = NewsArticle(
                        id=f\"na_{hash(item['url']) & 0xFFFFFFFF}\",
                        title=item.get(\"title\", \"\"),
                        content=item.get(\"content\", \"\"),
                        summary=item.get(\"description\", \"\"),
                        source=item.get(\"source\", {}).get(\"name\", \"Unknown\"),
                        url=item.get(\"url\", \"\"),
                        published_at=published_at,
                        categories=[\n                            \"crypto\",\n                            \"blockchain\",\n                        ],  # NewsAPI doesn't provide categories
                    )

                    # Avoid duplicates
                    if article.id not in self.seen_articles:
                        articles.append(article)
                        self.seen_articles.add(article.id)

                except (KeyError, ValueError) as e:
                    print(f\"Warning: Error parsing NewsAPI article: {e}\")
                    continue

        except RequestException as e:
            print(f\"Error fetching from NewsAPI: {e}\")
        except json.JSONDecodeError as e:
            print(f\"Error parsing NewsAPI JSON: {e}\")

        return articles

    def fetch_latest(self, limit: int = 10) -> List[Dict]:
        \"\"\"\n        Fetch latest news articles from configured APIs.\n\n        Args:\n            limit: Maximum number of articles to return from each API\n\n        Returns:\n            List of standardized article dictionaries\n\n        Raises:\n            ConnectionError: If all APIs fail\n            ValueError: If invalid parameters provided\n        \"\"\"\n        if limit <= 0:\n            raise ValueError(\"Limit must be positive\")\n\n        all_articles = []\n\n        # Fetch from CryptoCompare\n        if self.use_cryptocompare:\n            articles = self._fetch_cryptocompare(limit)\n            all_articles.extend(articles)\n            print(f\"Fetched {len(articles)} articles from CryptoCompare\")\n\n        # Fetch from NewsAPI\n        if self.use_newsapi:\n            articles = self._fetch_newsapi(limit)\n            all_articles.extend(articles)\n            print(f\"Fetched {len(articles)} articles from NewsAPI\")\n\n        # Sort by publication date (newest first)\n        all_articles.sort(key=lambda x: x.published_at, reverse=True)\n\n        # Convert to dictionaries\n        articles_as_dicts = [article.to_dict() for article in all_articles]\n        \n        return articles_as_dicts[:limit]

    def close(self):\n        \"\"\"Close the session\"\"\"\n        self.session.close()\n