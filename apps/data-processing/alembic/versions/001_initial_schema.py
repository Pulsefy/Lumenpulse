"""Initial schema with Articles, SocialPosts, and AnalyticsRecords

Revision ID: 001
Revises: 
Create Date: 2026-03-26 23:09:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '001'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create articles table
    op.create_table(
        'articles',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('article_id', sa.String(length=255), nullable=False),
        sa.Column('title', sa.Text(), nullable=False),
        sa.Column('content', sa.Text(), nullable=True),
        sa.Column('summary', sa.Text(), nullable=True),
        sa.Column('source', sa.String(length=100), nullable=True),
        sa.Column('url', sa.Text(), nullable=True),
        sa.Column('asset_codes', sa.JSON(), nullable=True),
        sa.Column('primary_asset', sa.String(length=20), nullable=True),
        sa.Column('categories', sa.JSON(), nullable=True),
        sa.Column('sentiment_score', sa.Float(), nullable=True),
        sa.Column('positive_score', sa.Float(), nullable=True),
        sa.Column('negative_score', sa.Float(), nullable=True),
        sa.Column('neutral_score', sa.Float(), nullable=True),
        sa.Column('sentiment_label', sa.String(length=20), nullable=True),
        sa.Column('keywords', sa.JSON(), nullable=True),
        sa.Column('language', sa.String(length=10), nullable=True),
        sa.Column('published_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('fetched_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('analyzed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('article_id')
    )
    op.create_index('idx_articles_published_at', 'articles', ['published_at'])
    op.create_index('idx_articles_sentiment_label', 'articles', ['sentiment_label'])
    op.create_index('idx_articles_source', 'articles', ['source'])
    op.create_index('idx_articles_primary_asset', 'articles', ['primary_asset'])
    op.create_index('idx_articles_asset_sentiment', 'articles', ['primary_asset', 'sentiment_label'])
    op.create_index('idx_articles_created_at', 'articles', ['created_at'])
    op.create_index(op.f('ix_articles_article_id'), 'articles', ['article_id'])

    # Create social_posts table
    op.create_table(
        'social_posts',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('post_id', sa.String(length=255), nullable=False),
        sa.Column('platform', sa.String(length=50), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('author', sa.String(length=255), nullable=True),
        sa.Column('url', sa.Text(), nullable=True),
        sa.Column('likes', sa.Integer(), nullable=True),
        sa.Column('comments', sa.Integer(), nullable=True),
        sa.Column('shares', sa.Integer(), nullable=True),
        sa.Column('asset_codes', sa.JSON(), nullable=True),
        sa.Column('primary_asset', sa.String(length=20), nullable=True),
        sa.Column('hashtags', sa.JSON(), nullable=True),
        sa.Column('subreddit', sa.String(length=100), nullable=True),
        sa.Column('sentiment_score', sa.Float(), nullable=True),
        sa.Column('positive_score', sa.Float(), nullable=True),
        sa.Column('negative_score', sa.Float(), nullable=True),
        sa.Column('neutral_score', sa.Float(), nullable=True),
        sa.Column('sentiment_label', sa.String(length=20), nullable=True),
        sa.Column('posted_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('fetched_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('analyzed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('post_id')
    )
    op.create_index('idx_social_posts_platform', 'social_posts', ['platform'])
    op.create_index('idx_social_posts_posted_at', 'social_posts', ['posted_at'])
    op.create_index('idx_social_posts_sentiment_label', 'social_posts', ['sentiment_label'])
    op.create_index('idx_social_posts_primary_asset', 'social_posts', ['primary_asset'])
    op.create_index('idx_social_posts_platform_asset', 'social_posts', ['platform', 'primary_asset'])
    op.create_index('idx_social_posts_created_at', 'social_posts', ['created_at'])
    op.create_index(op.f('ix_social_posts_post_id'), 'social_posts', ['post_id'])

    # Create analytics_records table
    op.create_table(
        'analytics_records',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('record_type', sa.String(length=50), nullable=False),
        sa.Column('asset', sa.String(length=50), nullable=True),
        sa.Column('metric_name', sa.String(length=100), nullable=False),
        sa.Column('window', sa.String(length=20), nullable=True),
        sa.Column('value', sa.Float(), nullable=False),
        sa.Column('previous_value', sa.Float(), nullable=True),
        sa.Column('change_percentage', sa.Float(), nullable=True),
        sa.Column('trend_direction', sa.String(length=20), nullable=True),
        sa.Column('extra_data', sa.JSON(), nullable=True),
        sa.Column('timestamp', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_analytics_records_type', 'analytics_records', ['record_type'])
    op.create_index('idx_analytics_records_asset', 'analytics_records', ['asset'])
    op.create_index('idx_analytics_records_timestamp', 'analytics_records', ['timestamp'])
    op.create_index('idx_analytics_records_type_asset', 'analytics_records', ['record_type', 'asset'])
    op.create_index('idx_analytics_records_asset_metric', 'analytics_records', ['asset', 'metric_name'])

    # Create news_insights table (legacy)
    op.create_table(
        'news_insights',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('article_id', sa.String(length=255), nullable=True),
        sa.Column('article_title', sa.Text(), nullable=True),
        sa.Column('article_url', sa.Text(), nullable=True),
        sa.Column('source', sa.String(length=100), nullable=True),
        sa.Column('asset_codes', sa.JSON(), nullable=True),
        sa.Column('primary_asset', sa.String(length=20), nullable=True),
        sa.Column('sentiment_score', sa.Float(), nullable=False),
        sa.Column('positive_score', sa.Float(), nullable=False),
        sa.Column('negative_score', sa.Float(), nullable=False),
        sa.Column('neutral_score', sa.Float(), nullable=False),
        sa.Column('sentiment_label', sa.String(length=20), nullable=False),
        sa.Column('keywords', sa.JSON(), nullable=True),
        sa.Column('language', sa.String(length=10), nullable=True),
        sa.Column('article_published_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('analyzed_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_news_insights_analyzed_at', 'news_insights', ['analyzed_at'])
    op.create_index('idx_news_insights_sentiment_label', 'news_insights', ['sentiment_label'])
    op.create_index('idx_news_insights_source', 'news_insights', ['source'])
    op.create_index('idx_news_insights_primary_asset', 'news_insights', ['primary_asset'])
    op.create_index('idx_news_insights_asset_sentiment', 'news_insights', ['primary_asset', 'sentiment_label'])

    # Create asset_trends table (legacy)
    op.create_table(
        'asset_trends',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('asset', sa.String(length=50), nullable=False),
        sa.Column('metric_name', sa.String(length=100), nullable=False),
        sa.Column('window', sa.String(length=20), nullable=False),
        sa.Column('trend_direction', sa.String(length=20), nullable=False),
        sa.Column('score', sa.Float(), nullable=False),
        sa.Column('current_value', sa.Float(), nullable=False),
        sa.Column('previous_value', sa.Float(), nullable=False),
        sa.Column('change_percentage', sa.Float(), nullable=False),
        sa.Column('extra_data', sa.JSON(), nullable=True),
        sa.Column('timestamp', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_asset_trends_asset_metric', 'asset_trends', ['asset', 'metric_name'])
    op.create_index('idx_asset_trends_timestamp', 'asset_trends', ['timestamp'])
    op.create_index('idx_asset_trends_window', 'asset_trends', ['window'])


def downgrade() -> None:
    # Drop tables in reverse order
    op.drop_table('asset_trends')
    op.drop_table('news_insights')
    op.drop_table('analytics_records')
    op.drop_table('social_posts')
    op.drop_table('articles')
