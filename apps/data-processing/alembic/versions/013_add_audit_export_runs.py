"""add audit export runs

Revision ID: 013
Revises: 012
Create Date: 2026-10-19 00:00:00.000000

Adds the ``audit_export_runs`` table that records every invocation of the
prediction audit-trail export endpoint (Issue #1639).  Recording who asked
for what and when is itself an audit requirement ("export runs are themselves
audited").
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '013'
down_revision = '012'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'audit_export_runs',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        # What was requested
        sa.Column('query_type', sa.String(length=50), nullable=False),   # 'prediction_id' | 'subject' | 'time_range'
        sa.Column('query_params', sa.JSON(), nullable=False),             # sanitised copy of query params
        # Who asked (request-level metadata — no user PII stored here)
        sa.Column('request_id', sa.String(length=255), nullable=True),
        sa.Column('client_ip', sa.String(length=64), nullable=True),
        # What was returned
        sa.Column('row_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='ok'),  # 'ok' | 'error'
        sa.Column('error_detail', sa.Text(), nullable=True),
        # When
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('idx_audit_export_runs_query_type', 'audit_export_runs', ['query_type'], unique=False)
    op.create_index('idx_audit_export_runs_created_at', 'audit_export_runs', ['created_at'], unique=False)
    op.create_index('idx_audit_export_runs_request_id', 'audit_export_runs', ['request_id'], unique=False)


def downgrade() -> None:
    op.drop_index('idx_audit_export_runs_request_id', table_name='audit_export_runs')
    op.drop_index('idx_audit_export_runs_created_at', table_name='audit_export_runs')
    op.drop_index('idx_audit_export_runs_query_type', table_name='audit_export_runs')
    op.drop_table('audit_export_runs')
