"""
News Fetcher Service for cryptocurrency news.
Fetches data from external APIs and standardizes the format.
"""

import json
import os
import re
import time
import unicodedata
from dataclasses import dataclass, asdict
from datetime import datetime
from typing import Any, Dict, List, Optional
from .news_deduplicator import NewsDeduplicator
import requests
from requests.exceptions import RequestException, Timeout

try:
    from langdetect import DetectorFactory, LangDetectException, detect

    DetectorFactory.seed = 0
    LANGDETECT_AVAILABLE = True
except ImportError:
    LANGDETECT_AVAILABLE = False

    class LangDetectException(Exception):
        """Fallback exception when langdetect is unavailable."""

DEFAULT_TRANSLATION_API_URL = "https://libretranslate.de/translate"


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
    language: str = "en"
    translated: bool = False

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

        # Session for connection pooling
        self.session = requests.Session()
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

    def _handle_api_error(self, response: requests.Response, api_name: str) -> None:
        """Handle API errors and raise appropriate exceptions"""
        if response.status_code == 401:
            raise PermissionError(f"{api_name} API: Invalid API key")
        elif response.status_code == 429:
            raise ConnectionError(f"{api_name} API: Rate limit exceeded")
        elif response.status_code >= 500:
            raise ConnectionError(f"{api_name} API: Server error")
        else:
            response.raise_for_status()

    def _normalize_text(self, text: Optional[str]) -> str:
        """Normalize text for analytics ingestion."""
        if not text:
            return ""
        normalized = unicodedata.normalize("NFKC", text)
        normalized = re.sub(r"\s+", " ", normalized).strip()
        return normalized

    def _normalize_language_code(self, language: str) -> str:
        """Normalize language codes like en_US to en."""
        if not language or not isinstance(language, str):
            return "unknown"
        normalized = language.strip().lower().replace("_", "-")
        return normalized.split("-")[0]

    def _detect_script_language(self, text: str) -> Optional[str]:
        if re.search(r"[\u4e00-\u9fff]", text):
            return "zh"
        if re.search(r"[\u3040-\u30ff]", text):
            return "ja"
        if re.search(r"[\uac00-\ud7af]", text):
            return "ko"
        if re.search(r"[\u0400-\u04ff]", text):
            return "ru"
        if re.search(r"[\u0600-\u06ff]", text):
            return "ar"
        return None

    def _detect_language(self, text: str, hint: Optional[str] = None) -> str:
        """Detect the source language for an article."""
        if hint:
            return self._normalize_language_code(hint)

        if text and LANGDETECT_AVAILABLE:
            try:
                detected = detect(text)
                return self._normalize_language_code(detected)
            except LangDetectException:
                pass

        script_language = self._detect_script_language(text or "")
        if script_language:
            return script_language

        return "en"

    def _translate_text(self, text: str, source_lang: str) -> str:
        """Translate non-English text to English using a configurable endpoint."""
        if not text or source_lang == "en":
            return text

        translation_url = (
            os.getenv("TRANSLATION_API_URL", "").strip() or DEFAULT_TRANSLATION_API_URL
        )
        translation_key = os.getenv("TRANSLATION_API_KEY", "").strip()

        if not translation_url:
            return text

        payload = {
            "q": text,
            "source": source_lang,
            "target": "en",
            "format": "text",
        }
        headers = {"Content-Type": "application/json"}
        if translation_key:
            headers["Authorization"] = f"Bearer {translation_key}"

        try:
            response = self.session.post(
                translation_url,
                json=payload,
                headers=headers,
                timeout=APIConfig.TIMEOUT,
            )
            if response.status_code != 200:
                logger.warning(
                    "Translation API returned %s for source_lang=%s",
                    response.status_code,
                    source_lang,
                )
                return text

            data = response.json()
            return data.get("translatedText") or data.get("translation") or text
        except RequestException as exc:
            logger.warning("Translation request failed: %s", exc)
            return text
        except ValueError:
            logger.warning("Translation API returned invalid JSON")
            return text

    def _prepare_article_fields(
        self,
        title: str,
        content: Optional[str],
        summary: Optional[str],
        lang_hint: Optional[str] = None,
    ) -> Dict[str, Any]:
        title = title or ""
        content = content or ""
        summary = summary or ""

        source_language = self._detect_language(f"{title} {content}", hint=lang_hint)
        translated = False
        if source_language != "en":
            title = self._translate_text(title, source_language)
            content = self._translate_text(content, source_language)
            summary = self._translate_text(summary, source_language)
            translated = True

        return {
            "title": self._normalize_text(title),
            "content": self._normalize_text(content),
            "summary": self._normalize_text(summary),
            "language": source_language,
            "translated": translated,
        }

    def _fetch_cryptocompare(self, limit: int) -> List[NewsArticle]:
        """Fetch news from CryptoCompare API"""
        articles = []

        try:
            self._respect_rate_limit()

            params = {
                "categories": "BTC,ETH,BLOCKCHAIN",
                "excludeCategories": "Sponsored",
            }

            headers = {"Authorization": f"Apikey {self.cryptocompare_key}"}

            response = self.session.get(
                APIConfig.CRYPTOCOMPARE_URL,
                params=params,
                headers=headers,
                timeout=APIConfig.TIMEOUT,
            )

            if response.status_code != 200:
                self._handle_api_error(response, "CryptoCompare")

            data = response.json()

            if data.get("Type") != 100:
                raise ValueError(
                    f"CryptoCompare API returned error: {data.get('Message', 'Unknown error')}"
                )

            # Parse articles
            for item in data.get("Data", [])[:limit]:
                try:
                    parsed_fields = self._prepare_article_fields(
                        title=item.get("title", ""),
                        content=item.get("body", ""),
                        summary=item.get("short_description", ""),
                        lang_hint=item.get("lang") or item.get("language"),
                    )
                    article = NewsArticle(
                        id=f"cc_{item['id']}",
                        title=parsed_fields["title"],
                        content=parsed_fields["content"],
                        summary=parsed_fields["summary"],
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
                        language=parsed_fields["language"],
                        translated=parsed_fields["translated"],
                    )

                    # Avoid duplicates
                    if article.id not in self.seen_articles:
                        articles.append(article)
                        self.seen_articles.add(article.id)

                except KeyError as e:
                    print(f"Warning: Missing key in CryptoCompare data: {e}")
                    continue

        except RequestException as e:
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
                "sortBy": "publishedAt",
                "pageSize": min(limit, 100),  # NewsAPI max is 100
                "from": from_date.strftime("%Y-%m-%d"),
                "to": to_date.strftime("%Y-%m-%d"),
                "apiKey": self.newsapi_key,
            }

            response = self.session.get(
                APIConfig.NEWSAPI_URL, params=params, timeout=APIConfig.TIMEOUT
            )

            if response.status_code != 200:
                self._handle_api_error(response, "NewsAPI")

            data = response.json()

            # Parse articles
            for item in data.get("articles", [])[:limit]:
                try:
                    published_at = datetime.fromisoformat(
                        item["publishedAt"].replace("Z", "+00:00")
                    )

                    parsed_fields = self._prepare_article_fields(
                        title=item.get("title", ""),
                        content=item.get("content", ""),
                        summary=item.get("description", ""),
                        lang_hint=item.get("language") or item.get("lang"),
                    )
                    article = NewsArticle(
                        id=f"na_{hash(item['url']) & 0xFFFFFFFF}",
                        title=parsed_fields["title"],
                        content=parsed_fields["content"],
                        summary=parsed_fields["summary"],
                        source=item.get("source", {}).get("name", "Unknown"),
                        url=item.get("url", ""),
                        published_at=published_at,
                        categories=[
                            "crypto",
                            "blockchain",
                        ],  # NewsAPI doesn't provide categories
                        language=parsed_fields["language"],
                        translated=parsed_fields["translated"],
                    )

                    # Avoid duplicates
                    if article.id not in self.seen_articles:
                        articles.append(article)
                        self.seen_articles.add(article.id)

                except (KeyError, ValueError) as e:
                    print(f"Warning: Error parsing NewsAPI article: {e}")
                    continue

        except RequestException as e:
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
        """Close the session"""
        self.session.close()


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
