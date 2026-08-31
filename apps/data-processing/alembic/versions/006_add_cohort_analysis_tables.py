"""Add cohort analysis tables for grant round contributor tracking

Revision ID: 006_add_cohort_analysis_tables
Revises: 005_add_project_contributor_reputation_snapshot
Create Date: 2026-07-23

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '006_add_cohort_analysis_tables'
down_revision = '005_add_project_contributor_reputation_snapshot'
branch_labels = None
depends_on = None


def upgrade():
    # Create grant_rounds table
    op.create_table(
        'grant_rounds',
        sa.Column('id', sa.BigInteger(), autoincrement=False, nullable=False),
        sa.Column('name', sa.String(length=255), nullable=True),
        sa.Column('description', sa.String(length=1000), nullable=True),
        sa.Column('start_time', sa.DateTime(timezone=True), nullable=False),
        sa.Column('end_time', sa.DateTime(timezone=True), nullable=False),
        sa.Column('total_pool', sa.Float(), nullable=True),
        sa.Column('total_contributions', sa.Float(), nullable=True),
        sa.Column('unique_contributors', sa.Integer(), nullable=True),
        sa.Column('unique_projects', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(length=50), nullable=False, server_default='active'),
        sa.Column('extra_data', postgresql.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_grant_rounds_start_time', 'grant_rounds', ['start_time'])
    op.create_index('idx_grant_rounds_end_time', 'grant_rounds', ['end_time'])
    op.create_index('idx_grant_rounds_status', 'grant_rounds', ['status'])

    # Create contributor_round_participation table
    op.create_table(
        'contributor_round_participation',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('round_id', sa.BigInteger(), nullable=False),
        sa.Column('contributor', sa.String(length=255), nullable=False),
        sa.Column('total_contributed', sa.Float(), nullable=False, server_default='0'),
        sa.Column('projects_supported', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('contribution_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('first_contribution_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_contribution_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('project_ids', postgresql.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('round_id', 'contributor', name='ux_contributor_round_participation_round_contributor')
    )
    op.create_index('idx_contributor_round_participation_contributor', 'contributor_round_participation', ['contributor'])
    op.create_index('idx_contributor_round_participation_round_id', 'contributor_round_participation', ['round_id'])

    # Create contributor_cohorts table
    op.create_table(
        'contributor_cohorts',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('cohort_id', sa.String(length=255), nullable=False),
        sa.Column('cohort_type', sa.String(length=50), nullable=False),
        sa.Column('definition_window_start', sa.DateTime(timezone=True), nullable=False),
        sa.Column('definition_window_end', sa.DateTime(timezone=True), nullable=False),
        sa.Column('member_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('members', postgresql.JSON(), nullable=True),
        sa.Column('total_contributed', sa.Float(), nullable=True),
        sa.Column('avg_contributed_per_member', sa.Float(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('cohort_id')
    )
    op.create_index('idx_contributor_cohorts_type', 'contributor_cohorts', ['cohort_type'])
    op.create_index('idx_contributor_cohorts_cohort_id', 'contributor_cohorts', ['cohort_id'])
    op.create_index('idx_contributor_cohorts_window', 'contributor_cohorts', ['definition_window_start', 'definition_window_end'])

    # Create cohort_retention_summaries table
    op.create_table(
        'cohort_retention_summaries',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('cohort_id', sa.String(length=255), nullable=False),
        sa.Column('round_id', sa.BigInteger(), nullable=False),
        sa.Column('cohort_size', sa.Integer(), nullable=False),
        sa.Column('retained_contributors', sa.Integer(), nullable=False),
        sa.Column('retention_rate', sa.Float(), nullable=False),
        sa.Column('retained_total_contributed', sa.Float(), nullable=True),
        sa.Column('avg_retained_contribution', sa.Float(), nullable=True),
        sa.Column('new_contributors', sa.Integer(), nullable=True),
        sa.Column('calculated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('cohort_id', 'round_id', name='ux_cohort_retention_cohort_round')
    )
    op.create_index('idx_cohort_retention_cohort_id', 'cohort_retention_summaries', ['cohort_id'])
    op.create_index('idx_cohort_retention_round_id', 'cohort_retention_summaries', ['round_id'])
    op.create_index('idx_cohort_retention_calculated_at', 'cohort_retention_summaries', ['calculated_at'])

    # Create repeat_contributor_summaries table
    op.create_table(
        'repeat_contributor_summaries',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('contributor', sa.String(length=255), nullable=False),
        sa.Column('rounds_participated', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('first_round_id', sa.BigInteger(), nullable=True),
        sa.Column('last_round_id', sa.BigInteger(), nullable=True),
        sa.Column('total_contributed_all_rounds', sa.Float(), nullable=False, server_default='0'),
        sa.Column('avg_contributed_per_round', sa.Float(), nullable=True),
        sa.Column('total_projects_supported', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('unique_projects_supported', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('contributor_type', sa.String(length=50), nullable=True),
        sa.Column('round_ids', postgresql.JSON(), nullable=True),
        sa.Column('first_contribution_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_contribution_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('calculated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('contributor')
    )
    op.create_index('idx_repeat_contributor_contributor', 'repeat_contributor_summaries', ['contributor'])
    op.create_index('idx_repeat_contributor_type', 'repeat_contributor_summaries', ['contributor_type'])
    op.create_index('idx_repeat_contributor_rounds', 'repeat_contributor_summaries', ['rounds_participated'])
    op.create_index('idx_repeat_contributor_calculated_at', 'repeat_contributor_summaries', ['calculated_at'])


def downgrade():
    op.drop_table('repeat_contributor_summaries')
    op.drop_table('cohort_retention_summaries')
    op.drop_table('contributor_cohorts')
    op.drop_table('contributor_round_participation')
    op.drop_table('grant_rounds')
