"""
Property-based tests for database model protocol invariants.

These tests ensure that the database models maintain their core
invariant properties regardless of input data, preventing protocol violations.
"""

import pytest
from hypothesis import given, strategies as st, assume
from typing import Dict, Any, Optional, List
import sys
import os
from datetime import datetime, timezone

# Add src directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src"))

from db.models import Article, SocialPost, AnalyticsRecord, NewsInsight, AssetTrend


class TestArticleModelInvariants:
    """Property-based tests for Article database model invariants."""
    
    @given(
        article_id=st.text(min_size=1, max_size=255),
        title=st.text(min_size=1, max_size=500),
        content=st.text(min_size=0, max_size=10000),
        summary=st.text(min_size=0, max_size=1000),
        source=st.text(min_size=0, max_size=100),
        url=st.text(min_size=0, max_size=2000),
        primary_asset=st.text(min_size=0, max_size=20),
        sentiment_score=st.floats(min_value=-1.0, max_value=1.0),
        sentiment_label=st.sampled_from(["positive", "negative", "neutral"]),
        language=st.text(min_size=0, max_size=10)
    )
    def test_article_model_structure_invariant(
        self, article_id, title, content, summary, source, url, primary_asset, 
        sentiment_score, sentiment_label, language
    ):
        """
        INVARIANT: Article model must maintain structural integrity.
        
        The Article database model must preserve all field types and constraints
        to maintain data integrity invariants.
        """
        article = Article(
            article_id=article_id,
            title=title,
            content=content if content else None,
            summary=summary if summary else None,
            source=source if source else None,
            url=url if url else None,
            primary_asset=primary_asset if primary_asset else None,
            sentiment_score=sentiment_score,
            sentiment_label=sentiment_label,
            language=language if language else None
        )
        
        # Type invariants
        assert isinstance(article.article_id, str), "article_id must be string"
        assert isinstance(article.title, str), "title must be string"
        assert article.content is None or isinstance(article.content, str), "content must be string or None"
        assert article.summary is None or isinstance(article.summary, str), "summary must be string or None"
        assert article.source is None or isinstance(article.source, str), "source must be string or None"
        assert article.url is None or isinstance(article.url, str), "url must be string or None"
        assert article.primary_asset is None or isinstance(article.primary_asset, str), "primary_asset must be string or None"
        assert isinstance(article.sentiment_score, float), "sentiment_score must be float"
        assert isinstance(article.sentiment_label, str), "sentiment_label must be string"
        assert article.language is None or isinstance(article.language, str), "language must be string or None"
        
        # Value invariants
        assert -1.0 <= article.sentiment_score <= 1.0, "sentiment_score must be bounded"
        assert article.sentiment_label in ["positive", "negative", "neutral"], "sentiment_label must be valid"
        
        # Length invariants
        assert len(article.article_id) <= 255, "article_id must not exceed 255 characters"
        assert len(article.primary_asset or "") <= 20, "primary_asset must not exceed 20 characters"
        assert len(article.language or "") <= 10, "language must not exceed 10 characters"
    
    @given(
        article_id=st.text(min_size=1, max_size=255),
        title=st.text(min_size=1, max_size=500),
        sentiment_score=st.floats(min_value=-2.0, max_value=2.0)
    )
    def test_article_sentiment_bounds_invariant(self, article_id, title, sentiment_score):
        """
        INVARIANT: Article sentiment scores must always be within [-1, 1].
        
        The Article model must enforce sentiment score bounds
        to maintain data quality invariants.
        """
        # Only test if score is outside bounds
        assume(sentiment_score < -1.0 or sentiment_score > 1.0)
        
        # Create article with out-of-bounds score
        article = Article(
            article_id=article_id,
            title=title,
            sentiment_score=sentiment_score,
            sentiment_label="neutral"
        )
        
        # The model itself doesn't enforce bounds, but our invariants should catch violations
        # In a real implementation, you might add validation at the model level
        if not (-1.0 <= article.sentiment_score <= 1.0):
            # This indicates a potential protocol violation
            pytest.fail(f"Article sentiment score {article.sentiment_score} outside bounds [-1, 1]")
    
    @given(
        article_id=st.text(min_size=1, max_size=255),
        title=st.text(min_size=1, max_size=500),
        asset_codes=st.lists(st.text(min_size=1, max_size=20), min_size=0, max_size=50)
    )
    def test_article_asset_codes_invariant(self, article_id, title, asset_codes):
        """
        INVARIANT: Article asset codes must be a list of strings.
        
        The Article model must maintain asset codes as a proper list
        to maintain data structure invariants.
        """
        article = Article(
            article_id=article_id,
            title=title,
            asset_codes=asset_codes if asset_codes else None,
            sentiment_score=0.0,
            sentiment_label="neutral"
        )
        
        # Asset codes should be None or list
        assert article.asset_codes is None or isinstance(article.asset_codes, list), \
            "asset_codes must be None or list"
        
        if article.asset_codes is not None:
            for code in article.asset_codes:
                assert isinstance(code, str), f"Asset code {code} must be string"
                assert len(code.strip()) > 0, f"Asset code {code} cannot be empty"
    
    @given(
        article_id=st.text(min_size=1, max_size=255),
        title=st.text(min_size=1, max_size=500)
    )
    def test_article_timestamp_invariant(self, article_id, title):
        """
        INVARIANT: Article timestamps should be datetime objects.
        
        The Article model must maintain proper timestamp types
        to maintain temporal data invariants.
        """
        now = datetime.now(timezone.utc)
        
        article = Article(
            article_id=article_id,
            title=title,
            published_at=now,
            sentiment_score=0.0,
            sentiment_label="neutral"
        )
        
        # Timestamp should be datetime or None
        assert article.published_at is None or isinstance(article.published_at, datetime), \
            "published_at must be datetime or None"
        assert article.fetched_at is None or isinstance(article.fetched_at, datetime), \
            "fetched_at must be datetime or None"
        assert article.analyzed_at is None or isinstance(article.analyzed_at, datetime), \
            "analyzed_at must be datetime or None"
        assert isinstance(article.created_at, datetime), "created_at must be datetime"
        assert isinstance(article.updated_at, datetime), "updated_at must be datetime"


class TestSocialPostModelInvariants:
    """Property-based tests for SocialPost database model invariants."""
    
    @given(
        post_id=st.text(min_size=1, max_size=255),
        platform=st.sampled_from(["twitter", "reddit", "facebook", "instagram"]),
        content=st.text(min_size=1, max_size=2000),
        author=st.text(min_size=0, max_size=255),
        url=st.text(min_size=0, max_size=2000),
        likes=st.integers(min_value=0, max_value=1000000),
        comments=st.integers(min_value=0, max_value=100000),
        shares=st.integers(min_value=0, max_value=100000),
        primary_asset=st.text(min_size=0, max_size=20),
        sentiment_score=st.floats(min_value=-1.0, max_value=1.0),
        sentiment_label=st.sampled_from(["positive", "negative", "neutral"])
    )
    def test_social_post_model_structure_invariant(
        self, post_id, platform, content, author, url, likes, comments, shares,
        primary_asset, sentiment_score, sentiment_label
    ):
        """
        INVARIANT: SocialPost model must maintain structural integrity.
        
        The SocialPost database model must preserve all field types and constraints
        to maintain data integrity invariants.
        """
        post = SocialPost(
            post_id=post_id,
            platform=platform,
            content=content,
            author=author if author else None,
            url=url if url else None,
            likes=likes,
            comments=comments,
            shares=shares,
            primary_asset=primary_asset if primary_asset else None,
            sentiment_score=sentiment_score,
            sentiment_label=sentiment_label
        )
        
        # Type invariants
        assert isinstance(post.post_id, str), "post_id must be string"
        assert isinstance(post.platform, str), "platform must be string"
        assert isinstance(post.content, str), "content must be string"
        assert post.author is None or isinstance(post.author, str), "author must be string or None"
        assert post.url is None or isinstance(post.url, str), "url must be string or None"
        assert isinstance(post.likes, int), "likes must be integer"
        assert isinstance(post.comments, int), "comments must be integer"
        assert isinstance(post.shares, int), "shares must be integer"
        assert post.primary_asset is None or isinstance(post.primary_asset, str), "primary_asset must be string or None"
        assert isinstance(post.sentiment_score, float), "sentiment_score must be float"
        assert isinstance(post.sentiment_label, str), "sentiment_label must be string"
        
        # Value invariants
        assert post.platform in ["twitter", "reddit", "facebook", "instagram"], "platform must be valid"
        assert post.likes >= 0, "likes must be non-negative"
        assert post.comments >= 0, "comments must be non-negative"
        assert post.shares >= 0, "shares must be non-negative"
        assert -1.0 <= post.sentiment_score <= 1.0, "sentiment_score must be bounded"
        assert post.sentiment_label in ["positive", "negative", "neutral"], "sentiment_label must be valid"
        
        # Length invariants
        assert len(post.post_id) <= 255, "post_id must not exceed 255 characters"
        assert len(post.platform) <= 50, "platform must not exceed 50 characters"
        assert len(post.primary_asset or "") <= 20, "primary_asset must not exceed 20 characters"
    
    @given(
        post_id=st.text(min_size=1, max_size=255),
        platform=st.sampled_from(["twitter", "reddit"]),
        content=st.text(min_size=1, max_size=500),
        engagement_metrics=st.tuples(
            st.integers(min_value=-100, max_value=100),
            st.integers(min_value=-100, max_value=100),
            st.integers(min_value=-100, max_value=100)
        )
    )
    def test_social_post_engagement_invariant(self, post_id, platform, content, engagement_metrics):
        """
        INVARIANT: SocialPost engagement metrics must be non-negative.
        
        The SocialPost model must enforce non-negative engagement metrics
        to maintain data quality invariants.
        """
        likes, comments, shares = engagement_metrics
        
        # Only test if any metric is negative
        assume(likes < 0 or comments < 0 or shares < 0)
        
        post = SocialPost(
            post_id=post_id,
            platform=platform,
            content=content,
            likes=likes,
            comments=comments,
            shares=shares,
            sentiment_score=0.0,
            sentiment_label="neutral"
        )
        
        # Check for violations
        violations = []
        if post.likes < 0:
            violations.append(f"likes={post.likes}")
        if post.comments < 0:
            violations.append(f"comments={post.comments}")
        if post.shares < 0:
            violations.append(f"shares={post.shares}")
        
        if violations:
            pytest.fail(f"Negative engagement metrics detected: {', '.join(violations)}")


class TestAnalyticsRecordModelInvariants:
    """Property-based tests for AnalyticsRecord database model invariants."""
    
    @given(
        record_type=st.sampled_from(["sentiment_summary", "trend", "volume", "price"]),
        asset=st.text(min_size=0, max_size=50),
        metric_name=st.text(min_size=1, max_size=100),
        window=st.sampled_from(["1h", "24h", "7d", "30d"]),
        value=st.floats(min_value=-1e10, max_value=1e10),
        previous_value=st.floats(min_value=-1e10, max_value=1e10),
        trend_direction=st.sampled_from(["up", "down", "stable"])
    )
    def test_analytics_record_model_structure_invariant(
        self, record_type, asset, metric_name, window, value, previous_value, trend_direction
    ):
        """
        INVARIANT: AnalyticsRecord model must maintain structural integrity.
        
        The AnalyticsRecord database model must preserve all field types and constraints
        to maintain data integrity invariants.
        """
        record = AnalyticsRecord(
            record_type=record_type,
            asset=asset if asset else None,
            metric_name=metric_name,
            window=window,
            value=value,
            previous_value=previous_value,
            change_percentage=((value - previous_value) / previous_value * 100) if previous_value != 0 else None,
            trend_direction=trend_direction
        )
        
        # Type invariants
        assert isinstance(record.record_type, str), "record_type must be string"
        assert record.asset is None or isinstance(record.asset, str), "asset must be string or None"
        assert isinstance(record.metric_name, str), "metric_name must be string"
        assert record.window is None or isinstance(record.window, str), "window must be string or None"
        assert isinstance(record.value, float), "value must be float"
        assert record.previous_value is None or isinstance(record.previous_value, float), "previous_value must be float or None"
        assert record.change_percentage is None or isinstance(record.change_percentage, float), "change_percentage must be float or None"
        assert record.trend_direction is None or isinstance(record.trend_direction, str), "trend_direction must be string or None"
        
        # Value invariants
        assert record.record_type in ["sentiment_summary", "trend", "volume", "price"], "record_type must be valid"
        assert record.trend_direction in ["up", "down", "stable"], "trend_direction must be valid"
        assert record.window in ["1h", "24h", "7d", "30d"], "window must be valid"
        
        # Length invariants
        assert len(record.record_type) <= 50, "record_type must not exceed 50 characters"
        assert len(record.asset or "") <= 50, "asset must not exceed 50 characters"
        assert len(record.metric_name) <= 100, "metric_name must not exceed 100 characters"
        assert len(record.window or "") <= 20, "window must not exceed 20 characters"
    
    @given(
        record_type=st.sampled_from(["sentiment_summary", "trend"]),
        metric_name=st.text(min_size=1, max_size=100),
        value=st.floats(min_value=-1000, max_value=1000),
        previous_value=st.floats(min_value=-1000, max_value=1000)
    )
    def test_analytics_change_calculation_invariant(self, record_type, metric_name, value, previous_value):
        """
        INVARIANT: AnalyticsRecord change percentage should be calculated correctly.
        
        The AnalyticsRecord model must maintain correct change calculations
        to maintain analytical accuracy invariants.
        """
        assume(previous_value != 0)  # Avoid division by zero
        
        expected_change = ((value - previous_value) / previous_value) * 100
        
        record = AnalyticsRecord(
            record_type=record_type,
            metric_name=metric_name,
            value=value,
            previous_value=previous_value,
            change_percentage=expected_change
        )
        
        # Change percentage should match expected calculation
        if record.change_percentage is not None:
            assert abs(record.change_percentage - expected_change) < 1e-10, \
                f"Change percentage calculation mismatch: {record.change_percentage} != {expected_change}"


class TestModelRelationshipInvariants:
    """Property-based tests for model relationship invariants."""
    
    @given(
        article_id=st.text(min_size=1, max_size=255),
        title=st.text(min_size=1, max_size=500),
        sentiment_score=st.floats(min_value=-1.0, max_value=1.0)
    )
    def test_article_news_insight_consistency_invariant(self, article_id, title, sentiment_score):
        """
        INVARIANT: Article and NewsInsight should maintain consistency for shared fields.
        
        Related models should maintain consistent data representations
        to maintain data relationship invariants.
        """
        # Create Article
        article = Article(
            article_id=article_id,
            title=title,
            sentiment_score=sentiment_score,
            sentiment_label="positive" if sentiment_score >= 0.05 else "negative" if sentiment_score <= -0.05 else "neutral"
        )
        
        # Create NewsInsight with same data
        insight = NewsInsight(
            article_id=article_id,
            article_title=title,
            sentiment_score=sentiment_score,
            positive_score=max(0, sentiment_score),
            negative_score=max(0, -sentiment_score),
            neutral_score=1.0 - abs(sentiment_score),
            sentiment_label=article.sentiment_label
        )
        
        # Consistency invariants
        assert article.article_id == insight.article_id, "article_id should be consistent"
        assert article.title == insight.article_title, "title should be consistent"
        assert article.sentiment_score == insight.sentiment_score, "sentiment_score should be consistent"
        assert article.sentiment_label == insight.sentiment_label, "sentiment_label should be consistent"
    
    @given(
        asset=st.text(min_size=1, max_size=50),
        metric_name=st.text(min_size=1, max_size=100),
        window=st.sampled_from(["1h", "24h", "7d"]),
        trend_direction=st.sampled_from(["up", "down", "stable"]),
        score=st.floats(min_value=0.0, max_value=1.0),
        current_value=st.floats(min_value=-1000, max_value=1000),
        previous_value=st.floats(min_value=-1000, max_value=1000)
    )
    def test_analytics_asset_trend_consistency_invariant(
        self, asset, metric_name, window, trend_direction, score, current_value, previous_value
    ):
        """
        INVARIANT: AnalyticsRecord and AssetTrend should maintain consistency for trend data.
        
        Related analytics models should maintain consistent trend representations
        to maintain data relationship invariants.
        """
        assume(previous_value != 0)
        
        change_percentage = ((current_value - previous_value) / previous_value) * 100
        
        # Create AnalyticsRecord
        analytics = AnalyticsRecord(
            record_type="trend",
            asset=asset,
            metric_name=metric_name,
            window=window,
            value=current_value,
            previous_value=previous_value,
            change_percentage=change_percentage,
            trend_direction=trend_direction
        )
        
        # Create AssetTrend with same data
        asset_trend = AssetTrend(
            asset=asset,
            metric_name=metric_name,
            window=window,
            trend_direction=trend_direction,
            score=score,
            current_value=current_value,
            previous_value=previous_value,
            change_percentage=change_percentage
        )
        
        # Consistency invariants
        assert analytics.asset == asset_trend.asset, "asset should be consistent"
        assert analytics.metric_name == asset_trend.metric_name, "metric_name should be consistent"
        assert analytics.window == asset_trend.window, "window should be consistent"
        assert analytics.trend_direction == asset_trend.trend_direction, "trend_direction should be consistent"
        assert analytics.value == asset_trend.current_value, "value should be consistent"
        assert analytics.previous_value == asset_trend.previous_value, "previous_value should be consistent"
        
        if analytics.change_percentage is not None and asset_trend.change_percentage is not None:
            assert abs(analytics.change_percentage - asset_trend.change_percentage) < 1e-10, \
                "change_percentage should be consistent"


class TestModelConstraintInvariants:
    """Property-based tests for model constraint invariants."""
    
    @given(
        article_id=st.text(min_size=1, max_size=300),  # Exceeding 255 limit
        title=st.text(min_size=1, max_size=600),       # Exceeding 500 limit
        primary_asset=st.text(min_size=1, max_size=30)  # Exceeding 20 limit
    )
    def test_model_length_constraints_invariant(self, article_id, title, primary_asset):
        """
        INVARIANT: Models should enforce length constraints on string fields.
        
        Database models must enforce field length constraints
        to maintain database schema invariants.
        """
        # Only test if any field exceeds its limit
        assume(len(article_id) > 255 or len(title) > 500 or len(primary_asset) > 20)
        
        article = Article(
            article_id=article_id,
            title=title,
            primary_asset=primary_asset,
            sentiment_score=0.0,
            sentiment_label="neutral"
        )
        
        # Check for constraint violations
        violations = []
        if len(article.article_id) > 255:
            violations.append(f"article_id length {len(article.article_id)} > 255")
        if len(article.title) > 500:
            violations.append(f"title length {len(article.title)} > 500")
        if len(article.primary_asset or "") > 20:
            violations.append(f"primary_asset length {len(article.primary_asset)} > 20")
        
        if violations:
            pytest.fail(f"Model constraint violations detected: {', '.join(violations)}")
    
    @given(
        sentiment_score=st.floats(min_value=-2.0, max_value=2.0),
        sentiment_label=st.sampled_from(["positive", "negative", "neutral", "invalid"])
    )
    def test_model_value_constraints_invariant(self, sentiment_score, sentiment_label):
        """
        INVARIANT: Models should enforce value constraints on numeric and enum fields.
        
        Database models must enforce value constraints
        to maintain data integrity invariants.
        """
        # Only test if constraints are violated
        assume(sentiment_score < -1.0 or sentiment_score > 1.0 or sentiment_label not in ["positive", "negative", "neutral"])
        
        article = Article(
            article_id="test-id",
            title="Test Title",
            sentiment_score=sentiment_score,
            sentiment_label=sentiment_label
        )
        
        # Check for constraint violations
        violations = []
        if not (-1.0 <= article.sentiment_score <= 1.0):
            violations.append(f"sentiment_score {article.sentiment_score} outside [-1, 1]")
        if article.sentiment_label not in ["positive", "negative", "neutral"]:
            violations.append(f"sentiment_label '{article.sentiment_label}' not in valid set")
        
        if violations:
            pytest.fail(f"Model value constraint violations: {', '.join(violations)}")


if __name__ == "__main__":
    # Run tests directly
    pytest.main([__file__, "-v"])
