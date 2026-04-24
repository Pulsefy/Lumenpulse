"""
Social Media Fetcher Service for cryptocurrency sentiment analysis.
Fetches data from Twitter/X and Reddit APIs with proper rate limiting.
"""

import json
import logging
import math
import os
import re
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Dict, List, Optional

import requests
from requests.exceptions import RequestException

logger = logging.getLogger(__name__)


class SocialPlatform(Enum):
    """Supported social media platforms"""
    TWITTER = "twitter"
    REDDIT = "reddit"


@dataclass
class SocialPost:
    """
    Standardized social media post format.
    Normalizes data from different platforms (Twitter/X, Reddit).
    """
    id: str
    platform: str
    content: str
    author: str
    posted_at: datetime
    url: str
    # Engagement metrics
    likes: int = 0
    comments: int = 0
    shares: int = 0
    # Sentiment-related
    sentiment_score: Optional[float] = None
    # Platform-specific metadata
    hashtags: Optional[List[str]] = None
    subreddit: Optional[str] = None
    # Tracking
    fetched_at: datetime = None

    def __post_init__(self):
        if self.fetched_at is None:
            self.fetched_at = datetime.now(timezone.utc)
        if self.hashtags is None:
            self.hashtags = []

    def to_dict(self) -> Dict:
        """Convert to dictionary with serialized datetimes"""
        data = asdict(self)
        data["posted_at"] = self.posted_at.isoformat()
        data["fetched_at"] = self.fetched_at.isoformat() if self.fetched_at else None
        data["platform"] = self.platform
        return data

    def to_news_article_format(self) -> Dict:
        """
        Convert to NewsArticle-compatible format for sentiment pipeline.
        Allows social posts to flow through the existing sentiment analysis.
        """
        return {
            "id": f"social_{self.platform}_{self.id}",
            "title": self.content[:100] + "..." if len(self.content) > 100 else self.content,
            "content": self.content,
            "summary": self.content[:200] if len(self.content) > 200 else self.content,
            "source": f"{self.platform.title()} - {self.subreddit or 'feed'}",
            "url": self.url,
            "published_at": self.posted_at.isoformat(),
            "categories": self.hashtags or [],
            "tags": self.hashtags or [],
            "platform": self.platform,
            "author": self.author,
            "engagement": {
                "likes": self.likes,
                "comments": self.comments,
                "shares": self.shares,
            },
        }


class SocialAPIConfig:
    """Configuration for social media APIs"""

    # Twitter/X API v2 endpoints
    TWITTER_BASE_URL = "https://api.twitter.com/2"
    TWITTER_SEARCH_ENDPOINT = "/tweets/search/recent"

    # Reddit API endpoints (using JSON feed - no auth required for public subreddits)
    REDDIT_BASE_URL = "https://www.reddit.com"
    REDDIT_SUBREDDIT_ENDPOINT = "/r/{subreddit}/new.json"
    REDDIT_SEARCH_ENDPOINT = "/search.json"

    # Rate limiting (per platform)
    # Twitter: 450 requests/15min = 30/min for app auth
    TWITTER_RATE_LIMIT_DELAY = 2.0  # 2 seconds between requests (conservative)
    TWITTER_REQUESTS_PER_WINDOW = 450
    TWITTER_WINDOW_SECONDS = 900  # 15 minutes

    # Reddit: 60 requests/minute
    REDDIT_RATE_LIMIT_DELAY = 1.0  # 1 second between requests
    REDDIT_REQUESTS_PER_MINUTE = 60

    # Common settings
    MAX_RETRIES = 3
    TIMEOUT = 15
    RETRY_BACKOFF_BASE = 2

    # Target hashtags and subreddits for Stellar ecosystem
    DEFAULT_HASHTAGS = ["#Stellar", "#Soroban", "#XLM", "#StellarLumen", "#DeFi"]
    DEFAULT_SUBREDDITS = ["Stellar", "StellarLumen", "Soroban", "CryptoCurrency"]


class RateLimiter:
    """
    Token bucket rate limiter for API requests.
    Ensures we stay within API tier limits.
    """

    def __init__(self, requests_per_window: int, window_seconds: int, min_delay: float = 0):
        """
        Initialize rate limiter.

        Args:
            requests_per_window: Maximum requests allowed in the time window
            window_seconds: Time window in seconds
            min_delay: Minimum delay between requests (additional throttle)
        """
        self.requests_per_window = requests_per_window
        self.window_seconds = window_seconds
        self.min_delay = min_delay
        self.request_times: List[float] = []
        self.last_request_time = 0

    def wait_if_needed(self) -> float:
        """
        Wait if necessary to respect rate limits.

        Returns:
            Time waited in seconds
        """
        current_time = time.time()
        waited = 0.0

        # Ensure minimum delay between requests
        time_since_last = current_time - self.last_request_time
        if time_since_last < self.min_delay:
            wait_time = self.min_delay - time_since_last
            time.sleep(wait_time)
            waited += wait_time

        # Clean old requests from tracking
        cutoff_time = current_time - self.window_seconds
        self.request_times = [t for t in self.request_times if t > cutoff_time]

        # Check if we're at the rate limit
        if len(self.request_times) >= self.requests_per_window:
            # Wait until oldest request exits the window
            oldest = self.request_times[0]
            wait_until = oldest + self.window_seconds
            wait_time = wait_until - current_time
            if wait_time > 0:
                time.sleep(wait_time)
                waited += wait_time
                # Clean again after waiting
                self.request_times = [t for t in self.request_times if t > time.time() - self.window_seconds]

        # Record this request
        self.last_request_time = time.time()
        self.request_times.append(self.last_request_time)

        return waited


class TwitterFetcher:
    """
    Fetches tweets from Twitter/X API v2.
    Requires Bearer Token for API access.
    """

    def __init__(self, bearer_token: Optional[str] = None):
        """
        Initialize Twitter fetcher.

        Args:
            bearer_token: Twitter API Bearer Token (can be from env TWITTER_BEARER_TOKEN)
        """
        self.bearer_token = bearer_token or os.getenv("TWITTER_BEARER_TOKEN")
        if not self.bearer_token:
            logger.warning("TWITTER_BEARER_TOKEN not set. Twitter fetching will be disabled.")

        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {self.bearer_token}"
        })

        self.rate_limiter = RateLimiter(
            SocialAPIConfig.TWITTER_REQUESTS_PER_WINDOW,
            SocialAPIConfig.TWITTER_WINDOW_SECONDS,
            SocialAPIConfig.TWITTER_RATE_LIMIT_DELAY
        )

        self.enabled = bool(self.bearer_token)

    def fetch_hashtag(
        self,
        hashtag: str,
        limit: int = 50,
        since_id: Optional[str] = None
    ) -> List[SocialPost]:
        """
        Fetch recent tweets containing a hashtag.

        Args:
            hashtag: Hashtag to search (with or without #)
            limit: Maximum tweets to return
            since_id: Fetch tweets newer than this ID

        Returns:
            List of SocialPost objects
        """
        if not self.enabled:
            logger.warning("Twitter API not configured. Skipping Twitter fetch.")
            return []

        posts = []

        # Normalize hashtag
        query = hashtag if hashtag.startswith("#") else f"#{hashtag}"
        query = f"{query} -is:retweet lang:en"  # Exclude retweets, English only

        params = {
            "query": query,
            "max_results": min(limit, 100),  # Twitter max is 100 per request
            "tweet.fields": "created_at,public_metrics,entities,author_id",
            "expansions": "author_id",
            "user.fields": "username,name",
        }

        if since_id:
            params["since_id"] = since_id

        try:
            self.rate_limiter.wait_if_needed()

            response = self.session.get(
                f"{SocialAPIConfig.TWITTER_BASE_URL}{SocialAPIConfig.TWITTER_SEARCH_ENDPOINT}",
                params=params,
                timeout=SocialAPIConfig.TIMEOUT
            )

            if response.status_code == 429:
                logger.warning("Twitter rate limit exceeded. Waiting...")
                # Get reset time from header
                reset_time = int(response.headers.get("x-rate-limit-reset", time.time() + 900))
                wait_seconds = reset_time - time.time()
                if wait_seconds > 0:
                    time.sleep(wait_seconds)
                return self.fetch_hashtag(hashtag, limit, since_id)

            response.raise_for_status()
            data = response.json()

            # Parse tweets
            includes = data.get("includes", {})
            users_map = {u["id"]: u for u in includes.get("users", [])}

            for tweet in data.get("data", [])[:limit]:
                author_id = tweet.get("author_id", "")
                user = users_map.get(author_id, {})
                metrics = tweet.get("public_metrics", {})

                # Extract hashtags
                entities = tweet.get("entities", {})
                hashtags = [f"#{tag['tag']}" for tag in entities.get("hashtags", [])]

                post = SocialPost(
                    id=tweet["id"],
                    platform=SocialPlatform.TWITTER.value,
                    content=tweet.get("text", ""),
                    author=user.get("username", "unknown"),
                    posted_at=datetime.fromisoformat(tweet["created_at"].replace("Z", "+00:00")),
                    url=f"https://twitter.com/user/status/{tweet['id']}",
                    likes=metrics.get("like_count", 0),
                    comments=metrics.get("reply_count", 0),
                    shares=metrics.get("retweet_count", 0),
                    hashtags=hashtags,
                )
                posts.append(post)

            logger.info(f"Fetched {len(posts)} tweets for {hashtag}")

        except RequestException as e:
            logger.error(f"Error fetching Twitter data for {hashtag}: {e}")
        except (KeyError, json.JSONDecodeError) as e:
            logger.error(f"Error parsing Twitter response: {e}")

        return posts

    def fetch_multiple_hashtags(
        self,
        hashtags: List[str] = None,
        limit_per_hashtag: int = 25
    ) -> List[SocialPost]:
        """
        Fetch tweets for multiple hashtags.

        Args:
            hashtags: List of hashtags to search
            limit_per_hashtag: Max tweets per hashtag

        Returns:
            Combined list of SocialPosts
        """
        hashtags = hashtags or SocialAPIConfig.DEFAULT_HASHTAGS
        all_posts = []

        for hashtag in hashtags:
            posts = self.fetch_hashtag(hashtag, limit=limit_per_hashtag)
            all_posts.extend(posts)
            # Small delay between different hashtag searches
            time.sleep(0.5)

        return all_posts

    def close(self):
        """Close the session"""
        self.session.close()


class RedditFetcher:
    """
    Fetches posts from Reddit.
    Uses public JSON API (no auth required for public subreddits).
    """

    def __init__(self):
        """Initialize Reddit fetcher"""
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "LumenPulseSentimentBot/1.0 (cryptocurrency sentiment analysis)"
        })

        self.rate_limiter = RateLimiter(
            SocialAPIConfig.REDDIT_REQUESTS_PER_MINUTE,
            60,
            SocialAPIConfig.REDDIT_RATE_LIMIT_DELAY
        )

    def fetch_subreddit(
        self,
        subreddit: str,
        limit: int = 50,
        after: Optional[str] = None
    ) -> List[SocialPost]:
        """
        Fetch recent posts from a subreddit.

        Args:
            subreddit: Subreddit name (without r/)
            limit: Maximum posts to return
            after: Reddit fullname to fetch posts after

        Returns:
            List of SocialPost objects
        """
        posts = []

        url = f"{SocialAPIConfig.REDDIT_BASE_URL}{SocialAPIConfig.REDDIT_SUBREDDIT_ENDPOINT.format(subreddit=subreddit)}"

        params = {"limit": min(limit, 100)}
        if after:
            params["after"] = after

        try:
            self.rate_limiter.wait_if_needed()

            response = self.session.get(
                url,
                params=params,
                timeout=SocialAPIConfig.TIMEOUT
            )

            if response.status_code == 429:
                logger.warning("Reddit rate limit exceeded. Waiting...")
                time.sleep(60)
                return self.fetch_subreddit(subreddit, limit, after)

            response.raise_for_status()
            data = response.json()

            # Parse posts
            for child in data.get("data", {}).get("children", [])[:limit]:
                post_data = child.get("data", {})

                post = SocialPost(
                    id=post_data.get("id", ""),
                    platform=SocialPlatform.REDDIT.value,
                    content=post_data.get("selftext", "") or post_data.get("title", ""),
                    author=post_data.get("author", "[deleted]"),
                    posted_at=datetime.fromtimestamp(post_data.get("created_utc", time.time()), tz=timezone.utc),
                    url=f"https://reddit.com{post_data.get('permalink', '')}",
                    likes=post_data.get("ups", 0),
                    comments=post_data.get("num_comments", 0),
                    shares=post_data.get("num_crossposts", 0),
                    subreddit=post_data.get("subreddit", subreddit),
                    hashtags=self._extract_hashtags(post_data),
                )
                posts.append(post)

            logger.info(f"Fetched {len(posts)} posts from r/{subreddit}")

        except RequestException as e:
            logger.error(f"Error fetching Reddit data from r/{subreddit}: {e}")
        except (KeyError, json.JSONDecodeError) as e:
            logger.error(f"Error parsing Reddit response: {e}")

        return posts

    def fetch_search(
        self,
        query: str,
        subreddits: List[str] = None,
        limit: int = 50
    ) -> List[SocialPost]:
        """
        Search Reddit for specific terms.

        Args:
            query: Search query
            subreddits: Restrict to these subreddits
            limit: Maximum results

        Returns:
            List of SocialPost objects
        """
        posts = []

        params = {
            "q": query,
            "limit": min(limit, 100),
            "sort": "new",
            "type": "link"
        }

        if subreddits:
            params["restrict_sr"] = True
            params["sr"] = ",".join(subreddits)

        try:
            self.rate_limiter.wait_if_needed()

            response = self.session.get(
                f"{SocialAPIConfig.REDDIT_BASE_URL}{SocialAPIConfig.REDDIT_SEARCH_ENDPOINT}",
                params=params,
                timeout=SocialAPIConfig.TIMEOUT
            )

            response.raise_for_status()
            data = response.json()

            for child in data.get("data", {}).get("children", [])[:limit]:
                post_data = child.get("data", {})

                post = SocialPost(
                    id=post_data.get("id", ""),
                    platform=SocialPlatform.REDDIT.value,
                    content=post_data.get("selftext", "") or post_data.get("title", ""),
                    author=post_data.get("author", "[deleted]"),
                    posted_at=datetime.fromtimestamp(post_data.get("created_utc", time.time()), tz=timezone.utc),
                    url=f"https://reddit.com{post_data.get('permalink', '')}",
                    likes=post_data.get("ups", 0),
                    comments=post_data.get("num_comments", 0),
                    shares=post_data.get("num_crossposts", 0),
                    subreddit=post_data.get("subreddit", ""),
                )
                posts.append(post)

            logger.info(f"Fetched {len(posts)} Reddit posts for query: {query}")

        except RequestException as e:
            logger.error(f"Error searching Reddit: {e}")
        except (KeyError, json.JSONDecodeError) as e:
            logger.error(f"Error parsing Reddit search response: {e}")

        return posts

    def fetch_multiple_subreddits(
        self,
        subreddits: List[str] = None,
        limit_per_subreddit: int = 25
    ) -> List[SocialPost]:
        """
        Fetch posts from multiple subreddits.

        Args:
            subreddits: List of subreddit names
            limit_per_subreddit: Max posts per subreddit

        Returns:
            Combined list of SocialPosts
        """
        subreddits = subreddits or SocialAPIConfig.DEFAULT_SUBREDDITS
        all_posts = []

        for subreddit in subreddits:
            posts = self.fetch_subreddit(subreddit, limit=limit_per_subreddit)
            all_posts.extend(posts)
            # Small delay between subreddit fetches
            time.sleep(0.5)

        return all_posts

    def _extract_hashtags(self, post_data: Dict) -> List[str]:
        """Extract hashtags from Reddit post title and body"""
        hashtags = []
        text = f"{post_data.get('title', '')} {post_data.get('selftext', '')}"

        # Simple hashtag extraction
        hashtags = re.findall(r'#\w+', text)

        # Also add link flair as hashtag
        if post_data.get("link_flair_text"):
            hashtags.append(f"#{post_data['link_flair_text'].replace(' ', '')}")

        return list(set(hashtags))

    def close(self):
        """Close the session"""
        self.session.close()


class SocialFetcher:
    """
    Main social media fetcher that coordinates Twitter and Reddit fetching.
    Provides a unified interface for collecting social sentiment data.
    """

    def __init__(
        self,
        use_twitter: bool = True,
        use_reddit: bool = True,
        twitter_token: Optional[str] = None
    ):
        """
        Initialize SocialFetcher.

        Args:
            use_twitter: Enable Twitter/X fetching
            use_reddit: Enable Reddit fetching
            twitter_token: Twitter Bearer Token (optional, uses env)
        """
        self.use_twitter = use_twitter
        self.use_reddit = use_reddit

        # Initialize fetchers
        self.twitter = TwitterFetcher(bearer_token=twitter_token) if use_twitter else None
        self.reddit = RedditFetcher() if use_reddit else None

        # Deduplication tracking
        self.seen_post_ids: set = set()

    def fetch_all(
        self,
        hashtags: List[str] = None,
        subreddits: List[str] = None,
        limit_per_source: int = 25
    ) -> List[Dict]:
        """
        Fetch social posts from all configured sources.

        Args:
            hashtags: Twitter hashtags to search
            subreddits: Reddit subreddits to fetch
            limit_per_source: Max posts per source/hashtag/subreddit

        Returns:
            List of normalized post dictionaries
        """
        all_posts = []

        # Fetch from Twitter
        if self.twitter and self.use_twitter:
            twitter_posts = self.twitter.fetch_multiple_hashtags(
                hashtags=hashtags,
                limit_per_hashtag=limit_per_source
            )
            all_posts.extend(twitter_posts)

        # Fetch from Reddit
        if self.reddit and self.use_reddit:
            reddit_posts = self.reddit.fetch_multiple_subreddits(
                subreddits=subreddits,
                limit_per_subreddit=limit_per_source
            )
            all_posts.extend(reddit_posts)

        # Deduplicate and sort by date
        unique_posts = []
        for post in all_posts:
            post_id = f"{post.platform}_{post.id}"
            if post_id not in self.seen_post_ids:
                self.seen_post_ids.add(post_id)
                unique_posts.append(post)

        # Sort by posted_at (newest first)
        unique_posts.sort(key=lambda p: p.posted_at, reverse=True)

        logger.info(f"Total unique social posts: {len(unique_posts)}")

        return [post.to_dict() for post in unique_posts]

    def fetch_as_articles(
        self,
        hashtags: List[str] = None,
        subreddits: List[str] = None,
        limit_per_source: int = 25
    ) -> List[Dict]:
        """
        Fetch posts in NewsArticle-compatible format.
        Useful for feeding into existing sentiment analysis pipeline.

        Args:
            hashtags: Twitter hashtags to search
            subreddits: Reddit subreddits to fetch
            limit_per_source: Max posts per source

        Returns:
            List of posts in article-compatible format
        """
        posts = self.fetch_all(
            hashtags=hashtags,
            subreddits=subreddits,
            limit_per_source=limit_per_source
        )

        return [
            SocialPost(
                id=p["id"],
                platform=p["platform"],
                content=p["content"],
                author=p["author"],
                posted_at=datetime.fromisoformat(p["posted_at"].replace("Z", "+00:00")),
                url=p["url"],
                likes=p.get("likes", 0),
                comments=p.get("comments", 0),
                shares=p.get("shares", 0),
                hashtags=p.get("hashtags", []),
                subreddit=p.get("subreddit"),
            ).to_news_article_format()
            for p in posts
        ]

    def get_sentiment_weight(self, post: SocialPost) -> float:
        """
        Calculate sentiment weight based on engagement.
        Higher engagement = more weight for sentiment scoring.

        Args:
            post: SocialPost to weight

        Returns:
            Weight multiplier for sentiment scoring
        """
        # Base weight
        weight = 1.0

        # Engagement bonus (logarithmic scaling)
        total_engagement = post.likes + (post.comments * 2) + (post.shares * 3)
        if total_engagement > 0:
            weight += math.log10(total_engagement + 1) / 2  # Max ~0.5 bonus

        # Platform-specific weights
        if post.platform == SocialPlatform.REDDIT.value:
            # Reddit tends to have more detailed analysis
            weight *= 1.2

        return min(weight, 3.0)  # Cap at 3x

    def clear_cache(self):
        """Clear the seen post cache"""
        self.seen_post_ids.clear()

    def close(self):
        """Close all fetcher sessions"""
        if self.twitter:
            self.twitter.close()
        if self.reddit:
            self.reddit.close()


# Convenience function for easy usage
def fetch_social(
    hashtags: List[str] = None,
    subreddits: List[str] = None,
    limit_per_source: int = 25,
    use_twitter: bool = True,
    use_reddit: bool = True
) -> List[Dict]:
    """
    Convenience function to fetch social posts.

    Example:
        posts = fetch_social(
            hashtags=["#Stellar", "#Soroban"],
            subreddits=["Stellar"],
            limit_per_source=10
        )
        for post in posts:
            print(f"{post['platform']}: {post['content'][:50]}...")

    Args:
        hashtags: Twitter hashtags to search
        subreddits: Reddit subreddits to fetch
        limit_per_source: Max posts per source
        use_twitter: Enable Twitter fetching
        use_reddit: Enable Reddit fetching

    Returns:
        List of social post dictionaries
    """
    fetcher = SocialFetcher(use_twitter=use_twitter, use_reddit=use_reddit)
    try:
        return fetcher.fetch_all(
            hashtags=hashtags,
            subreddits=subreddits,
            limit_per_source=limit_per_source
        )
    finally:
        fetcher.close()
