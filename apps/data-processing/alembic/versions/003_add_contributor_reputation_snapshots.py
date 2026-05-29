"""Add contributor_reputation_snapshots table

Revision ID: 003
Revises: 002
Create Date: 2026-05-29 00:00:00.000000

This migration adds support for the Contributor Reputation Snapshot Builder,
which builds periodic snapshots of contributor reputation and activity metrics
for leaderboards.

Snapshot Schedule:
- Daily at 00:00 UTC via APScheduler
- Configurable via environment variable
- Works with Stellar testnet data from contributor registry contract
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '003'
down_revision: Union[str, None] = '002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create contributor_reputation_snapshots table
    op.create_table(
        'contributor_reputation_snapshots',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('contributor_address', sa.String(length=56), nullable=False,
                  comment='Stellar public key of the contributor'),
        sa.Column('snapshot_date', sa.DateTime(timezone=True), nullable=False,
                  comment='Date/time when this snapshot was captured'),
        sa.Column('total_contributions', sa.Integer(), nullable=False, server_default='0',
                  comment='Total number of contributions in the snapshot period'),
        sa.Column('total_value_xlm', sa.Float(), nullable=False, server_default='0.0',
                  comment='Total value of contributions in XLM'),
        sa.Column('first_contribution_date', sa.DateTime(timezone=True), nullable=True,
                  comment='Date of first contribution'),
        sa.Column('last_contribution_date', sa.DateTime(timezone=True), nullable=True,
                  comment='Date of most recent contribution'),
        sa.Column('activity_streak_days', sa.Integer(), nullable=False, server_default='0',
                  comment='Consecutive days of activity ending at snapshot_date'),
        sa.Column('unique_projects', sa.Integer(), nullable=False, server_default='0',
                  comment='Number of unique projects contributed to'),
        sa.Column('reputation_score', sa.Float(), nullable=False, server_default='0.0',
                  comment='Weighted reputation score (0-100)'),
        sa.Column('metadata', sa.JSON(), nullable=True,
                  comment='Additional metadata including rank and percentile'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('contributor_address', 'snapshot_date', 
                           name='uq_contributor_snapshot_date')
    )
    
    # Create indexes for efficient querying
    op.create_index('idx_contributor_snapshots_address', 
                   'contributor_reputation_snapshots', 
                   ['contributor_address'])
    
    op.create_index('idx_contributor_snapshots_date', 
                   'contributor_reputation_snapshots', 
                   ['snapshot_date'])
    
    op.create_index('idx_contributor_snapshots_score', 
                   'contributor_reputation_snapshots', 
                   ['reputation_score'])
    
    # Composite index for top-N queries (most common use case)
    op.create_index('idx_contributor_snapshots_leaderboard', 
                   'contributor_reputation_snapshots', 
                   ['snapshot_date', 'reputation_score'],
                   postgresql_ops={'reputation_score': 'DESC'})
    
    # Index for activity-based queries
    op.create_index('idx_contributor_snapshots_activity', 
                   'contributor_reputation_snapshots', 
                   ['snapshot_date', 'activity_streak_days', 'reputation_score'])


def downgrade() -> None:
    op.drop_index('idx_contributor_snapshots_activity')
    op.drop_index('idx_contributor_snapshots_leaderboard')
    op.drop_index('idx_contributor_snapshots_score')
    op.drop_index('idx_contributor_snapshots_date')
    op.drop_index('idx_contributor_snapshots_address')
    op.drop_table('contributor_reputation_snapshots')
