"""Add round_anomaly_signals table for anomaly detection (#874)

Revision ID: 004
Revises: 003
Create Date: 2026-06-25 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '004'
down_revision: Union[str, None] = '003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create round_anomaly_signals table
    op.create_table(
        'round_anomaly_signals',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('round_id', sa.BigInteger(), nullable=False),
        sa.Column('project_id', sa.BigInteger(), nullable=True),
        sa.Column('anomaly_type', sa.String(length=50), nullable=False),
        sa.Column('severity_score', sa.Float(), nullable=False),
        sa.Column('detection_rationale', sa.Text(), nullable=False),
        sa.Column('metric_values', sa.JSON(), nullable=True),
        sa.Column('threshold_used', sa.Float(), nullable=True),
        sa.Column('reviewed', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('review_notes', sa.Text(), nullable=True),
        sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('reviewed_by', sa.String(length=255), nullable=True),
        sa.Column('timestamp', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    
    # Create indexes for efficient querying
    op.create_index('idx_round_anomaly_signals_round_id', 'round_anomaly_signals', ['round_id'])
    op.create_index('idx_round_anomaly_signals_project_id', 'round_anomaly_signals', ['project_id'])
    op.create_index('idx_round_anomaly_signals_anomaly_type', 'round_anomaly_signals', ['anomaly_type'])
    op.create_index('idx_round_anomaly_signals_severity', 'round_anomaly_signals', ['severity_score'])
    op.create_index('idx_round_anomaly_signals_reviewed', 'round_anomaly_signals', ['reviewed'])
    op.create_index('idx_round_anomaly_signals_timestamp', 'round_anomaly_signals', ['timestamp'])
    op.create_index('idx_round_anomaly_signals_round_type', 'round_anomaly_signals', ['round_id', 'anomaly_type'])


def downgrade() -> None:
    # Drop indexes
    op.drop_index('idx_round_anomaly_signals_round_type', 'round_anomaly_signals')
    op.drop_index('idx_round_anomaly_signals_timestamp', 'round_anomaly_signals')
    op.drop_index('idx_round_anomaly_signals_reviewed', 'round_anomaly_signals')
    op.drop_index('idx_round_anomaly_signals_severity', 'round_anomaly_signals')
    op.drop_index('idx_round_anomaly_signals_anomaly_type', 'round_anomaly_signals')
    op.drop_index('idx_round_anomaly_signals_project_id', 'round_anomaly_signals')
    op.drop_index('idx_round_anomaly_signals_round_id', 'round_anomaly_signals')
    
    # Drop table
    op.drop_table('round_anomaly_signals')
