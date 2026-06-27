"""Add project contributor reputation snapshot table

Revision ID: 005
Revises: 004
Create Date: 2026-06-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '005'
down_revision: Union[str, None] = '004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'project_contributor_reputation_snapshots',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('project_id', sa.BigInteger(), nullable=False),
        sa.Column('contributor', sa.String(length=255), nullable=False),
        sa.Column('total_contributed', sa.Float(), nullable=False, server_default='0.0'),
        sa.Column('reputation_score', sa.Float(), nullable=False, server_default='0.0'),
        sa.Column('rank', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('snapshot_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('extra_data', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ux_project_contributor_reputation_snapshot_project_contributor',
        'project_contributor_reputation_snapshots',
        ['project_id', 'contributor'],
        unique=True,
    )
    op.create_index(
        'idx_project_contributor_reputation_snapshot_score',
        'project_contributor_reputation_snapshots',
        ['reputation_score'],
    )


def downgrade() -> None:
    op.drop_index(
        'idx_project_contributor_reputation_snapshot_score',
        table_name='project_contributor_reputation_snapshots',
    )
    op.drop_index(
        'ux_project_contributor_reputation_snapshot_project_contributor',
        table_name='project_contributor_reputation_snapshots',
    )
    op.drop_table('project_contributor_reputation_snapshots')
