"""
Unit tests for SocialFetcher service.
"""

import os
import unittest
from datetime import datetime, timezone
from unittest.mock import patch
from src.ingestion.social_fetcher import (
    SocialFetcher,
    SocialPost,
    TwitterFetcher,
    RedditFetcher,
    RateLimiter,
    SocialPlatform,
    fetch_social,
)


class TestSocialPost(unittest.TestCase):
    """Test cases for SocialPost dataclass"""

    def test_social_post_creation(self):
        """Test creating a SocialPost with all fields"""
        post = SocialPost(
            id="test123",
            platform=SocialPlatform.TWITTER.value,
            content="Test tweet content #Stellar",
            author="testuser",
            posted_at=datetime(2024, 1, 1, 12, 0, 0, tzinfo=timezone.utc),
            url="https://twitter.com/test/status/123",
            likes=100,
            comments=10,
            shares=5,
            hashtags=["#Stellar"],
        )

        self.assertEqual(post.id, "test123")
        self.assertEqual(post.platform, "twitter")
        self.assertEqual(post.likes, 100)
        self.assertIsNotNone(post.fetched_at)

    def test_social_post_to_dict(self):
        """Test converting SocialPost to dictionary"""
        post = SocialPost(
            id="test456",
            platform=SocialPlatform.REDDIT.value,
            content="Test reddit post",
            author="reddituser",
            posted_at=datetime(2024, 1, 1, 12, 0, 0, tzinfo=timezone.utc),
            url="https://reddit.com/r/test/123",
            subreddit="Stellar",
        )

        data = post.to_dict()
        self.assertEqual(data["id"], "test456")
        self.assertEqual(data["platform"], "reddit")
        self.assertIn("posted_at", data)
        self.assertIsInstance(data["hashtags"], list)

    def test_social_post_to_news_article_format(self):
        """Test converting SocialPost to NewsArticle format"""
        post = SocialPost(
            id="test789",
            platform=SocialPlatform.TWITTER.value,
            content="Test content for conversion to news article format",
            author="testuser",
            posted_at=datetime(2024, 1, 1, 12, 0, 0, tzinfo=timezone.utc),
            url="https://twitter.com/test/status/789",
            hashtags=["#Stellar", "#XLM"],
        )

        article = post.to_news_article_format()
        self.assertIn("social_twitter_test789", article["id"])
        self.assertEqual(article["source"], "Twitter - feed")
        self.assertEqual(article["categories"], ["#Stellar", "#XLM"])
        self.assertIn("engagement", article)


class TestRateLimiter(unittest.TestCase):
    """Test cases for RateLimiter"""

    def test_rate_limiter_no_wait_needed(self):
        """Test rate limiter when no wait is needed"""
        limiter = RateLimiter(
            requests_per_window=10,
            window_seconds=60,
            min_delay=0
        )

        # First request should not wait
        waited = limiter.wait_if_needed()
        self.assertEqual(waited, 0.0)

    def test_rate_limiter_min_delay(self):
        """Test rate limiter respects minimum delay"""
        limiter = RateLimiter(
            requests_per_window=10,
            window_seconds=60,
            min_delay=0.1
        )

        limiter.wait_if_needed()
        # Second request should wait for min_delay
        waited = limiter.wait_if_needed()
        self.assertGreater(waited, 0)


class TestTwitterFetcher(unittest.TestCase):
    """Test cases for TwitterFetcher"""

    def setUp(self):
        """Set up test environment"""
        os.environ["TWITTER_BEARER_TOKEN"] = "test_bearer_token"

    def tearDown(self):
        """Clean up test environment"""
        if "TWITTER_BEARER_TOKEN" in os.environ:
            del os.environ["TWITTER_BEARER_TOKEN"]

    def test_twitter_fetcher_disabled_without_token(self):
        """Test Twitter fetcher is disabled when no token is set"""
        del os.environ["TWITTER_BEARER_TOKEN"]
        fetcher = TwitterFetcher()
        self.assertFalse(fetcher.enabled)

    def test_twitter_fetcher_enabled_with_token(self):
        """Test Twitter fetcher is enabled when token is set"""
        fetcher = TwitterFetcher(bearer_token="test_token")
        self.assertTrue(fetcher.enabled)
        fetcher.close()

    @patch("src.ingestion.social_fetcher.TwitterFetcher.fetch_hashtag")
    def test_fetch_multiple_hashtags(self, mock_fetch):
        """Test fetching multiple hashtags"""
        mock_fetch.return_value = [
            SocialPost(
                id="1",
                platform=SocialPlatform.TWITTER.value,
                content="Test",
                author="user",
                posted_at=datetime.now(timezone.utc),
                url="https://twitter.com/test/1",
            )
        ]

        fetcher = TwitterFetcher()
        posts = fetcher.fetch_multiple_hashtags(
            hashtags=["#Stellar", "#Soroban"],
            limit_per_hashtag=10
        )
        fetcher.close()

        self.assertEqual(len(posts), 2)  # One post per hashtag


class TestRedditFetcher(unittest.TestCase):
    """Test cases for RedditFetcher"""

    def setUp(self):
        """Set up test environment"""
        self.fetcher = RedditFetcher()

    def tearDown(self):
        """Clean up"""
        self.fetcher.close()

    def test_extract_hashtags(self):
        """Test hashtag extraction from Reddit post"""
        post_data = {
            "title": "Stellar is great #XLM #Stellar",
            "selftext": "More content #DeFi",
            "link_flair_text": "Discussion"
        }

        hashtags = self.fetcher._extract_hashtags(post_data)
        self.assertIn("#XLM", hashtags)
        self.assertIn("#Stellar", hashtags)
        self.assertIn("#DeFi", hashtags)
        self.assertIn("#Discussion", hashtags)

    def test_extract_hashtags_empty(self):
        """Test hashtag extraction with no hashtags"""
        post_data = {
            "title": "No hashtags here",
            "selftext": "Just plain text"
        }

        hashtags = self.fetcher._extract_hashtags(post_data)
        self.assertEqual(hashtags, [])


class TestSocialFetcher(unittest.TestCase):
    """Test cases for SocialFetcher"""

    def setUp(self):
        """Set up test environment"""
        os.environ["TWITTER_BEARER_TOKEN"] = "test_token"

    def tearDown(self):
        """Clean up test environment"""
        if "TWITTER_BEARER_TOKEN" in os.environ:
            del os.environ["TWITTER_BEARER_TOKEN"]

    def test_social_fetcher_initialization(self):
        """Test SocialFetcher initialization"""
        fetcher = SocialFetcher(use_twitter=True, use_reddit=True)
        self.assertIsNotNone(fetcher.twitter)
        self.assertIsNotNone(fetcher.reddit)
        fetcher.close()

    def test_social_fetcher_twitter_only(self):
        """Test SocialFetcher with Twitter only"""
        fetcher = SocialFetcher(use_twitter=True, use_reddit=False)
        self.assertIsNotNone(fetcher.twitter)
        self.assertIsNone(fetcher.reddit)
        fetcher.close()

    def test_social_fetcher_reddit_only(self):
        """Test SocialFetcher with Reddit only"""
        fetcher = SocialFetcher(use_twitter=False, use_reddit=True)
        self.assertIsNone(fetcher.twitter)
        self.assertIsNotNone(fetcher.reddit)
        fetcher.close()

    def test_get_sentiment_weight(self):
        """Test sentiment weight calculation"""
        fetcher = SocialFetcher()

        # Post with no engagement
        post_low = SocialPost(
            id="1",
            platform=SocialPlatform.TWITTER.value,
            content="Test",
            author="user",
            posted_at=datetime.now(timezone.utc),
            url="https://twitter.com/test/1",
            likes=0,
            comments=0,
            shares=0,
        )
        weight_low = fetcher.get_sentiment_weight(post_low)
        self.assertEqual(weight_low, 1.0)

        # Post with high engagement
        post_high = SocialPost(
            id="2",
            platform=SocialPlatform.TWITTER.value,
            content="Test",
            author="user",
            posted_at=datetime.now(timezone.utc),
            url="https://twitter.com/test/2",
            likes=1000,
            comments=100,
            shares=50,
        )
        weight_high = fetcher.get_sentiment_weight(post_high)
        self.assertGreater(weight_high, 1.0)

        fetcher.close()

    def test_reddit_platform_weight_bonus(self):
        """Test Reddit posts get higher weight"""
        fetcher = SocialFetcher()

        twitter_post = SocialPost(
            id="1",
            platform=SocialPlatform.TWITTER.value,
            content="Test",
            author="user",
            posted_at=datetime.now(timezone.utc),
            url="https://twitter.com/test/1",
            likes=100,
        )

        reddit_post = SocialPost(
            id="2",
            platform=SocialPlatform.REDDIT.value,
            content="Test",
            author="user",
            posted_at=datetime.now(timezone.utc),
            url="https://reddit.com/r/test/2",
            likes=100,
        )

        twitter_weight = fetcher.get_sentiment_weight(twitter_post)
        reddit_weight = fetcher.get_sentiment_weight(reddit_post)

        # Reddit should have 1.2x bonus
        self.assertGreater(reddit_weight, twitter_weight)

        fetcher.close()

    def test_clear_cache(self):
        """Test clearing the seen post cache"""
        fetcher = SocialFetcher()
        fetcher.seen_post_ids.add("twitter_123")
        fetcher.seen_post_ids.add("reddit_456")

        fetcher.clear_cache()
        self.assertEqual(len(fetcher.seen_post_ids), 0)

        fetcher.close()


class TestConvenienceFunction(unittest.TestCase):
    """Test cases for convenience function"""

    def setUp(self):
        """Set up test environment"""
        os.environ["TWITTER_BEARER_TOKEN"] = "test_token"

    def tearDown(self):
        """Clean up test environment"""
        if "TWITTER_BEARER_TOKEN" in os.environ:
            del os.environ["TWITTER_BEARER_TOKEN"]

    @patch("src.ingestion.social_fetcher.SocialFetcher.fetch_all")
    def test_fetch_social_function(self, mock_fetch):
        """Test the fetch_social convenience function"""
        mock_fetch.return_value = [
            {
                "id": "123",
                "platform": "twitter",
                "content": "Test tweet",
                "author": "user",
                "posted_at": "2024-01-01T12:00:00+00:00",
                "url": "https://twitter.com/test/123",
            }
        ]

        posts = fetch_social(
            hashtags=["#Stellar"],
            subreddits=["Stellar"],
            limit_per_source=10
        )

        self.assertEqual(len(posts), 1)
        self.assertEqual(posts[0]["platform"], "twitter")


if __name__ == "__main__":
    unittest.main()
