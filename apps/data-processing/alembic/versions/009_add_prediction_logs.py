"""add prediction logs

Revision ID: 009
Revises: 008
Create Date: 2026-08-24 23:55:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '009'
down_revision = '008'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'prediction_logs',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('request_id', sa.String(length=255), nullable=False),
        sa.Column('model_type', sa.String(length=100), nullable=False),
        sa.Column('model_version', sa.String(length=50), nullable=False),
        sa.Column('input_hash', sa.String(length=255), nullable=False),
        sa.Column('output', sa.JSON(), nullable=False),
        sa.Column('latency_ms', sa.Float(), nullable=False),
        sa.Column('raw_input', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_prediction_logs_model_version', 'prediction_logs', ['model_version'], unique=False)
    op.create_index('idx_prediction_logs_created_at', 'prediction_logs', ['created_at'], unique=False)
    op.create_index(op.f('ix_prediction_logs_request_id'), 'prediction_logs', ['request_id'], unique=False)
    op.create_index(op.f('ix_prediction_logs_model_type'), 'prediction_logs', ['model_type'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_prediction_logs_model_type'), table_name='prediction_logs')
    op.drop_index(op.f('ix_prediction_logs_request_id'), table_name='prediction_logs')
    op.drop_index('idx_prediction_logs_created_at', table_name='prediction_logs')
    op.drop_index('idx_prediction_logs_model_version', table_name='prediction_logs')
    op.drop_table('prediction_logs')
