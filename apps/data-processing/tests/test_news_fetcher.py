"""
Unit tests for NewsFetcher service.
"""

import unittest
from unittest.mock import Mock, patch, MagicMock
import os
from datetime import datetime
from src.ingestion.news_fetcher import NewsFetcher, NewsArticle, fetch_news


class TestNewsFetcher(unittest.TestCase):
    """Test cases for NewsFetcher functionality"""

    def setUp(self):
        """Set up test environment"""
        # Set up mock environment variables
        os.environ["CRYPTOCOMPARE_API_KEY"] = "test_cryptocompare_key"
        os.environ["NEWSAPI_API_KEY"] = "test_newsapi_key"

        # Sample mock responses
        self.mock_cryptocompare_response = {
            "Type": 100,
            "Data": [
                {
                    "id": "12345",
                    "title": "Bitcoin Hits All-Time High",
                    "body": "Bitcoin reached new all-time high today...",
                    "short_description": "BTC reaches new ATH",
                    "source": "CryptoNews",
                    "url": "https://example.com/btc-ath",
                    "published_on": 1672531200,
                    "categories": "BTC|Market",
                    "tags": "Bitcoin|Price",
                }
            ],
        }

        self.mock_newsapi_response = {
            "status": "ok",
            "articles": [
                {
                    "title": "Ethereum Upgrade Successful",
                    "content": "Ethereum completed its latest upgrade...",
                    "description": "ETH upgrade goes smoothly",
                    "source": {"name": "CryptoInsider"},
                    "url": "https://example.com/eth-upgrade",
                    "publishedAt": "2023-01-01T12:00:00Z",
                }
            ],
        }

    def tearDown(self):
        """Clean up test environment"""
        # Clean up environment variables
        if "CRYPTOCOMPARE_API_KEY" in os.environ:
            del os.environ["CRYPTOCOMPARE_API_KEY"]
        if "NEWSAPI_API_KEY" in os.environ:
            del os.environ["NEWSAPI_API_KEY"]

    def test_initialization_missing_keys(self):
        """Test initialization fails without API keys"""
        # Remove environment variables
        if "CRYPTOCOMPARE_API_KEY" in os.environ:
            del os.environ["CRYPTOCOMPARE_API_KEY"]

        with self.assertRaises(ValueError):
            NewsFetcher(use_cryptocompare=True, use_newsapi=False)

    @patch("src.ingestion.news_fetcher.RobustHTTPClient.get")
    def test_fetch_cryptocompare_success(self, mock_get):
        """Test successful fetch from CryptoCompare"""
        # Mock the response
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = self.mock_cryptocompare_response
        mock_get.return_value = mock_response

        fetcher = NewsFetcher(use_newsapi=False)
        articles = fetcher._fetch_cryptocompare(limit=5)

        self.assertEqual(len(articles), 1)
        self.assertEqual(articles[0].title, "Bitcoin Hits All-Time High")
        self.assertEqual(articles[0].source, "CryptoNews")

        # Verify API call was made correctly
        mock_get.assert_called_once()
        call_args = mock_get.call_args
        self.assertIn("Authorization", call_args[1]["headers"])
        self.assertEqual(
            call_args[1]["headers"]["Authorization"], "Apikey test_cryptocompare_key"
        )

        fetcher.close()

    @patch("src.ingestion.news_fetcher.RobustHTTPClient.get")
    def test_fetch_newsapi_success(self, mock_get):
        """Test successful fetch from NewsAPI"""
        # Mock the response
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = self.mock_newsapi_response
        mock_get.return_value = mock_response

        fetcher = NewsFetcher(use_cryptocompare=False)
        articles = fetcher._fetch_newsapi(limit=5)

        self.assertEqual(len(articles), 1)
        self.assertEqual(articles[0].title, "Ethereum Upgrade Successful")
        self.assertEqual(articles[0].source, "CryptoInsider")

        fetcher.close()

    # @patch('src.ingestion.news_fetcher.requests.Session.get')
    # def test_fetch_latest_combined(self, mock_get):
    #     """Test combined fetch from both APIs"""
    #     # Mock responses for both APIs
    #     mock_response = Mock()
    #     mock_response.status_code = 200
    #     mock_response.json.side_effect = [
    #         self.mock_cryptocompare_response,
    #         self.mock_newsapi_response
    #     ]
    #     mock_get.return_value = mock_response

    #     fetcher = NewsFetcher()
    #     articles = fetcher.fetch_latest(limit=10)

    #     self.assertEqual(len(articles), 2)

    #     # Check articles are in dictionary format
    #     self.assertIsInstance(articles, list)
    #     self.assertIsInstance(articles[0], dict)
    #     self.assertIn('title', articles[0])
    #     self.assertIn('published_at', articles[0])

    #     # Check sorting (newest first - mock dates would determine order)

    #     fetcher.close()

    # @patch('src.ingestion.news_fetcher.requests.Session.get')
    # def test_api_error_handling(self, mock_get):
    #     """Test error handling for API failures"""
    #     # Mock a failed response
    #     mock_response = Mock()
    #     mock_response.status_code = 429  # Rate limit
    #     mock_response.raise_for_status.side_effect = Exception("Rate limited")
    #     mock_get.return_value = mock_response

    #     fetcher = NewsFetcher(use_newsapi=False)

    #     # Should not raise exception, just return empty list
    #     articles = fetcher._fetch_cryptocompare(limit=5)

    #     self.assertEqual(len(articles), 0)

    #     fetcher.close()

    def test_invalid_limit(self):
        """Test validation of limit parameter"""
        fetcher = NewsFetcher(use_cryptocompare=False, use_newsapi=False)

        with self.assertRaises(ValueError):
            fetcher.fetch_latest(limit=0)

        with self.assertRaises(ValueError):
            fetcher.fetch_latest(limit=-5)

        fetcher.close()

    @patch("src.ingestion.news_fetcher.RobustHTTPClient.get")
    def test_duplicate_prevention(self, mock_get):
        """Test that duplicate articles are filtered"""
        # Mock same article twice
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "Type": 100,
            "Data": [
                self.mock_cryptocompare_response["Data"][0],
                self.mock_cryptocompare_response["Data"][0],  # Duplicate
            ],
        }
        mock_get.return_value = mock_response

        fetcher = NewsFetcher(use_newsapi=False)

        # First fetch
        articles1 = fetcher._fetch_cryptocompare(limit=5)
        self.assertEqual(len(articles1), 1)

        # Clear cache and fetch again
        fetcher.clear_cache()
        articles2 = fetcher._fetch_cryptocompare(limit=5)
        self.assertEqual(len(articles2), 1)

        fetcher.close()

    def test_news_article_dataclass(self):
        """Test NewsArticle dataclass functionality"""
        article = NewsArticle(
            id="test_123",
            title="Test Article",
            content="Test content",
            summary="Test summary",
            source="Test Source",
            url="https://example.com",
            published_at=datetime(2023, 1, 1, 12, 0, 0),
            categories=["crypto", "news"],
        )

        # Test to_dict conversion
        article_dict = article.to_dict()

        self.assertEqual(article_dict["title"], "Test Article")
        self.assertEqual(article_dict["source"], "Test Source")
        self.assertIn("published_at", article_dict)
        self.assertEqual(article_dict["published_at"], "2023-01-01T12:00:00")

    @patch("src.ingestion.news_fetcher.NewsFetcher")
    def test_convenience_function(self, mock_fetcher_class):
        """Test the fetch_news convenience function"""
        # Mock the fetcher instance
        mock_fetcher = Mock()
        mock_fetcher.fetch_latest.return_value = [{"title": "Test"}]
        mock_fetcher_class.return_value = mock_fetcher

        # Test the convenience function
        articles = fetch_news(limit=5)

        self.assertEqual(len(articles), 1)
        mock_fetcher.fetch_latest.assert_called_once_with(5)
        mock_fetcher.close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
